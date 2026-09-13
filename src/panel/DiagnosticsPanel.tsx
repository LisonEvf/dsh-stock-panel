/**
 * src/panel/DiagnosticsPanel.tsx — 子系统诊断面板（B5-③）。
 *
 * 存在的理由：这个插件的故障模式几乎都是「**静默**」的——数据链路不可达、
 * 命中了陈旧缓存、host 持久化降级成 localStorage、模型没挂上、浏览器跑着旧 bundle……
 * 它们都不会抛异常，只会在界面上表现成「数字不对」「没有这个功能」。
 * 于是把五件事摊在一处，供人一眼判断，而不是每次开 DevTools 抄命令：
 *
 *   ① 构建   ：本页 build id vs 服务端 build id（不一致 = 跑着旧 bundle）
 *   ② 持久化 ：host 域可用性 / 降级原因 / 各表记录数 / 是否已首迁
 *   ③ 数据链路：transport / 端点 / 19 个内置工具
 *   ④ 缓存   ：每个 SWR key 的状态、数据年龄、是否在途（13 个轮询者的共同底账）
 *   ⑤ AI 与 HIST：模型路由可用性、自挖概念引擎快照状态（按需探测，不轮询）
 *
 * 立场：**如实展示，包括不可用的原因**——诊断面板最忌讳把失败说成正常。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { X, RefreshCw } from 'lucide-react'
import { CLIENT_BUILD_ID, CLIENT_VERSION } from '@/lib/build-info'
import { hostStateInfo } from '@/lib/host-state'
import { swrDiagnostics, type SwrStatus } from '@/lib/cache'
import { AI_CALL_ROUTE, endpointDiagnostics, getTransportMode } from '@/lib/endpoints'
import { CONVERSATION_TOOLS, EMBEDDED_TOOLS } from '@/lib/tool-names'
import { pollGate, pollSkippedTicks } from '@/lib/poll-gate'
import { callToolJson } from '@/lib/stock-data'

/** HIST 自挖概念工具数（从唯一定义源数出来，不写死数字）。 */
const HIST_TOOL_COUNT = EMBEDDED_TOOLS.filter((t) => t.name.startsWith('hist_concept_')).length

interface Props {
  onClose: () => void
  /** 服务端构建 id（来自 AppShell 的 useBuildInfo）。 */
  serverBuildId?: string
}

/** 异步探测结果（AI / HIST）。 */
interface Probe {
  loading: boolean
  text: string
  ok: boolean
}

const IDLE: Probe = { loading: false, text: '未探测', ok: false }

/**
 * 状态 → 颜色档位。
 *
 * 实测原实现是 `success → dc-up`（红）/ `error → dc-down`（绿）—— 把 A 股「红涨绿跌」
 * 直接借来当"成功/失败"用，等于**让用户读反**：缓存正常是红的、取数失败是绿的。
 * 状态类信息一律用与价格语义解耦的 dc-ok / dc-bad / dc-warn。
 */
function statusTone(status: SwrStatus): string {
  if (status === 'success') return 'dc-ok'
  if (status === 'error') return 'dc-bad'
  if (status === 'loading') return 'dc-warn'
  return 'dc-flat'
}

