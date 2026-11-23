import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import { assetUrl, dirname, isExternalUrl, resolvePath } from './utils.js'

function markPlugin(md) {
  md.inline.ruler.before('emphasis', 'mark', (state, silent) => {
    const start = state.pos
    if (state.src.charCodeAt(start) !== 0x3d || state.src.charCodeAt(start + 1) !== 0x3d) return false
    const end = state.src.indexOf('==', start + 2)
    if (end === -1 || end === start + 2) return false
    if (!silent) {
      state.push('mark_open', 'mark', 1)
      const token = state.push('text', '', 0)
      token.content = state.src.slice(start + 2, end)
      state.push('mark_close', 'mark', -1)
    }
    state.pos = end + 2
    return true
  })
  md.renderer.rules.mark_open = () => '<mark>'
  md.renderer.rules.mark_close = () => '</mark>'
}

const HL_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'gray']

function hlBlockPlugin(md) {
  md.block.ruler.before(
    'fence',
    'hl_block',
    (state, startLine, endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false
      const start = state.bMarks[startLine] + state.tShift[startLine]
      const max = state.eMarks[startLine]
      const match = /^:::\s*hl(?:[\s-]+([a-zA-Z]+))?\s*$/.exec(state.src.slice(start, max).trim())
      if (!match) return false

      let closeLine = -1
      for (let line = startLine + 1; line < endLine; line += 1) {
        const from = state.bMarks[line] + state.tShift[line]
        const to = state.eMarks[line]
        if (/^:::\s*$/.test(state.src.slice(from, to).trim())) {
          closeLine = line
          break
        }
      }
      if (closeLine === -1) return false
      if (silent) return true

      const colorName = (match[1] || '').toLowerCase()
      const color = HL_COLORS.includes(colorName) ? colorName : 'yellow'

      const open = state.push('hl_block_open', 'div', 1)
      open.block = true
      open.attrSet('class', `hl-block hl-${color}`)

      const oldParent = state.parentType
      const oldLineMax = state.lineMax
      state.parentType = 'hl_block'
      state.lineMax = closeLine
      state.md.block.tokenize(state, startLine + 1, closeLine)
      state.parentType = oldParent
      state.lineMax = oldLineMax

      const close = state.push('hl_block_close', 'div', -1)
      close.block = true
      state.line = closeLine + 1
      return true
    },
    { alt: ['paragraph'] }
  )
}

function taskListPlugin(md) {
  md.core.ruler.after('inline', 'task-lists', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i].type !== 'inline') continue
      const paragraph = tokens[i - 1]
      const listItem = tokens[i - 2]
      if (!paragraph || paragraph.type !== 'paragraph_open') continue
      if (!listItem || listItem.type !== 'list_item_open') continue
      const match = /^\[([ xX])\]\s+/.exec(tokens[i].content)
      if (!match) continue
      const checked = match[1].toLowerCase() === 'x'
      const checkbox = new state.Token('html_inline', '', 0)
      checkbox.content = `<input type="checkbox" class="task-checkbox" disabled${checked ? ' checked' : ''}>`
      tokens[i].content = tokens[i].content.slice(match[0].length)
      const firstText = tokens[i].children.find((token) => token.type === 'text')
      if (firstText) firstText.content = firstText.content.replace(/^\[[ xX]\]\s+/, '')
      tokens[i].children.unshift(checkbox)
      listItem.attrJoin('class', 'task-item')
      if (checked) listItem.attrJoin('class', 'task-done')
    }
  })
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* 忽略高亮失败 */
      }
    }
    return md.utils.escapeHtml(code)
  }
})

md.use(markPlugin).use(taskListPlugin).use(hlBlockPlugin)

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const info = token.info ? token.info.trim() : ''
  const lang = info.split(/\s+/)[0] || ''
  let highlighted = ''
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value
    } catch {
      highlighted = md.utils.escapeHtml(token.content)
    }
  } else {
    highlighted = md.utils.escapeHtml(token.content)
  }
  const langLabel = lang || 'text'
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${md.utils.escapeHtml(
    langLabel
  )}</span><button class="code-copy" type="button" data-code-copy>复制</button></div><pre><code class="language-${md.utils.escapeHtml(
    langLabel
  )}">${highlighted}</code></pre></div>`
}

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = token.attrGet('src') || ''
  token.attrSet('src', toDisplaySrc(src, env.docPath))
  token.attrSet('loading', 'lazy')
  return self.renderToken(tokens, idx, options)
}

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, idx, options)
}

md.renderer.rules.table_open = () => '<div class="table-wrap"><table>'
md.renderer.rules.table_close = () => '</table></div>'

md.renderer.rules.hr = () => '<hr class="md-hr">'

function toDisplaySrc(src, docPath) {
  if (!src) return src
  if (isExternalUrl(src)) return src
  if (src.startsWith('#')) return src
  const clean = src.split(/[?#]/)[0]
  if (!docPath) return clean
  const abs = resolvePath(dirname(docPath), clean)
  return assetUrl(abs)
}

export function renderMarkdown(content, docPath = '') {
  return md.render(String(content || ''), { docPath })
}

export function renderMarkdownTo(element, content, docPath = '') {
  element.innerHTML = renderMarkdown(content, docPath)
  return element
}

export async function inlineImages(container) {
  const images = Array.from(container.querySelectorAll('img'))
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src') || ''
      if (!src.startsWith('kbasset:')) return
      try {
        const response = await fetch(src)
        if (!response.ok) return
        const blob = await response.blob()
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.readAsDataURL(blob)
        })
        img.setAttribute('src', dataUrl)
      } catch {
        /* 图片读取失败时保留原地址 */
      }
    })
  )
}

export { md }
