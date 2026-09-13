// acceptance/probe-naming-live.mjs —— 手工复现 verify-live 的「真实命名」链路，但用正确的响应信封 {ok,data}
// 目的：验证 verify-live.mjs 的 payload 取法（body.json）是否已经过期。
const BASE = process.argv[2] ?? 'http://127.0.0.1:3080'
const post = async (path, body, timeoutMs = 180000) => {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    const text = await res.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 300) } }
    return { status: res.status, ms: Date.now() - started, body: parsed }
  } finally { clearTimeout(t) }
}
const get = async (path) => {
  const res = await fetch(BASE + path)
  return { status: res.status, body: await res.json().catch(() => null) }
}

const cap = await get('/api/stock-panel/naming')
console.log('[cap]', JSON.stringify({ status: cap.status, available: cap.body?.available, provider: cap.body?.provider, model: cap.body?.model, promptVersion: cap.body?.promptVersion, defaults: cap.body?.defaults }))

const cls = await post('/api/stock-panel/call', { tool: 'hist_concept_classes', args: { window: 90, min_corr: 0.6, pool_n: 200, top_members: 5 } }, 180000)
const env = cls.body ?? {}
console.log('[classes] status=%d ms=%d 顶层键=%s', cls.status, cls.ms, Object.keys(env).join(','))
// 陈旧取法（verify-live 现状）
const stale = env.json ?? env
console.log('[stale 取法 body.json ?? body] as_of=%s classes=%d  → usable=%d', stale?.as_of ?? '—', (stale?.classes ?? []).length, (stale?.classes ?? []).filter((c) => c.weak_chain !== true).length)
// 正确取法
const payload = env.data ?? env
console.log('[正确取法 body.data ?? body] as_of=%s classes=%d  → usable=%d', payload?.as_of ?? '—', (payload?.classes ?? []).length, (payload?.classes ?? []).filter((c) => c.weak_chain !== true).length)

const usable = (payload?.classes ?? []).filter((c) => c.weak_chain !== true)
if (usable.length === 0) {
  console.log('[naming] 没有可用类，跳过')
  process.exit(0)
}
// 按强度排序（与界面同源：均涨幅 + 6×涨停数），挑最强的类
const strength = (c) => {
  const members = c.members ?? []
  const chgs = members.map((m) => Number(m.chg_pct)).filter((x) => Number.isFinite(x))
  const mean = chgs.length ? chgs.reduce((a, b) => a + b, 0) / chgs.length : 0
  const lu = members.filter((m) => m.limit_up === true).length
  return mean + 6 * lu
}
const ranked = [...usable].sort((a, b) => strength(b) - strength(a)).slice(0, 3)
console.log('[ranked]', ranked.map((c) => `#${c.class_id} size=${c.size} strength=${strength(c).toFixed(2)}`).join(' | '))

const target = ranked[1] ?? ranked[0]
const named = await post('/api/stock-panel/naming', { classId: target.class_id, asOf: payload?.as_of }, 180000)
console.log('[naming] HTTP %d ms=%d', named.status, named.ms)
const out = named.body ?? {}
if (out.ok !== true) {
  console.log('[naming] 被拒:', JSON.stringify(out).slice(0, 500))
  process.exit(0)
}
const r = out.result ?? {}
console.log(JSON.stringify({
  classId: target.class_id,
  size: target.size,
  top: target.top,
  verdict: r.verdict,
  theme: r.theme,
  fingerprint: r.fingerprint,
  evidenceScore: r.evidenceScore,
  evidenceCount: r.evidenceCount,
  materialCount: r.materialCount,
  degradedReason: r.degradedReason,
  missingSources: r.missingSources,
  sourceStatus: (r.sourceStatus ?? []).map((s) => `${s.source}:${s.status}(${s.produced})`),
  evidence: (r.evidence ?? []).slice(0, 3).map((e) => ({ src: e.source, ts: e.ts, quote: String(e.quote).slice(0, 60) })),
  callCount: out.meta?.calls ?? out.calls,
  collectNotes: (out.collectNotes ?? []).slice(0, 4),
}, null, 2))
