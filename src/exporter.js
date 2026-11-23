import { inlineImages, renderMarkdown } from './preview.js'
import { assetUrl, dirname, isExternalUrl, resolvePath, stripMdExtension, escapeHtml } from './utils.js'

function collectDocs(nodes, folders = [], out = []) {
  for (const node of nodes) {
    if (node.type === 'dir') {
      collectDocs(node.children, [...folders, node.name], out)
    } else {
      out.push({
        path: node.path,
        name: node.name,
        title: stripMdExtension(node.name),
        folders
      })
    }
  }
  return out
}

export function countDocs(nodes) {
  return collectDocs(nodes).length
}

async function toDataUrl(src, docPath) {
  if (!src || isExternalUrl(src) || src.startsWith('#')) return src
  const clean = src.split(/[?#]/)[0]
  const abs = resolvePath(dirname(docPath), clean)
  try {
    const response = await fetch(assetUrl(abs))
    if (!response.ok) return src
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  } catch {
    return src
  }
}

async function embedMarkdownImages(markdown, docPath) {
  const cache = new Map()
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g
  let result = ''
  let lastIndex = 0
  let match
  while ((match = pattern.exec(markdown))) {
    result += markdown.slice(lastIndex, match.index)
    const alt = match[1]
    const rawSrc = match[2]
    let resolved = cache.get(rawSrc)
    if (resolved === undefined) {
      resolved = await toDataUrl(rawSrc, docPath)
      cache.set(rawSrc, resolved)
    }
    result += `![${alt}](${resolved})`
    lastIndex = pattern.lastIndex
  }
  result += markdown.slice(lastIndex)
  return result
}

export async function buildMarkdownBundle(tree, rootName) {
  const docs = collectDocs(tree)
  const sections = []
  for (const doc of docs) {
    const { content } = await window.api.readFile(doc.path)
    const body = content.trim()
    const hasH1 = /^\s{0,3}#\s+/m.test(body)
    const heading = hasH1 ? '' : `# ${doc.title}\n\n`
    const folderLine = doc.folders.length ? `> 目录：${doc.folders.join(' / ')}\n\n` : ''
    const withImages = await embedMarkdownImages(body, doc.path)
    sections.push(`${heading}${folderLine}${withImages}`)
  }
  return `# ${rootName}\n\n> 导出时间：${new Date().toLocaleString('zh-CN')} · 共 ${docs.length} 篇文档\n\n---\n\n${sections.join(
    '\n\n---\n\n'
  )}\n`
}

export async function buildHtmlBundle(tree, rootName) {
  const docs = collectDocs(tree)
  const sections = []
  const toc = []

  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i]
    const { content } = await window.api.readFile(doc.path)
    const container = document.createElement('div')
    container.innerHTML = renderMarkdown(content, doc.path)
    await inlineImages(container)
    const id = `doc-${i + 1}`
    toc.push({ id, title: doc.title, folder: doc.folders.join(' / ') || '根目录' })
    sections.push(`<section class="doc" id="${id}">
  <div class="doc-head">
    <span class="doc-index">${String(i + 1).padStart(2, '0')}</span>
    <div>
      <h2 class="doc-title">${escapeHtml(doc.title)}</h2>
      <div class="doc-path">${escapeHtml(doc.folders.join(' / ') || '根目录')}</div>
    </div>
  </div>
  <div class="markdown-body">${container.innerHTML}</div>
</section>`)
  }

  const tocHtml = toc
    .map(
      (item) =>
        `<li><a href="#${item.id}"><span class="toc-title">${escapeHtml(item.title)}</span><span class="toc-folder">${escapeHtml(
          item.folder
        )}</span></a></li>`
    )
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(rootName)} · 知识库</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<header class="cover">
  <div class="cover-mark">M</div>
  <h1>${escapeHtml(rootName)}</h1>
  <p class="cover-sub">Markdown 知识库合集 · 共 ${docs.length} 篇文档</p>
  <p class="cover-time">导出于 ${new Date().toLocaleString('zh-CN')}</p>
</header>
<nav class="toc">
  <h2>目录</h2>
  <ol>${tocHtml}</ol>
