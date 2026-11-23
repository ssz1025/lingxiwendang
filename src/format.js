/**
 * 轻量 Markdown 排版器：规范标题、列表、引用、空行与分隔线。
 * 只调整块结构，不改动代码块与表格内容。
 */
export function formatMarkdown(source) {
  const text = String(source || '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return ''

  const lines = text.split('\n')
  const blocks = []
  let i = 0

  if (lines[0] && lines[0].trim() === '---') {
    let end = -1
    for (let j = 1; j < lines.length; j += 1) {
      const t = lines[j].trim()
      if (t === '---' || t === '...') {
        end = j
        break
      }
    }
    if (end > 0) {
      blocks.push({ type: 'raw', lines: lines.slice(0, end + 1) })
      i = end + 1
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[2][0]
      const fenceLength = fenceMatch[2].length
      const body = [line.replace(/\s+$/, '')]
      i += 1
      while (i < lines.length) {
        const current = lines[i]
        body.push(current.replace(/\s+$/, ''))
        const closeMatch = new RegExp(`^\\s*${marker}{${fenceLength},}\\s*$`).test(current)
        i += 1
        if (closeMatch) break
      }
      blocks.push({ type: 'raw', lines: body })
      continue
    }

    if (/^:::hl(?:[\s-]+[a-zA-Z]+)?\s*$/.test(line.trim())) {
      const body = [line.replace(/\s+$/, '')]
      i += 1
      while (i < lines.length) {
        const current = lines[i]
        body.push(current.replace(/\s+$/, ''))
        i += 1
        if (/^:::\s*$/.test(current.trim())) break
      }
      blocks.push({ type: 'raw', lines: body })
      continue
    }

    if (/^\s{0,3}(#{1,6})(\s|$)/.test(line)) {
      const match = /^\s{0,3}(#{1,6})\s*(.*?)\s*#*\s*$/.exec(line)
      blocks.push({ type: 'heading', lines: [`${match[1]} ${match[2].trim()}`.trim()] })
      i += 1
      continue
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ type: 'raw', lines: ['---'] })
      i += 1
      continue
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const body = []
      while (i < lines.length) {
        const current = lines[i]
        const isItem = /^\s*([-*+]|\d+[.)])\s+/.test(current)
        const isContinuation = /^\s{2,}\S/.test(current) && body.length > 0
        if (!isItem && !isContinuation) break
        if (isItem) {
          const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(current)
          const indent = match[1].replace(/\t/g, '  ')
          const marker = /^[-*+]$/.test(match[2]) ? '-' : match[2].replace(')', '.')
          body.push(`${indent}${marker} ${match[3].trim()}`)
        } else {
          body.push(current.replace(/\s+$/, ''))
        }
        i += 1
      }
      blocks.push({ type: 'list', lines: body })
      continue
    }

    if (/^\s*>/.test(line)) {
      const body = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^(\s*>\s?)\s*/, '$1'))
        i += 1
      }
      blocks.push({ type: 'quote', lines: body })
      continue
    }

    if (isTableStart(lines, i)) {
      const body = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        body.push(lines[i].replace(/\s+$/, ''))
        i += 1
      }
      blocks.push({ type: 'table', lines: body })
      continue
    }

    const body = []
    while (i < lines.length) {
      const current = lines[i]
      if (!current.trim()) break
      if (isSpecialStart(lines, i, blocks.length === 0)) break
      body.push(current.replace(/\s+$/, ''))
      i += 1
    }
    if (!body.length) {
      body.push(line.replace(/\s+$/, ''))
      i += 1
    }
    blocks.push({ type: 'paragraph', lines: body })
  }

  const output = blocks.map((block) => block.lines.join('\n')).join('\n\n')
  return `${output.trim()}\n`
}

function isSpecialStart(lines, i, isFirst) {
  const line = lines[i]
  if (/^\s*`{3,}/.test(line) || /^\s*~{3,}/.test(line)) return true
  if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) return true
  if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) return true
  if (/^\s*>/.test(line)) return true
  if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) return true
  if (/^:::hl(?:[\s-]+[a-zA-Z]+)?\s*$/.test(line.trim())) return true
  if (isTableStart(lines, i)) return true
  if (isFirst && i === 0 && line.trim() === '---') return true
  return false
}

function isTableStart(lines, i) {
  const line = lines[i]
  const next = lines[i + 1]
  if (!line || !next) return false
  if (!line.includes('|')) return false
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(next) && next.includes('-')
}
