"""stock-tdx-gateway — 本机 opentdx 行情 JSON 网关（直连，无 MCP）。

背景
----
frontend-dsh 插件原数据链路为「浏览器 → host 桥 → 远端 MCP(192.168.31.196:8007)
→ opentdx → TDX」，每请求承担 JSON-RPC + SSE + LAN 一跳（本机实测 TCP 约 30ms）
与远端进程依赖。本网关把 opentdx（TRADE\\opentdx 源码）直接跑在本机：

    Browser(插件) --JSON--> http://127.0.0.1:8017/call --> opentdx(TdxClient) --> TDX

工具名/参数/返回结构与远端 MCP 服务器逐一对齐（15 个工具），因此前端
`stock-data.ts` 适配层无需改动，只换传输层。

连接速度优化（侧重首连/预热）
----------------------------
1. 进程常驻 + 启动即预热：TdxClient.__enter__() 启动时即完成两个 MAC 客户端
   （7709 A股 / 7727 扩展）的并发选服、建连、登录（本机实测约 0.17s）；
2. opentdx 内部选服结果进程级缓存（300s TTL），warm 后每请求约 15ms；
3. 共享客户端 multithread=True（收发加锁，线程安全）+ heartbeat=True（心跳保活，
   空闲不重连）；任一请求若检测到断线会自动重连后重试（TdxClient.q_client/eq_client）；
4. 纯 JSON 传输：无 MCP 会话握手、无 SSE 解析，HTTP keep-alive + CORS 直连。

用法
----
    python gateway.py [--host 127.0.0.1] [--port 8017] [--opentdx-src <路径>]
                      [--log gateway.log]

建议通过 run-gateway.ps1 启动/自启。
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import date, datetime, time as dtime
from enum import Enum
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

# ── 定位 opentdx 源码（默认本仓库上级 TRADE\\opentdx，可被 --opentdx-src 覆盖） ──
_DEFAULT_OPENTDX_SRC = os.environ.get(
    'OPENTDX_SRC',
    str(Path(__file__).resolve().parents[3] / 'opentdx'),
)

log = logging.getLogger('tdx-gateway')

_client: Any = None
_client_holder: Any = None
_started_at: float = time.time()

# ── JSON 序列化：枚举→值、datetime/date/time→ISO（对齐远端 MCP 输出格式） ──


def _default_json(o: Any) -> Any:
    if isinstance(o, Enum):
        return o.value
    if isinstance(o, datetime):
        return o.isoformat(sep='T')
    if isinstance(o, date):
        return o.isoformat()
    if isinstance(o, dtime):
        return o.isoformat()
    if isinstance(o, bytes):
        return o.decode('utf-8', errors='ignore')
    return str(o)


def dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, default=_default_json)


# ── 工具实现（镜像 opentdx-mcp/server.py 的参数与返回契约） ──


def _ensure_client() -> Any:
    """返回进程级共享 TdxClient（已连上 7709 + 7727）。"""
    global _client, _client_holder
    if _client is not None:
        return _client
    from opentdx import TdxClient

    _client = TdxClient()
    t0 = time.perf_counter()
    _client_holder = _client.__enter__()  # 预热：选服+建连+登录两个 MAC 客户端
    log.info('TdxClient warm-up done in %.3fs (quote server=%s:%s, ext=%s:%s)',
             time.perf_counter() - t0,
             getattr(_client.q_client(), 'ip', '?'), getattr(_client.q_client(), 'port', '?'),
             getattr(_client.eq_client(), 'ip', '?'), getattr(_client.eq_client(), 'port', '?'))
    return _client


def _mkt(s: str) -> Any:
    from opentdx.const import EX_MARKET, MARKET

    try:
        return MARKET[s.upper()]
    except KeyError:
        return EX_MARKET[s.upper()]


def _period(s: str) -> Any:
    from opentdx.const import PERIOD

    return PERIOD[s.upper()]


def _date_or_none(s: str | None):
    return date.fromisoformat(s) if s else None


def _t_kline(args: dict) -> Any:
    return _ensure_client().stock_kline(
        _mkt(str(args['market'])), str(args['code']), _period(str(args.get('period', 'DAILY'))),
        start=int(args.get('start', 0)), count=int(args.get('count', 10)),
        adjust=_adjust(str(args.get('adjust', 'NONE'))),
    )


def _adjust(s: str) -> Any:
    from opentdx.const import ADJUST

    return ADJUST[s.upper()]


def _t_quote(args: dict) -> Any:
    return _ensure_client().stock_quotes_fields([(_mkt(str(args['market'])), str(args['code']))])


def _t_tick_chart(args: dict) -> Any:
    return _ensure_client().stock_tick_chart(
        _mkt(str(args['market'])), str(args['code']), query_date=_date_or_none(args.get('query_date')),
    )


def _t_transaction(args: dict) -> Any:
    return _ensure_client().stock_transaction(
        _mkt(str(args['market'])), str(args['code']),
        query_date=_date_or_none(args.get('query_date')),
        count=int(args['count']) if args.get('count') is not None else None,
    )


def _t_auction(args: dict) -> Any:
    return _ensure_client().stock_auction(_mkt(str(args['market'])), str(args['code']))


def _t_unusual(args: dict) -> Any:
    return _ensure_client().stock_unusual(_mkt(str(args['market'])), count=int(args.get('count', 10)))


def _t_board_members(args: dict) -> Any:
    from opentdx.const import CATEGORY, SORT_ORDER, SORT_TYPE

    c = _ensure_client()
    bs = str(args.get('board_symbol', '881001')).upper()
    board = CATEGORY[bs] if bs in ('A', 'SZ', 'SH', 'KCB', 'CYB', 'B', 'BJ') else str(args['board_symbol'])
    return c.stock_board_members(
        board, count=int(args.get('count', 50)),
        sort_type=SORT_TYPE[str(args.get('sort_type', 'CHANGE_PCT')).upper()],
        sort_order=SORT_ORDER[str(args.get('sort_order', 'DESC')).upper()],
    )


def _t_capital_flow(args: dict) -> Any:
    return _ensure_client().stock_capital_flow(_mkt(str(args['market'])), str(args['code']))


def _t_symbol_info(args: dict) -> Any:
    return _ensure_client().stock_symbol_info(_mkt(str(args['market'])), str(args['code']))


def _t_belong_board(args: dict) -> Any:
    return _ensure_client().stock_belong_board(_mkt(str(args['market'])), str(args['code']))


def _t_market_monitor(args: dict) -> Any:
    return _ensure_client().stock_market_monitor(_mkt(str(args['market'])), count=int(args.get('count', 10)))


def _t_server_info(args: dict) -> Any:
    return _ensure_client().server_info()


def _t_goods_quotes(args: dict) -> Any:
    return _ensure_client().goods_quotes(_mkt(str(args['market'])), str(args['code']))


def _t_goods_kline(args: dict) -> Any:
    return _ensure_client().goods_kline(
        _mkt(str(args['market'])), str(args['code']),
        _period(str(args.get('period', 'DAILY'))), count=int(args.get('count', 10)),
    )


def _t_goods_varieties(args: dict) -> Any:
    return _ensure_client().goods_varieties(int(args['market_id']), count=int(args.get('count', 20)))


TOOLS: dict[str, Callable[[dict], Any]] = {
    'kline': _t_kline,
    'quote': _t_quote,
    'tick_chart': _t_tick_chart,
    'transaction': _t_transaction,
    'auction': _t_auction,
    'unusual': _t_unusual,
    'board_members': _t_board_members,
    'capital_flow': _t_capital_flow,
    'symbol_info': _t_symbol_info,
    'belong_board': _t_belong_board,
    'market_monitor': _t_market_monitor,
    'server_info': _t_server_info,
    'goods_quotes': _t_goods_quotes,
    'goods_kline': _t_goods_kline,
    'goods_varieties': _t_goods_varieties,
}


# ── HTTP（stdlib ThreadingHTTPServer + CORS） ──


class _Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):  # 精简访问日志走 logging（不做 DNS 反查）
        log.info('%s %s', self.client_address[0], fmt % args)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '600')

    def _json(self, code: int, payload: Any):
        body = dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip('/') == '/healthz':
            ok = False
            try:
                c = _ensure_client()
                ok = bool(getattr(c.q_client(), 'connected', False))
            except Exception as exc:  # noqa: BLE001
                log.warning('healthz error: %s', exc)
            self._json(200, {
                'ok': ok,
                'app': 'stock-tdx-gateway',
                'uptime_s': round(time.time() - _started_at, 1),
                'connected': {
                    'a': ok,
                    'ext': bool(getattr(_ensure_client().eq_client(), 'connected', False)) if ok else False,
                },
                'tools': sorted(TOOLS),
            })
            return
        self._json(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        if self.path.rstrip('/') != '/call':
            self._json(404, {'ok': False, 'error': 'not found'})
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
            if length <= 0 or length > 2 * 1024 * 1024:
                self._json(400, {'ok': False, 'error': 'bad body size'})
                return
            raw = self.rfile.read(length)
            req = json.loads(raw.decode('utf-8'))
            tool = str(req.get('tool', ''))
            args = req.get('args') or {}
            if tool not in TOOLS:
                self._json(400, {'ok': False, 'error': f'unknown tool: {tool}'})
                return
            if not isinstance(args, dict):
                self._json(400, {'ok': False, 'error': 'args must be an object'})
                return
            t0 = time.perf_counter()
            try:
                data = TOOLS[tool](args)
            except Exception as exc:  # noqa: BLE001
                log.warning('tool %s failed: %s', tool, exc)
                self._json(200, {'ok': False, 'error': f'{tool}: {exc}'})
                return
            cost_ms = (time.perf_counter() - t0) * 1000
            log.info('call %s %s -> %.1fms', tool, dumps(args)[:120], cost_ms)
            self._json(200, {'ok': True, 'data': data, 'cost_ms': round(cost_ms, 1)})
        except Exception as exc:  # noqa: BLE001
            self._json(400, {'ok': False, 'error': f'bad request: {exc}'})


def main() -> None:
    parser = argparse.ArgumentParser(description='stock-tdx-gateway（本机 opentdx 直连行情网关）')
    parser.add_argument('--host', default=os.environ.get('TDX_GATEWAY_HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('TDX_GATEWAY_PORT', '8017')))
    parser.add_argument('--opentdx-src', default=_DEFAULT_OPENTDX_SRC)
    parser.add_argument('--log', default='')
    args = parser.parse_args()

    src = Path(args.opentdx_src).resolve()
    if not (src / 'opentdx').is_dir():
        sys.exit(f'opentdx 源码目录无效: {src}')
    sys.path.insert(0, str(src))

    handlers = [logging.StreamHandler(sys.stdout)]
    if args.log:
        Path(args.log).parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(args.log, encoding='utf-8'))
    logging.basicConfig(
        level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s',
        handlers=handlers,
    )

    # 预热（首连/预热指标）：常驻进程只做一次；短暂重试后仍失败则退出交给守护重启
    last_exc: Exception | None = None
    for attempt in range(1, 4):
        try:
            _ensure_client()
            last_exc = None
            break
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            log.warning('预热第 %d/3 次失败：%s', attempt, exc)
            time.sleep(1.5)
    if last_exc is not None:
        log.error('预热失败（TDX 服务器不可达？）：%s', last_exc)
        sys.exit(1)

    server = ThreadingHTTPServer((args.host, args.port), _Handler)
    server.daemon_threads = True
    log.info('stock-tdx-gateway listening on http://%s:%d/call', args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if _client_holder is not None:
            _client_holder.__exit__(None, None, None)


if __name__ == '__main__':
    main()