/** 年龄 → 人读（诊断看的是量级，不是精度）。 */
function ageText(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}min`
}

export function DiagnosticsPanel({ onClose, serverBuildId }: Props) {
  const [tick, setTick] = useState(0)
  const [ai, setAi] = useState<Probe>(IDLE)
  const [hist, setHist] = useState<Probe>(IDLE)

  // 面板打开期间每秒刷新一次（缓存年龄是活的）；探测结果不轮询。
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    let alive = true
    setAi({ loading: true, text: '探测中…', ok: false })
    void fetch(AI_CALL_ROUTE, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((r) => r.json())
      .then((body: { available?: boolean; reason?: string; provider?: string; model?: string }) => {
        if (!alive) return
        setAi(
          body.available === true
            ? { loading: false, ok: true, text: `${body.provider ?? '?'} / ${body.model ?? '?'}` }
            : { loading: false, ok: false, text: body.reason ?? '不可用（未给出原因）' },
        )
      })
      .catch((err: unknown) => {
        if (alive) setAi({ loading: false, ok: false, text: `探测失败：${(err as Error)?.message ?? err}` })
      })
    return () => {
      alive = false
    }
  }, [])

  const probeHist = () => {
    setHist({ loading: true, text: '探测中…（首次可能数十秒：要拉数百只 K 线）', ok: false })
    void callToolJson('hist_concept_status', {})
      .then((d) => {
        const s = d as { engine?: string; snapshot_ready?: boolean; kline_cached?: number; snapshot?: { as_of?: string } } | null
        setHist({
          loading: false,
          ok: s?.snapshot_ready === true,
          text: s === null
            ? '无返回'
            : `${s.engine ?? '?'} · 快照${s.snapshot_ready ? `就绪 as_of=${s.snapshot?.as_of ?? '?'}` : '未就绪（首次调用会惰性重建）'} · K线缓存 ${s.kline_cached ?? 0} 条`,
        })
      })
      .catch((err: unknown) => setHist({ loading: false, ok: false, text: `失败：${(err as Error)?.message ?? err}` }))
  }

  const host = hostStateInfo()
  const endpoints = endpointDiagnostics()
  const swr = swrDiagnostics()
  const stale = serverBuildId !== undefined && serverBuildId !== CLIENT_BUILD_ID
  void tick // 仅用于触发重渲染（缓存年龄随时间变化）

  return (
    <div className="dc-palette-mask" onClick={onClose}>
      <div className="dc-palette" style={{ width: 720, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="dc-subnav" style={{ padding: '4px 6px' }}>
          <strong style={{ fontSize: 12 }}>子系统诊断</strong>
          <span className="dc-ai-note">如实展示，包括不可用原因</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="dc-btn dc-btn--icon" title="关闭（Esc）" onClick={onClose}>
            <X size={12} />
          </button>
        </div>

        <div className="dc-scroll" style={{ maxHeight: '70vh', padding: '6px 10px', fontSize: 11 }}>
          {/* ① 构建 */}
          <Section title="① 构建（判断浏览器是否跑着旧 bundle）">
            <Row label="插件版本" value={`v${CLIENT_VERSION}`} />
            <Row label="本页 build" value={CLIENT_BUILD_ID} />
            <Row label="服务端 build" value={serverBuildId ?? '（未取到）'} />
            <Row
              label="一致性"
              value={serverBuildId === undefined ? '未知' : stale ? '不一致 —— 需硬刷新' : '一致'}
              tone={stale ? 'dc-bad' : 'dc-ok'}
            />
          </Section>

          {/* ② 持久化 */}
          <Section title="② 持久化（A1：host 域 vs localStorage 降级）">
            <Row
              label="可用性"
              value={host.availability === 'available' ? 'host 域可用' : host.availability === 'unknown' ? '接入中…' : '已降级为本地存储'}
              tone={host.availability === 'available' ? 'dc-ok' : host.availability === 'unknown' ? 'dc-flat' : 'dc-warn'}
            />
            {host.reason !== '' ? <Row label="原因" value={host.reason} tone="dc-warn" /> : null}
            <Row label="已首迁" value={host.migrated === true ? '是' : '否（域为空且本地有数据时会一次性上传）'} />
            <Row
              label="待同步表数"
              value={
                (host.pending ?? 0) === 0
                  ? '0（全部已落地）'
                  : `${host.pending} 张表未落地 —— 数据仍在本地镜像，回到页面/5 秒后自动重试`
              }
              tone={(host.pending ?? 0) === 0 ? 'dc-ok' : 'dc-warn'}
            />
            {host.counts !== undefined ? (
              <Row
                label="各表记录数"
                value={Object.entries(host.counts)
                  .map(([k, v]) => `${k}=${v}`)
                  .join('  ')}
              />
            ) : null}
          </Section>

          {/* ③ 数据链路 */}
          <Section title="③ 数据链路（行情）">
            <Row label="传输模式" value={getTransportMode()} />
            {Object.entries(endpoints).map(([k, v]) => (
              <Row key={k} label={k} value={v} />
            ))}
            <Row
              label="内置工具"
              value={`${EMBEDDED_TOOLS.length} 个（数据层：行情 ${EMBEDDED_TOOLS.length - HIST_TOOL_COUNT} + HIST ${HIST_TOOL_COUNT}）／对话工具 ${CONVERSATION_TOOLS.length} 个`}
            />
            <Row
              label="休市闸门"
              value={`${pollGate().allowed ? '轮询中' : '已暂停定时轮询'} · ${pollGate().reason} · 本次会话已挡下 ${pollSkippedTicks()} 轮`}
              tone={pollGate().allowed ? '' : 'text-amber-600'}
            />
          </Section>

          {/* ④ 缓存 */}
          <Section title={`④ 缓存（${swr.length} 个 key —— 13 个轮询者的共同底账）`}>
            {swr.length === 0 ? (
              <div className="dc-row-hint">尚无缓存条目（面板刚加载）</div>
            ) : (
              swr.map((e) => (
                <Row
                  key={e.key}
                  label={e.key}
                  value={`${e.status}${e.hasData ? '' : '·无数据'} · ${ageText(e.ageMs)}${e.inflight ? ' ·在途' : ''}${e.error !== undefined ? ` · ${e.error}` : ''}`}
                  tone={statusTone(e.status)}
                />
              ))
            )}
          </Section>

          {/* ⑤ AI 与 HIST */}
          <Section title="⑤ AI 与自挖概念（按需探测，不轮询）">
            <Row
              label="AI 一键研判"
              value={ai.loading ? '探测中…' : ai.text}
              tone={ai.ok ? 'dc-ok' : ai.loading ? 'dc-flat' : 'dc-warn'}
            />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <button type="button" className="dc-btn" onClick={probeHist} disabled={hist.loading}>
                <RefreshCw size={11} /> 探测 HIST 引擎
              </button>
              <span className={hist.ok ? 'dc-ok' : 'dc-flat'} style={{ fontSize: 11 }}>
                {hist.loading ? '探测中…' : hist.text}
              </span>
            </div>
          </Section>

          <div className="dc-row-hint" style={{ marginTop: 6 }}>
            提示：行情/缓存类问题先看 ③④；「数据怎么没了」看 ②；「界面是旧版」看 ①。
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 3, color: 'var(--dc-text-3, #64748b)' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  )
}

function Row({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ minWidth: 150, color: 'var(--dc-text-3, #94a3b8)' }}>{label}</span>
      <span className={`dc-num ${tone}`} style={{ wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}