</nav>
<main>${sections.join('\n')}</main>
<footer class="export-foot">由 灵犀文档 导出</footer>
</body>
</html>`
}

const EXPORT_CSS = `
:root {
  --text: #1d2129;
  --text-2: #5c6370;
  --text-3: #9199a6;
  --border: #e6e8ee;
  --bg-sub: #f7f8fa;
  --accent: #0a9f6d;
  --code-bg: #f8f9fb;
  --inline-code-bg: #f1f3f6;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  padding: 0 24px 80px;
  background: #fff;
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
  font-size: 15.5px;
  line-height: 1.85;
  -webkit-font-smoothing: antialiased;
}
.cover {
  max-width: 860px;
  margin: 0 auto;
  padding: 78px 0 58px;
  border-bottom: 1px solid var(--border);
}
.cover-mark {
  width: 56px; height: 56px; border-radius: 14px;
  background: linear-gradient(140deg, #12b47c, #07835b);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-family: Georgia, serif; font-size: 27px; font-weight: 700; margin-bottom: 24px;
}
.cover h1 { margin: 0 0 10px; font-size: 38px; letter-spacing: -0.5px; }
.cover-sub { margin: 0 0 6px; color: var(--text-2); font-size: 16px; }
.cover-time { margin: 0; color: var(--text-3); font-size: 13px; }
.toc { max-width: 860px; margin: 40px auto 0; padding: 24px 26px; background: var(--bg-sub); border-radius: 14px; }
.toc h2 { margin: 0 0 14px; font-size: 15px; letter-spacing: 0.4px; color: var(--text-2); }
.toc ol { margin: 0; padding: 0; list-style: none; counter-reset: toc; }
.toc li { counter-increment: toc; border-bottom: 1px dashed var(--border); }
.toc li:last-child { border-bottom: none; }
.toc a { display: flex; align-items: baseline; gap: 10px; padding: 9px 0; color: var(--text); text-decoration: none; }
.toc a::before { content: counter(toc, decimal-leading-zero); font-family: "SF Mono", Menlo, monospace; font-size: 11px; color: var(--text-3); }
.toc a:hover .toc-title { color: var(--accent); }
.toc-title { font-size: 14px; }
.toc-folder { margin-left: auto; font-size: 11.5px; color: var(--text-3); }
main { max-width: 860px; margin: 0 auto; }
.doc { padding-top: 56px; }
.doc-head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 10px; }
.doc-index { font-family: "SF Mono", Menlo, monospace; font-size: 12px; color: var(--accent); padding-top: 8px; }
.doc-title { margin: 0; font-size: 26px; line-height: 1.35; }
.doc-path { margin-top: 4px; font-size: 12px; color: var(--text-3); }
.markdown-body { margin-top: 18px; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin: 1.5em 0 0.55em; line-height: 1.4; }
.markdown-body h1 { font-size: 1.7em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.markdown-body h2 { font-size: 1.4em; padding-bottom: 0.24em; border-bottom: 1px solid var(--border); }
.markdown-body h3 { font-size: 1.18em; }
.markdown-body p { margin: 0 0 0.95em; }
.markdown-body a { color: #0a7fb5; text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body ul, .markdown-body ol { margin: 0 0 0.95em; padding-left: 1.55em; }
.markdown-body li { margin: 0.22em 0; }
.markdown-body .task-item { list-style: none; margin-left: -1.4em; }
.markdown-body .task-checkbox { margin-right: 8px; accent-color: var(--accent); }
.markdown-body .task-done > p { text-decoration: line-through; color: var(--text-3); }
.markdown-body blockquote { margin: 0 0 1em; padding: 10px 16px; border-left: 3px solid var(--accent); background: rgba(10, 159, 109, 0.07); border-radius: 0 8px 8px 0; color: var(--text-2); }
.markdown-body blockquote > :last-child { margin-bottom: 0; }
.markdown-body .hl-block { margin: 0 0 1em; padding: 14px 18px; border-radius: 10px; border: 1px solid transparent; }
.markdown-body .hl-block > :first-child { margin-top: 0; }
.markdown-body .hl-block > :last-child { margin-bottom: 0; }
.markdown-body .hl-yellow { background: #fff8e0; border-color: #f3e0a4; }
.markdown-body .hl-green { background: #eaf7ef; border-color: #bee3cc; }
.markdown-body .hl-blue { background: #eaf3ff; border-color: #c2dcf7; }
.markdown-body .hl-pink { background: #fdeef3; border-color: #f6cadb; }
.markdown-body .hl-purple { background: #f2edfd; border-color: #dbcdf6; }
.markdown-body .hl-gray { background: #f2f4f7; border-color: #dde2ea; }
.markdown-body code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.86em; background: var(--inline-code-bg); padding: 0.15em 0.4em; border-radius: 5px; color: #b3541e; }
.markdown-body pre { margin: 0; padding: 14px 16px; overflow: auto; background: var(--code-bg); font-size: 13px; line-height: 1.7; }
.markdown-body pre code { background: none; padding: 0; color: var(--text); font-size: 12.8px; }
.markdown-body .code-block { margin: 0 0 1em; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--code-bg); }
.markdown-body .code-head { display: flex; justify-content: space-between; padding: 5px 13px; background: var(--bg-sub); border-bottom: 1px solid var(--border); font-size: 11.5px; color: var(--text-3); font-family: "SF Mono", Menlo, monospace; }
.markdown-body .code-copy { display: none; }
.markdown-body .table-wrap { overflow-x: auto; margin: 0 0 1em; border: 1px solid var(--border); border-radius: 9px; }
.markdown-body table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
.markdown-body th, .markdown-body td { border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); padding: 8px 12px; text-align: left; }
.markdown-body th { background: var(--bg-sub); }
.markdown-body tr:last-child td { border-bottom: none; }
.markdown-body th:last-child, .markdown-body td:last-child { border-right: none; }
.markdown-body mark { background: #ffe9a3; padding: 0 2px; border-radius: 3px; }
.markdown-body img { max-width: 100%; border-radius: 8px; }
.markdown-body hr { border: none; border-top: 1px solid var(--border); margin: 1.7em 0; }
.hljs-comment, .hljs-quote { color: #9aa0aa; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-operator { color: #a626a4; }
.hljs-string, .hljs-regexp, .hljs-attribute, .hljs-attr { color: #3f8f3f; }
.hljs-number, .hljs-literal, .hljs-bullet, .hljs-symbol { color: #b76b01; }
.hljs-title, .hljs-section, .hljs-name { color: #4078f2; }
.hljs-type, .hljs-class .hljs-title { color: #c18401; }
.export-foot { max-width: 860px; margin: 70px auto 0; padding-top: 18px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-3); text-align: center; }
@media print {
  body { padding: 0; }
  .cover { padding-top: 20px; }
  .doc { page-break-before: always; }
  .doc:first-of-type { page-break-before: avoid; }
  .code-copy { display: none; }
  a { color: inherit; }
}
@media (max-width: 720px) {
  .cover { padding-top: 44px; }
  .cover h1 { font-size: 30px; }
  .toc-folder { display: none; }
}
`
