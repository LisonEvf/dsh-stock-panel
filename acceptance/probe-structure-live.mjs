// acceptance/probe-structure-live.mjs —— 「自挖板块」命名链路的**真机取证**（真 TDX + 假模型）。
//
// 为什么必须有这一条（不能只靠单测）：2026-09-14 那个 `belong_board` 字段名 bug，
// 单测与冒烟**全绿**（假数据照着错代码写，两边一起错就永远自洽），而线上该源产出恒为 0 ——
// 实测 9 个类全部显示「素材不足」，一个名字都给不出来。要防住这一类事故，唯一有效的证据是
// **拿真数据跑一遍采集**：这里用与生产完全相同的 `callEmbeddedTool`，只把 LLM 换成
// 一个"永远说素材不足"的假模型（于是输出不依赖任何模型判断，可复现、可重跑）。
//
// 与 `probe-naming-live.mjs` 的区别：那个走**运行中的 dsh web 的 HTTP 路由**（验的是"当前进程"），
// 这个直接 import **构建产物**跑链路（验的是"这份代码"）—— host 半是进程内加载的，
// 改完不重启时只有后者能给出证据。
//
// 看三件事：
//   ① `belong_board` 的逐源状态必须是 `used`（不是 no_material / failed）；
//   ② 每个类的**结构标签**（官方行业/概念口径）应当是人能读懂的词（如 铜 / 黄金 / 存储芯片）；
//   ③ 结构标签必须与成员板块数据自洽（字非空 ⇒ 至少 2 只成员共享，不许凭空满覆盖）。
//
// 用法：pnpm build && node acceptance/probe-structure-live.mjs [asOf]
import { fileURLToPath, pathToFileURL } from 'node:url'

const HOST_BUNDLE = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const mod = await import(pathToFileURL(HOST_BUNDLE).href)
const { callEmbeddedTool, nameClasses, clearNamingCache, disposeTdxClient } = mod

const asOfArg = process.argv[2]

/** 假模型：永远判"素材不足"。这样输出与模型无关，纯粹验采集与结构标签。 */
const fakeLlm = {
  stream() {
    const text = JSON.stringify({
      verdict: 'insufficient',
      theme: null,
      confidence: 0,
      alternatives: [],
      evidence: [],
      reasoning: '探针：不参与判断（本脚本只验素材采集与结构标签）。',
    })
    return (async function* gen() {
      for (const part of text.match(/.{1,60}/gs) ?? []) yield { type: 'text-delta', text: part }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  },
}

const info = await callEmbeddedTool('server_info', {})
const today = String(info?.today ?? '')
console.log(`[probe] 当前交易日 = ${today || '未知'}；as_of = ${asOfArg ?? '(引擎默认)'}`)

clearNamingCache()
const out = await nameClasses(
  {
    callTool: (name, args) => callEmbeddedTool(name, args),
    llm: fakeLlm,
    route: { provider: 'probe', model: 'probe-fake' },
    today,
    // 快讯源要出网到非通达信；本探针只验板块素材与结构标签 → 显式关掉（状态会记「按设计跳过」）
    news: false,
  },
  { ...(asOfArg !== undefined ? { asOf: asOfArg } : {}), maxClasses: 12 },
)

if (out.ok !== true) {
  console.error(`[probe] 批量命名未成功：${out.reason} — ${out.note}`)
  disposeTdxClient?.()
  process.exit(1)
}

// 逐源状态是**一次并集采集**的事实，所以从任一组读都一样
const anyStatus = out.entries.find((e) => e.naming !== null)?.naming?.sourceStatus ?? []
const board = anyStatus.find((s) => s.source === 'belong_board')
console.log(`[probe] as_of=${out.asOf} · 目标组数=${out.targetCount} · 模型调用=${out.llmCalls}`)
console.log('[probe] 逐源状态：')
for (const s of anyStatus) {
  console.log(`         ${s.source.padEnd(14)} ${s.status.padEnd(18)} produced=${s.produced}  ${s.detail}`)
}

let bad = 0
if (board === undefined) {
  console.error('  ❌ 没有 belong_board 的逐源状态（源没被记状态 = 静默缺席）')
  bad += 1
} else if (board.status !== 'used') {
  console.error(`  ❌ belong_board 状态 = ${board.status}（真机应当 used —— 这就是 2026-09-14 那类事故的指纹）`)
  bad += 1
} else {
  console.log(`  ✅ belong_board 采到素材 ${board.produced} 条（字段名契约成立）`)
}

console.log('[probe] 每组的结构标签：')
for (const e of out.entries) {
  const s = e.structure
  const members = e.members.map((m) => m.name).slice(0, 5).join('/')
  const ind = s.industry.slice(0, 3).map((t) => `${t.name}:${t.n}`).join(' ')
  const con = s.concept.slice(0, 3).map((t) => `${t.name}:${t.n}`).join(' ')
  console.log(
    `  #${String(e.classId).padStart(2)} ${String(e.size).padStart(2)}只  标签=${(s.label || '（空）').padEnd(14)} ` +
      `覆盖=${s.covered}/${s.total} 口径=${s.basis.padEnd(8)} 行业[${ind}] 概念[${con}]  ${members}`,
  )
  // 结构标签必须与成员板块数据自洽：字非空 ⇒ 必须 ≥2 只共享（covered 至少 2）
  if (s.label !== '' && s.covered < 2) {
    console.error(`      ❌ 标签非空但覆盖只有 ${s.covered}（阈值是 ≥2 只共享）`)
    bad += 1
  }
  if (s.label === '' && e.memberCount > 0) {
    console.log('      ℹ️ 这一组没有共享板块词（成员各挂各的）—— 空标签是正确结果')
  }
}

const labelled = out.entries.filter((e) => e.structure.label !== '').length
console.log(`\n[probe] 有结构标签的组：${labelled}/${out.entries.length}`)
console.log(bad === 0 ? '[probe] 全部通过 ✅' : `[probe] ${bad} 项异常 ❌`)
disposeTdxClient?.()
process.exit(bad === 0 ? 0 : 1)
