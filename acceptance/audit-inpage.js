(() => {
  const out = {}
  const cs = (el) => getComputedStyle(el)
  const sizes = {}, weights = {}, radii = {}, fonts = {}
  for (const el of document.querySelectorAll('.dsh-stock *')) {
    if (!el.textContent || el.children.length > 0) continue
    const s = cs(el)
    if (s.display === 'none' || s.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    sizes[s.fontSize] = (sizes[s.fontSize] || 0) + 1
    weights[s.fontWeight] = (weights[s.fontWeight] || 0) + 1
    const fam = s.fontFamily.split(',')[0]
    fonts[fam] = (fonts[fam] || 0) + 1
  }
  for (const el of document.querySelectorAll('.dsh-stock *')) {
    const s = cs(el)
    if (s.borderTopLeftRadius !== '0px') radii[s.borderTopLeftRadius] = (radii[s.borderTopLeftRadius] || 0) + 1
  }
  const numeric = []
  let numericTotal = 0, numericTabular = 0
  for (const el of document.querySelectorAll('.dsh-stock .dc-num, .dsh-stock .dc-row-side, .dsh-stock td, .dsh-stock .dc-kv > :last-child, .dsh-stock .dc-fact')) {
    const txt = (el.textContent || '').trim()
    if (!/^-?[0-9]+(\.[0-9]+)?%?$/.test(txt)) continue
    numericTotal++
    const s = cs(el)
    if (s.fontVariantNumeric.includes('tabular')) numericTabular++
    if (numeric.length < 10) numeric.push({ cls: String(el.className).slice(0, 40), txt: txt.slice(0, 12), num: s.fontVariantNumeric, family: s.fontFamily.split(',')[0] })
  }
  const shell = document.querySelector('.dsh-stock')
  const cards = Array.prototype.slice.call(document.querySelectorAll('.dc-card'), 0, 6).map((c) => {
    const s = cs(c)
    return { bg: s.backgroundColor, border: s.borderTopColor, radius: s.borderTopLeftRadius, shadow: s.boxShadow }
  })
  let cssText = ''
  for (const ss of Array.prototype.slice.call(document.styleSheets)) {
    try { for (const r of Array.prototype.slice.call(ss.cssRules)) cssText += r.cssText + '\n' } catch (e) { cssText += '' }
  }
  const has = (re) => re.test(cssText)
  const hits = {}
  for (const el of document.querySelectorAll('.dsh-stock button, .dsh-stock .dc-nav-item, .dsh-stock .dc-chip, .dsh-stock .dc-row')) {
    const r = el.getBoundingClientRect()
    if (r.height === 0) continue
    const k = Math.round(r.height)
    hits[k] = (hits[k] || 0) + 1
  }
  const tagTexts = {}
  for (const el of document.querySelectorAll('.dsh-stock .dc-tag')) {
    const s = cs(el)
    tagTexts[s.backgroundColor + ' / ' + s.color] = (tagTexts[s.backgroundColor + ' / ' + s.color] || 0) + 1
  }
  out.shellBg = shell ? cs(shell).backgroundColor : null
  out.shellFont = shell ? cs(shell).fontFamily.split(',')[0] : null
  out.sizes = sizes
  out.weights = weights
  out.fonts = fonts
  out.radii = radii
  out.cards = cards
  out.numeric = { total: numericTotal, tabular: numericTabular, sample: numeric }
  out.tags = tagTexts
  out.interactions = {
    navHover: has(/\.dc-nav-item:hover/),
    rowHover: has(/\.dc-row:hover/),
    cardHover: has(/\.dc-card:hover/),
    focusVisible: has(/:focus-visible/),
    transition: has(/transition:/),
    reducedMotion: has(/prefers-reduced-motion/),
    shadow: has(/box-shadow/),
  }
  out.hitHeights = hits
  return out
})()