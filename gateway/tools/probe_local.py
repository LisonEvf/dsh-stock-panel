"""本机 opentdx 直连探测（诊断/契约对比用）。

验证：
  1. TRADE\\opentdx 源码可被直接 import（零 pip 依赖，仅 python >=3.12）；
  2. 首次建连+登录耗时（首连/预热指标）；
  3. 建连后单次请求耗时（warm）；
  4. quote / kline / server_info 返回结构与远端 MCP（192.168.31.196:8007）逐字段可比。

用法：
  python tools/probe_local.py            # 默认用 PYTHONPATH 外挂的 opentdx
  python tools/probe_local.py --timeout  # 打印各阶段耗时
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'opentdx')))

from opentdx import TdxClient  # noqa: E402
from opentdx.const import MARKET, PERIOD  # noqa: E402


def jdump(obj):
    return json.dumps(obj, ensure_ascii=False, default=str)


def main():
    print('opentdx import path:', sys.path[0])
    import opentdx
    print('opentdx module:', opentdx.__file__)

    t0 = time.perf_counter()
    client = TdxClient()
    client.__enter__()  # 常驻进程用法（同 MCP server 的 _c()）
    t1 = time.perf_counter()
    print(f'[timing] first connect+login (7709+7727): {t1 - t0:.3f}s')

    # server_info
    t = time.perf_counter()
    info = client.server_info()
    print(f'[timing] server_info warm: {time.perf_counter() - t:.3f}s')
    print('server_info =', jdump(info))

    # quote：与远端 MCP quote 同参
    t = time.perf_counter()
    quotes = client.stock_quotes_fields([(MARKET.SH, '600519')])
    print(f'[timing] quote SH 600519 warm: {time.perf_counter() - t:.3f}s')
    print('quote =', jdump(quotes))

    # kline：与远端 MCP kline 同参（adjust 默认 NONE）
    t = time.perf_counter()
    rows = client.stock_kline(MARKET.SH, '600519', PERIOD.DAILY, start=0, count=3, adjust=None)
    print(f'[timing] kline SH 600519 DAILY x3 warm: {time.perf_counter() - t:.3f}s')
    print('kline =', jdump(rows))

    client.__exit__(None, None, None)


if __name__ == '__main__':
    main()
