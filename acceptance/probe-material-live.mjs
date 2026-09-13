// 核对：非交易日时 belong_board / kline 素材源是否真的"没东西"（还是采集口径有问题）
const BASE = 'http://127.0.0.1:3080'
const call = async (tool, args) => {
  const res = await fetch(BASE + '/api/stock-panel/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args }) })
  const j = await res.json()
  return { status: res.status, ok: j.ok, data: j.data, error: j.error }
}
const cls = await call('hist_concept_class', { class_id: 3, window: 90, min_corr: 0.6, pool_n: 200, top_members: 5 })
const members = cls.data?.members ?? []
console.log('class 3 members:', members.map((m) => m.market + m.code + ' ' + m.name).join(', '))
for (const m of members.slice(0, 2)) {
  const bb = await call('belong_board', { market: m.market, code: m.code })
  console.log('belong_board', m.name, '->', JSON.stringify(bb.data)?.slice(0, 260) ?? bb.error)
  const kl = await call('kline', { market: m.market, code: m.code, count: 5, period: 'DAILY' })
  const rows = Array.isArray(kl.data) ? kl.data : []
  console.log('kline', m.name, '-> rows=', rows.length, JSON.stringify(rows.slice(-2))?.slice(0, 220) ?? kl.error)
}
// 顺带看一眼该类的行情语义（实时异动/主力监控在非交易日确实该跳过）
const un = await call('unusual', { market: 'SH', count: 3 })
console.log('unusual(SH) rows=', Array.isArray(un.data) ? un.data.length : JSON.stringify(un).slice(0, 160))
