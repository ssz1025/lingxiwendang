import './styles.css'
import { mountIcons, icon } from './icons.js'
import { createEditor } from './editor.js'
import { renderMarkdown } from './preview.js'
import { formatMarkdown } from './format.js'
import { buildHtmlBundle, buildMarkdownBundle, countDocs } from './exporter.js'
import {
  basename,
  blobToDataUrl,
  countWords,
  dirname,
  escapeHtml,
  formatTime,
  resolvePath,
  stripMdExtension
} from './utils.js'

const $ = (selector) => document.querySelector(selector)

const els = {
  app: $('#app'),
  kbName: $('#kbName'),
  rootPath: $('#rootPath'),
  searchInput: $('#searchInput'),
  searchClear: $('#searchClear'),
  searchPanel: $('#searchPanel'),
  searchResults: $('#searchResults'),
  searchCount: $('#searchCount'),
  fileTree: $('#fileTree'),
  treeEmpty: $('#treeEmpty'),
  breadcrumb: $('#breadcrumb'),
  docTitleRow: $('#docTitleRow'),
  docTitle: $('#docTitle'),
  saveState: $('#saveState'),
  content: $('#content'),
  editor: $('#editor'),
  preview: $('#preview'),
  previewPane: $('#previewPane'),
  resizer: $('#paneResizer'),
  indexView: $('#indexView'),
  indexLogo: $('#indexLogo'),
  indexTitle: $('#indexTitle'),
  indexPath: $('#indexPath'),
  indexMeta: $('#indexMeta'),
  indexRecentSection: $('#indexRecentSection'),
  indexRecentList: $('#indexRecentList'),
  indexDirsSection: $('#indexDirsSection'),
  indexDirs: $('#indexDirs'),
  indexDirCount: $('#indexDirCount'),
  indexDocsSection: $('#indexDocsSection'),
  indexDocs: $('#indexDocs'),
  indexDocCount: $('#indexDocCount'),
  indexEmpty: $('#indexEmpty'),
  kbListView: $('#kbListView'),
  kbList: $('#kbList'),
  kbListMeta: $('#kbListMeta'),
  kbListCount: $('#kbListCount'),
  kbSideList: $('#kbSideList'),
  kbSideCount: $('#kbSideCount'),
  viewToggle: $('#viewToggle'),
  wordCount: $('#wordCount'),
  lineCount: $('#lineCount'),
  readTime: $('#readTime'),
  statusMsg: $('#statusMsg'),
  aiPanel: $('#aiPanel'),
  aiContext: $('#aiContext'),
  aiQuick: $('#aiQuick'),
  aiMessages: $('#aiMessages'),
  aiInput: $('#aiInput'),
  aiUseKb: $('#aiUseKb'),
  aiKbStatus: $('#aiKbStatus'),
  btnAiSend: $('#btnAiSend'),
  modalRoot: $('#modalRoot'),
  contextMenu: $('#contextMenu'),
  toast: $('#toast')
}

const AI_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'moonshot', name: 'Moonshot 月之暗面', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'ollama', name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { id: 'custom', name: '自定义接口', baseUrl: '', model: '' }
]

const AI_QUICK_ACTIONS = [
  {
    id: 'polish',
    label: '润色',
    build: (content, selected) =>
      `请润色下面${selected ? '选中的' : ''} Markdown 内容，保持原有结构、语言与 Markdown 格式，让表达更清晰、准确、专业。只输出润色后的内容，不要任何解释。\n\n${content}`
  },
  {
    id: 'continue',
    label: '续写',
    build: (content) =>
      `请阅读下面的 Markdown 文档，并按相同的主题、语气与格式继续续写 300 字左右的内容。只输出续写部分，不要重复原文。\n\n${content}`
  },
  {
    id: 'summary',
    label: '总结',
    build: (content) =>
      `请用简明的中文总结下面的文档，输出 Markdown 要点列表，不超过 8 条。\n\n${content}`
  },
  {
    id: 'outline',
    label: '生成大纲',
    build: (content) =>
      `请为下面的内容生成一份层次清晰的 Markdown 大纲，使用多级标题与列表，只输出大纲。\n\n${content}`
  },
  {
    id: 'translate',
    label: '译为英文',
    build: (content) =>
      `请把下面的 Markdown 内容翻译成地道的英文，保留 Markdown 结构与代码块，只输出译文。\n\n${content}`
  }
]

const state = {
  config: null,
  platform: 'darwin',
  root: '',
  tree: [],
  expanded: new Set(JSON.parse(localStorage.getItem('moji:expanded') || '[]')),
  recentDocs: JSON.parse(localStorage.getItem('moji:recent') || '[]'),
  currentPath: null,
  currentTitle: '',
  savedContent: '',
  dirty: false,
  viewMode: localStorage.getItem('moji:viewMode') || 'split',
  theme: localStorage.getItem('moji:theme') || 'light',
  aiOpen: false,
  aiMessages: [],
  aiUseKb: localStorage.getItem('moji:useKb') !== '0',
  aiStreaming: false,
  aiRequestId: null,
  aiStreamingId: null,
  searchQuery: '',
  selectedDir: '',
  indexOpen: false,
  indexPath: '',
  kbListOpen: false,
  kbs: [],
  sidebarCollapsed: localStorage.getItem('moji:sidebarCollapsed') === '1',
  split: Number(localStorage.getItem('moji:split') || 50)
}

let editor = null
let toastTimer = null
let saveTimer = null
let searchTimer = null
let previewTimer = null
let searchSeq = 0
let msgSeq = 0
let modalState = null

/* --------------------------------- 工具函数 -------------------------------- */

function errText(error) {
  const message = error?.message || String(error || '未知错误')
  const cleaned = message
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^TypeError:\s*/, '')
    .replace(/^Error:\s*/, '')
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(cleaned)) {
    return '无法连接到 AI 服务，请检查接口地址与网络'
  }
  return cleaned
}

function isPathInside(child, parent) {
  if (!child || !parent) return false
  const norm = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const a = norm(child)
  const b = norm(parent)
  return a === b || a.startsWith(`${b}/`)
}

function highlightText(text, query) {
  const index = String(text).toLowerCase().indexOf(String(query).toLowerCase())
  if (index === -1) return escapeHtml(text)
  return `${escapeHtml(text.slice(0, index))}<mark>${escapeHtml(
    text.slice(index, index + query.length)
  )}</mark>${escapeHtml(text.slice(index + query.length))}`
}

function toast(message, type = 'success', action = null) {
  clearTimeout(toastTimer)
  const el = els.toast
  el.className = `toast ${type === 'error' ? 'error' : ''}`
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${escapeHtml(message)}</span>`
  if (action) {
    const button = document.createElement('button')
    button.textContent = action.label
    button.onclick = () => {
      action.onClick()
      hideToast()
    }
    el.appendChild(button)
  }
  el.classList.remove('hidden')
  toastTimer = setTimeout(hideToast, action ? 6000 : 2600)
}

function hideToast() {
  els.toast.classList.add('hidden')
}

function persistExpanded() {
  localStorage.setItem('moji:expanded', JSON.stringify([...state.expanded]))
}

function rememberRecent(path, title) {
  state.recentDocs = [
    { path, title, at: Date.now() },
    ...state.recentDocs.filter((item) => item && item.path !== path)
  ].slice(0, 8)
  localStorage.setItem('moji:recent', JSON.stringify(state.recentDocs))
  renderRecents()
}

function updateAiContext() {
  if (!els.aiContext) return
  const kb = state.aiUseKb ? '知识库检索已开启' : '未使用知识库'
  if (!state.currentPath) {
    els.aiContext.textContent = `灵犀知识库 · ${kb}`
    return
  }
  const selection = editor.getSelection()
  els.aiContext.textContent = selection.text.trim()
    ? `${state.currentTitle} · 已选中 ${selection.text.trim().length} 字`
    : `${state.currentTitle} · ${kb}`
}

/* --------------------------------- 主题/视图 -------------------------------- */

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light'
  state.theme = next
  document.documentElement.dataset.theme = next
  const button = $('#btnTheme')
  if (button) button.innerHTML = icon(next === 'dark' ? 'sun' : 'moon')
  localStorage.setItem('moji:theme', next)
}

async function toggleTheme() {
  const next = state.theme === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  try {
    state.config = await window.api.setConfig({ theme: next })
  } catch {
    /* 忽略持久化失败 */
  }
}

function applySidebarCollapsed(collapsed) {
  state.sidebarCollapsed = Boolean(collapsed)
  els.app.classList.toggle('sidebar-collapsed', state.sidebarCollapsed)
  const expandBtn = $('#btnExpandSidebar')
  if (expandBtn) expandBtn.classList.toggle('hidden', !state.sidebarCollapsed)
  localStorage.setItem('moji:sidebarCollapsed', state.sidebarCollapsed ? '1' : '0')
}

function setViewMode(mode, { persist = true } = {}) {
  if (!['split', 'edit', 'preview'].includes(mode)) return
  state.viewMode = mode
  els.content.classList.remove('mode-split', 'mode-edit', 'mode-preview')
  els.content.classList.add(`mode-${mode}`)
  els.viewToggle.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode)
  })
  if (persist) localStorage.setItem('moji:viewMode', mode)
  updatePreview()
}

function togglePreview() {
  if (!state.currentPath) return
  setViewMode(state.viewMode === 'edit' ? 'split' : 'edit')
}

function applySplit() {
  const value = Math.min(80, Math.max(24, Number.isFinite(state.split) ? state.split : 50))
  els.content.style.setProperty('--split', `${value}%`)
}

function setupResizer() {
  let dragging = false
  els.resizer.addEventListener('mousedown', (event) => {
    if (state.viewMode !== 'split') return
    dragging = true
    els.resizer.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    event.preventDefault()
  })
  document.addEventListener('mousemove', (event) => {
    if (!dragging) return
    const rect = els.content.getBoundingClientRect()
    const percent = Math.min(80, Math.max(24, ((event.clientX - rect.left) / rect.width) * 100))
    state.split = percent
    els.content.style.setProperty('--split', `${percent}%`)
  })
  document.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    els.resizer.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem('moji:split', String(Math.round(state.split)))
  })
}

/* --------------------------------- 目录树 --------------------------------- */

function filterTree(nodes, query) {
  return nodes
    .map((node) => {
      if (node.type === 'dir') {
        const children = filterTree(node.children || [], query)
        if (node.name.toLowerCase().includes(query) || children.length) {
          return { ...node, children }
        }
        return null
      }
      return node.title.toLowerCase().includes(query) || node.name.toLowerCase().includes(query)
        ? node
        : null
    })
    .filter(Boolean)
}

function renderTreeNodes(nodes, depth) {
  return nodes
    .map((node) => {
      const pathAttr = escapeHtml(node.path)
      if (node.type === 'dir') {
        const expanded = state.expanded.has(node.path) || Boolean(state.searchQuery)
        const selected = state.indexOpen && node.path === state.indexPath ? 'selected' : ''
        return `<div class="tree-row dir ${expanded ? 'expanded' : ''} ${selected}" data-path="${pathAttr}" data-type="dir" style="--depth:${depth}" title="${escapeHtml(
          node.name
        )}">
          <span class="tree-twisty">${icon('chevron-right')}</span>
          <span class="tree-icon">${icon(expanded ? 'folder-open' : 'folder')}</span>
          <span class="tree-name">${escapeHtml(node.name)}</span>
          <span class="tree-actions-hover"><button data-action="new-doc" data-path="${pathAttr}" title="在此新建文档">${icon(
            'file-plus'
          )}</button></span>
        </div>
        ${
          expanded
            ? `<div class="tree-children">${renderTreeNodes(node.children || [], depth + 1)}</div>`
            : ''
        }`
      }
      const active = node.path === state.currentPath ? 'active' : ''
      return `<div class="tree-row file ${active}" data-path="${pathAttr}" data-type="file" style="--depth:${depth}" title="${escapeHtml(
        `${node.title} · ${formatTime(node.mtime)}`
      )}">
        <span class="tree-twisty placeholder"></span>
        <span class="tree-icon">${icon('file-text')}</span>
        <span class="tree-name">${escapeHtml(node.title)}</span>
      </div>`
    })
    .join('')
}

function renderTree() {
  const query = state.searchQuery.toLowerCase()
  const nodes = query ? filterTree(state.tree, query) : state.tree
  els.fileTree.innerHTML = renderTreeNodes(nodes, 0)
  els.treeEmpty.classList.toggle('hidden', state.tree.length > 0)
  els.searchPanel.classList.toggle('hidden', !state.searchQuery)
}

async function refreshTree() {
  const data = await window.api.getTree()
  state.root = data.root
  state.tree = data.tree
  if (!state.selectedDir || !isPathInside(state.selectedDir, state.root)) {
    state.selectedDir = state.root
  }
  const kbLabel = basename(state.root) || '知识库'
  els.rootPath.textContent = kbLabel
  els.rootPath.title = state.root
  els.kbName.textContent = '灵犀文档'
  renderTree()
  if (state.indexOpen) {
    if (!isPathInside(state.indexPath, state.root)) state.indexPath = state.root
    renderIndex()
    updateIndexBreadcrumb()
  }
}

function toggleExpand(path) {
  if (state.expanded.has(path)) state.expanded.delete(path)
  else state.expanded.add(path)
  persistExpanded()
  renderTree()
}

function expandAncestors(filePath) {
  let dir = dirname(filePath)
  while (dir && isPathInside(dir, state.root) && dir !== state.root) {
    state.expanded.add(dir)
    const next = dirname(dir)
    if (next === dir) break
    dir = next
  }
  persistExpanded()
}

function currentTargetDir() {
  if (state.selectedDir && isPathInside(state.selectedDir, state.root)) return state.selectedDir
  if (state.currentPath) return dirname(state.currentPath)
  return state.root
}

/* ------------------------------- 知识库索引 ------------------------------- */

function findNode(nodePath, nodes = state.tree) {
  for (const node of nodes) {
    if (node.path === nodePath) return node
    if (node.type === 'dir') {
      const found = findNode(nodePath, node.children || [])
      if (found) return found
    }
  }
  return null
}

function countTreeDocs(node) {
  if (!node) return 0
  if (node.type === 'file') return 1
  return (node.children || []).reduce((sum, child) => sum + countTreeDocs(child), 0)
}

function latestTime(node) {
  if (!node) return 0
  if (node.type === 'file') return node.mtime || 0
  return (node.children || []).reduce((max, child) => Math.max(max, latestTime(child)), 0)
}

function indexRow({ type, path, name, desc = '', meta = '' }) {
  if (type === 'dir') {
    return `<button class="index-row" data-index-dir="${escapeHtml(path)}">
      <span class="index-row-icon dir">${icon('folder-open')}</span>
      <span class="index-row-main">
        <span class="index-row-name">${escapeHtml(name)}</span>
        <span class="index-row-desc">${escapeHtml(desc)}</span>
      </span>
      <span class="index-row-meta">${escapeHtml(meta)}</span>
      <span class="index-row-arrow">${icon('chevron-right')}</span>
    </button>`
  }
  return `<button class="index-row" data-index-file="${escapeHtml(path)}">
    <span class="index-row-icon">${icon('file-text')}</span>
    <span class="index-row-main">
      <span class="index-row-name">${escapeHtml(name)}</span>
    </span>
    <span class="index-row-meta">${escapeHtml(meta)}</span>
    <span class="index-row-arrow">${icon('chevron-right')}</span>
  </button>`
}

function renderIndex() {
  const dirPath = state.indexPath || state.root
  const isRoot = dirPath === state.root
  const node = isRoot ? null : findNode(dirPath)
  if (!isRoot && !node) {
    state.indexPath = state.root
    renderIndex()
    return
  }

  const children = isRoot ? state.tree : node.children || []
  const dirs = children.filter((child) => child.type === 'dir')
  const files = children.filter((child) => child.type === 'file')
  const totalDocs = isRoot
    ? dirs.reduce((sum, dir) => sum + countTreeDocs(dir), 0) + files.length
    : countTreeDocs(node)

  els.indexTitle.textContent = isRoot ? basename(state.root) || '灵犀知识库' : node.name
  els.indexTitle.title = els.indexTitle.textContent
  els.indexLogo.innerHTML = isRoot ? '灵' : icon('folder-open')
  els.indexLogo.classList.toggle('is-folder', !isRoot)
  els.indexPath.textContent = dirPath
  els.indexPath.title = dirPath
  els.indexMeta.textContent = isRoot
    ? `共 ${totalDocs} 篇文档 · ${dirs.length} 个文件夹`
    : `${totalDocs} 篇文档 · ${dirs.length} 个子文件夹`

  els.indexDirCount.textContent = dirs.length ? String(dirs.length) : ''
  els.indexDocCount.textContent = files.length ? String(files.length) : ''
  els.indexDirsSection.classList.toggle('hidden', !dirs.length)
  els.indexDocsSection.classList.toggle('hidden', !files.length)
  els.indexEmpty.classList.toggle('hidden', Boolean(dirs.length || files.length))
  els.indexDirs.innerHTML = dirs
    .map((dir) => {
      const docs = countTreeDocs(dir)
      return indexRow({
        type: 'dir',
        path: dir.path,
        name: dir.name,
        desc: docs ? `${docs} 篇文档` : '空文件夹',
        meta: formatTime(latestTime(dir))
      })
    })
    .join('')
  els.indexDocs.innerHTML = files
    .map((file) =>
      indexRow({ type: 'file', path: file.path, name: file.title, meta: formatTime(file.mtime) })
    )
    .join('')

  renderRecents()
  if (state.indexOpen) document.title = `${els.indexTitle.textContent} · 灵犀文档`
}

function updateIndexBreadcrumb() {
  const target = state.indexPath || state.root
  const chain = [{ label: basename(state.root) || '知识库', path: state.root }]
  let nodes = state.tree
  const relative =
    target === state.root
      ? []
      : target.slice(state.root.length).replace(/^[\\/]/, '').split(/[\\/]/).filter(Boolean)
  for (const segment of relative) {
    const next = (nodes || []).find((item) => item.type === 'dir' && item.name === segment)
    if (!next) break
    chain.push({ label: next.name, path: next.path })
    nodes = next.children || []
  }
  const chainHtml = chain
    .map((crumb, index) => {
      const isLast = index === chain.length - 1
      return isLast
        ? `<span class="crumb current" title="${escapeHtml(crumb.path)}">${escapeHtml(crumb.label)}</span>`
        : `<button class="crumb crumb-link" data-crumb-path="${escapeHtml(crumb.path)}" title="${
            escapeHtml(crumb.label)
          }">${escapeHtml(crumb.label)}</button>`
    })
    .join(icon('chevron-right'))
  els.breadcrumb.innerHTML =
    `<button class="crumb crumb-link" data-crumb-kb="1" title="知识库列表">知识库</button>` +
    icon('chevron-right') +
    chainHtml
}

function showIndex(dirPath, { expand = true } = {}) {
  const target = isPathInside(dirPath, state.root) ? dirPath : state.root
  hideKbList()
  state.indexPath = target === state.root || findNode(target) ? target : state.root
  state.indexOpen = true
  state.selectedDir = state.indexPath
  if (expand && state.indexPath !== state.root) {
    expandAncestors(state.indexPath)
    state.expanded.add(state.indexPath)
    persistExpanded()
  }
  els.indexView.classList.remove('hidden')
  els.docTitleRow.classList.add('hidden')
  updateStats('')
  renderIndex()
  updateIndexBreadcrumb()
  renderTree()
}

function hideIndex() {
  state.indexOpen = false
  els.indexView.classList.add('hidden')
}

/* ------------------------------- 知识库列表 ------------------------------- */

function samePath(a, b) {
  if (!a || !b) return false
  const norm = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

function renderKbList() {
  const kbs = state.kbs || []
  els.kbListMeta.textContent = `共 ${kbs.length} 个本地知识库`
  els.kbListCount.textContent = String(kbs.length)
  els.kbList.innerHTML = kbs
    .map((kb) => {
      const active = samePath(kb.path, state.root)
      const removeBtn =
        kbs.length > 1
          ? `<button class="icon-btn kb-remove" data-kb-remove="${escapeHtml(kb.path)}" title="从列表移除">${icon(
              'trash'
            )}</button>`
          : ''
      return `<div class="kb-card" data-kb-path="${escapeHtml(kb.path)}" role="button" tabindex="0">
        <span class="kb-card-icon">${icon('book-open')}</span>
        <span class="kb-card-main">
          <span class="kb-card-name">${escapeHtml(kb.name)}${
            active ? '<em class="kb-current">当前</em>' : ''
          }</span>
          <span class="kb-card-path">${escapeHtml(kb.path)}</span>
        </span>
        ${removeBtn}
      </div>`
    })
    .join('')
  renderKbSideList()
}

function renderKbSideList() {
  const kbs = state.kbs || []
  els.kbSideCount.textContent = String(kbs.length)
  els.kbSideList.innerHTML = kbs
    .map((kb) => {
      const active = samePath(kb.path, state.root)
      return `<button class="kb-side-item${active ? ' active' : ''}" data-kb-side="${escapeHtml(
        kb.path
      )}" title="${escapeHtml(kb.path)}">
        <span class="kb-side-icon">${icon('book-open')}</span>
        <span class="kb-side-name">${escapeHtml(kb.name)}</span>
      </button>`
    })
    .join('')
}

function showKbList() {
  hideIndex()
  state.kbListOpen = true
  els.app.classList.add('kb-home')
  els.docTitleRow.classList.add('hidden')
  els.kbListView.classList.remove('hidden')
  updateStats('')
  renderKbList()
  els.breadcrumb.innerHTML = `<span class="crumb current">知识库</span>`
  document.title = '知识库 · 灵犀文档'
}

function hideKbList() {
  state.kbListOpen = false
  els.app.classList.remove('kb-home')
  els.kbListView.classList.add('hidden')
}

function resetDocState() {
  cancelSave()
  state.currentPath = null
  state.currentTitle = ''
  state.savedContent = ''
  state.dirty = false
  editor.setContent('')
  els.preview.innerHTML = ''
  els.docTitle.value = ''
  updateStats('')
}

async function enterKb(kbPath) {
  if (!samePath(kbPath, state.root)) {
    try {
      const config = await window.api.switchKb(kbPath)
      state.config = config
      state.kbs = config.kbs || state.kbs
      state.root = config.root
      state.tree = []
      state.expanded.clear()
      persistExpanded()
      state.selectedDir = config.root
      state.indexPath = config.root
      resetDocState()
      await refreshTree()
      renderRecents()
    } catch (error) {
      toast(errText(error), 'error')
      return
    }
  }
  showIndex(state.root)
}

async function addKnowledgeBase() {
  const before = (state.kbs || []).length
  try {
    const config = await window.api.addKb()
    if (!config) return
    state.config = config
    state.kbs = config.kbs || state.kbs
    renderKbList()
    if ((state.kbs || []).length === before) {
      toast('该目录已在知识库列表中')
    } else {
      const added = state.kbs[state.kbs.length - 1]
      toast(`已添加知识库「${added ? added.name : ''}」`)
    }
  } catch (error) {
    toast(errText(error), 'error')
  }
}

async function removeKnowledgeBase(kbPath) {
  const kb = (state.kbs || []).find((item) => samePath(item.path, kbPath))
  if (!kb) return
  if (!window.confirm(`仅从列表移除「${kb.name}」，不会删除磁盘文件。确定继续吗？`)) return
  try {
    const config = await window.api.removeKb(kbPath)
    const rootChanged = !samePath(config.root, state.root)
    state.config = config
    state.kbs = config.kbs || []
    if (rootChanged) {
      state.root = config.root
      state.tree = []
      state.expanded.clear()
      persistExpanded()
      state.selectedDir = config.root
      state.indexPath = config.root
      resetDocState()
      await refreshTree()
      renderRecents()
    }
    renderKbList()
    toast('已移除知识库')
  } catch (error) {
    toast(errText(error), 'error')
  }
}

function showSearchResults(results, query) {
  els.searchPanel.classList.remove('hidden')
  els.searchCount.textContent = `${results.length} 条`
  if (!results.length) {
    els.searchResults.innerHTML = `<div class="search-result-snippet" style="padding:12px 8px">没有找到匹配内容</div>`
    return
  }
  els.searchResults.innerHTML = results
    .map(
      (item) => `<button class="search-result" data-path="${escapeHtml(item.path)}" data-line="${item.line}">
        <div class="search-result-title"><span>${escapeHtml(item.title)}</span><span class="search-result-line">第 ${item.line} 行</span></div>
        <div class="search-result-snippet">${highlightText(item.snippet, query)}</div>
      </button>`
    )
    .join('')
}

async function runFullTextSearch(query) {
  const seq = ++searchSeq
  try {
    const results = await window.api.search(query)
    if (seq !== searchSeq) return
    showSearchResults(results, query)
  } catch (error) {
    if (seq !== searchSeq) return
    showSearchResults([], query)
  }
}

/* --------------------------------- 文档操作 -------------------------------- */

function setSaveState(kind) {
  const labels = { saved: '已保存', dirty: '未保存', saving: '保存中…', error: '保存失败' }
  els.saveState.className = `save-state ${kind === 'saved' ? '' : kind}`.trim()
  els.saveState.innerHTML = `<i></i>${labels[kind] || ''}`
}

function updateStats(content = '') {
  const chars = countWords(content)
  const lines = content ? content.split('\n').length : 0
  els.wordCount.textContent = `${chars} 字`
  els.lineCount.textContent = `${lines} 行`
  els.readTime.textContent = `约 ${Math.max(1, Math.ceil(chars / 400))} 分钟阅读`
}

function renderPreviewNow({ resetScroll = false } = {}) {
  if (!state.currentPath) {
    els.preview.innerHTML = ''
    return
  }
  els.preview.innerHTML = renderMarkdown(editor.getContent(), state.currentPath)
  if (resetScroll) els.previewPane.scrollTop = 0
}

function updatePreview() {
  clearTimeout(previewTimer)
  if (!state.currentPath) {
    els.preview.innerHTML = ''
    return
  }
  previewTimer = setTimeout(() => renderPreviewNow(), 90)
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveDoc()
  }, 900)
}

async function saveDoc() {
  if (!state.currentPath) return
  const content = editor.getContent()
  if (content === state.savedContent) {
    state.dirty = false
    setSaveState('saved')
    return
  }
  setSaveState('saving')
  try {
    await window.api.writeFile(state.currentPath, content)
    state.savedContent = content
    state.dirty = false
    setSaveState('saved')
    els.statusMsg.textContent = ''
  } catch (error) {
    setSaveState('error')
    toast(`保存失败：${errText(error)}`, 'error')
  }
}

function handleContentChange(content) {
  state.dirty = content !== state.savedContent
  setSaveState(state.dirty ? 'dirty' : 'saved')
  updateStats(content)
  updatePreview()
  updateAiContext()
  if (state.dirty) scheduleSave()
}

function updateBreadcrumb() {
  if (!state.currentPath) {
    els.breadcrumb.innerHTML = ''
    return
  }
  const relative = state.currentPath
    .slice(state.root.length)
    .replace(/^[\\/]/, '')
  const parts = relative.split(/[\\/]/)
  els.breadcrumb.innerHTML = parts
    .map((part, index) => {
      const isLast = index === parts.length - 1
      const label = isLast ? stripMdExtension(part) : part
      return `<span class="crumb ${isLast ? 'current' : ''}" title="${escapeHtml(label)}">${escapeHtml(
        label
      )}</span>`
    })
    .join(icon('chevron-right'))
}

function closeDoc() {
  cancelSave()
  state.currentPath = null
  state.currentTitle = ''
  state.savedContent = ''
  state.dirty = false
  editor.setContent('')
  els.preview.innerHTML = ''
  els.docTitle.value = ''
  updateStats('')
  const dir = state.selectedDir && isPathInside(state.selectedDir, state.root) ? state.selectedDir : state.root
  showIndex(dir)
  updateAiContext()
}

function cancelSave() {
  clearTimeout(saveTimer)
  saveTimer = null
}

async function openDoc(filePath, { line = 0, silent = false } = {}) {
  if (state.currentPath === filePath) {
    hideIndex()
    hideKbList()
    els.docTitleRow.classList.remove('hidden')
    updateBreadcrumb()
    if (line) editor.setCursorLine(line)
    editor.focus()
    return
  }
  if (state.currentPath && state.dirty) {
    cancelSave()
    await saveDoc()
  }
  try {
    const file = await window.api.readFile(filePath)
    state.currentPath = filePath
    state.currentTitle = stripMdExtension(basename(filePath))
    state.savedContent = file.content
    state.dirty = false
    state.selectedDir = dirname(filePath)
    editor.setContent(file.content)
    els.docTitle.value = state.currentTitle
    hideIndex()
    hideKbList()
    els.docTitleRow.classList.remove('hidden')
    setSaveState('saved')
    updateStats(file.content)
    updateBreadcrumb()
    renderPreviewNow({ resetScroll: true })
    expandAncestors(filePath)
    renderTree()
    rememberRecent(filePath, state.currentTitle)
    updateAiContext()
    document.title = `${state.currentTitle} · 灵犀文档`
    window.api.setConfig({ lastDoc: filePath }).then((config) => {
      state.config = config
    }).catch(() => {})
    if (line) {
      setTimeout(() => editor.setCursorLine(line), 60)
    } else {
      editor.focus()
    }
    requestAnimationFrame(() => {
      els.fileTree.querySelector('.tree-row.active')?.scrollIntoView({ block: 'nearest' })
    })
  } catch (error) {
    if (!silent) toast(`打开失败：${errText(error)}`, 'error')
    state.recentDocs = state.recentDocs.filter((item) => item.path !== filePath)
    localStorage.setItem('moji:recent', JSON.stringify(state.recentDocs))
    renderRecents()
    showIndex(state.root)
  }
}

async function commitTitle() {
  if (!state.currentPath) return
  const next = els.docTitle.value.trim()
  if (!next) {
    els.docTitle.value = state.currentTitle
    return
  }
  if (next === state.currentTitle) {
    els.docTitle.value = state.currentTitle
    return
  }
  try {
    const result = await window.api.renameNode(state.currentPath, next)
    state.currentPath = result.path
    state.currentTitle = result.title
    state.savedContent = editor.getContent()
    state.dirty = false
    els.docTitle.value = result.title
    updateBreadcrumb()
    document.title = `${result.title} · 灵犀文档`
    rememberRecent(result.path, result.title)
    await refreshTree()
    toast('已重命名')
  } catch (error) {
    els.docTitle.value = state.currentTitle
    toast(errText(error), 'error')
  }
}

async function createDocIn(dir) {
  const name = await promptModal({
    title: '新建文档',
    label: '文档名称',
    value: '未命名文档',
    confirmText: '创建'
  })
  if (!name) return
  try {
    const targetDir = isPathInside(dir || state.root, state.root) ? dir || state.root : state.root
    const result = await window.api.createDoc(targetDir, name)
    state.expanded.add(targetDir)
    persistExpanded()
    await refreshTree()
    await openDoc(result.path)
    setTimeout(() => {
      els.docTitle.focus()
      els.docTitle.select()
    }, 80)
  } catch (error) {
    toast(errText(error), 'error')
  }
}

async function createFolderIn(dir) {
  const name = await promptModal({
    title: '新建文件夹',
    label: '文件夹名称',
    value: '新建文件夹',
    confirmText: '创建'
  })
  if (!name) return
  try {
    const targetDir = isPathInside(dir || state.root, state.root) ? dir || state.root : state.root
    const result = await window.api.createFolder(targetDir, name)
    state.expanded.add(targetDir)
    state.expanded.add(result.path)
    state.selectedDir = result.path
    persistExpanded()
    await refreshTree()
    toast('文件夹已创建')
  } catch (error) {
    toast(errText(error), 'error')
  }
}

async function renameNode(nodePath, currentName, isDir) {
  const name = await promptModal({
    title: isDir ? '重命名文件夹' : '重命名文档',
    label: '新名称',
    value: currentName,
    confirmText: '保存'
  })
  if (!name) return
  try {
    const result = await window.api.renameNode(nodePath, name)
    if (state.currentPath === nodePath) {
      state.currentPath = result.path
      state.currentTitle = isDir ? state.currentTitle : result.title
      if (!isDir) {
        els.docTitle.value = result.title
        updateBreadcrumb()
        document.title = `${result.title} · 灵犀文档`
      }
    } else if (isDir && state.currentPath && isPathInside(state.currentPath, nodePath)) {
      state.currentPath = result.path + state.currentPath.slice(nodePath.length)
      updateBreadcrumb()
    }
    if (state.selectedDir === nodePath) state.selectedDir = result.path
    if (state.indexOpen && isPathInside(state.indexPath, nodePath)) {
      state.indexPath = result.path + state.indexPath.slice(nodePath.length)
    }
    await refreshTree()
    toast('已重命名')
  } catch (error) {
    toast(errText(error), 'error')
  }
}

async function deleteNode(nodePath, name, isDir) {
  const confirmed = await confirmModal({
    title: isDir ? '删除文件夹' : '删除文档',
    message: `确定要删除${isDir ? '文件夹' : '文档'} <strong>${escapeHtml(name)}</strong> 吗？<br>内容会被移到系统废纸篓，可在废纸篓中恢复。`,
    confirmText: '移到废纸篓',
    danger: true
  })
  if (!confirmed) return
  try {
    cancelSave()
    await window.api.deleteNode(nodePath)
    if (state.currentPath && isPathInside(state.currentPath, nodePath)) {
      closeDoc()
    }
    if (state.selectedDir === nodePath || (isDir && isPathInside(state.selectedDir, nodePath))) {
      state.selectedDir = state.root
    }
    if (state.indexOpen && isPathInside(state.indexPath, nodePath)) {
      state.indexPath = state.root
      state.selectedDir = state.root
    }
    state.recentDocs = state.recentDocs.filter(
      (item) => !item || !isPathInside(item.path, nodePath)
    )
    localStorage.setItem('moji:recent', JSON.stringify(state.recentDocs))
    renderRecents()
    await refreshTree()
    toast('已移到废纸篓')
  } catch (error) {
    toast(errText(error), 'error')
  }
}

/* --------------------------------- 菜单/弹窗 -------------------------------- */

function hideContextMenu() {
  els.contextMenu.classList.add('hidden')
  els.contextMenu.onclick = null
}

function showContextMenu(x, y, items) {
  els.contextMenu.innerHTML = items
    .map((item, index) =>
      item.separator
        ? '<div class="context-sep"></div>'
        : `<button class="context-item ${item.danger ? 'danger' : ''}" data-index="${index}">${
            item.color ? `<i class="context-dot" style="background:${item.color}"></i>` : item.icon ? icon(item.icon) : ''
          }<span>${escapeHtml(item.label)}</span>${
            item.shortcut ? `<span class="shortcut">${escapeHtml(item.shortcut)}</span>` : ''
          }</button>`
    )
    .join('')
  els.contextMenu.classList.remove('hidden')
  els.contextMenu.style.visibility = 'hidden'
  els.contextMenu.style.left = '0px'
  els.contextMenu.style.top = '0px'
  const rect = els.contextMenu.getBoundingClientRect()
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 10))
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 10))
  els.contextMenu.style.left = `${left}px`
  els.contextMenu.style.top = `${top}px`
  els.contextMenu.style.visibility = ''
  els.contextMenu.onclick = (event) => {
    const button = event.target.closest('[data-index]')
    if (!button) return
    const item = items[Number(button.dataset.index)]
    hideContextMenu()
    item?.onClick?.()
  }
}

function openModal({ title, iconName = 'info', body, footer = '', width = '' }) {
  closeModal()
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.innerHTML = `<div class="modal ${width}">
    <div class="modal-head">
      <h2>${iconName ? icon(iconName) : ''}${escapeHtml(title)}</h2>
      <button class="icon-btn" data-close>${icon('close')}</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`
  els.modalRoot.appendChild(backdrop)
  modalState = { backdrop, onClose: null }
  backdrop.querySelector('[data-close]').onclick = () => closeModal()
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) closeModal()
  })
  return backdrop
}

function closeModal() {
  const current = modalState
  modalState = null
  if (!current) return
  current.backdrop.remove()
  current.onClose?.()
}

function promptModal({ title, label = '名称', value = '', placeholder = '', confirmText = '确定' }) {
  return new Promise((resolve) => {
    const backdrop = openModal({
      title,
      iconName: 'edit',
      width: 'narrow',
      body: `<div class="field"><label>${escapeHtml(label)}</label><input class="prompt-input" id="promptInput" value="${escapeHtml(
        value
      )}" placeholder="${escapeHtml(placeholder)}"></div>`,
      footer: `<button class="ghost-btn" data-cancel>取消</button><button class="primary-btn" data-ok>${escapeHtml(
        confirmText
      )}</button>`
    })
    let settled = false
    const input = backdrop.querySelector('#promptInput')
    const settle = (result) => {
      if (settled) return
      settled = true
      resolve(result)
      closeModal()
    }
    modalState.onClose = () => {
      if (!settled) {
        settled = true
        resolve(null)
      }
    }
    backdrop.querySelector('[data-cancel]').onclick = () => settle(null)
    backdrop.querySelector('[data-ok]').onclick = () => settle(input.value.trim() || null)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        settle(input.value.trim() || null)
      }
    })
    setTimeout(() => {
      input.focus()
      input.select()
    }, 30)
  })
}

function confirmModal({ title, message, confirmText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = openModal({
      title,
      iconName: danger ? 'alert' : 'info',
      width: 'narrow',
      body: `<div class="confirm-text">${message}</div>`,
      footer: `<button class="ghost-btn" data-cancel>取消</button><button class="${
        danger ? 'danger-btn' : 'primary-btn'
      }" data-ok>${escapeHtml(confirmText)}</button>`
    })
    let settled = false
    const settle = (value) => {
      if (settled) return
      settled = true
      resolve(value)
      closeModal()
    }
    modalState.onClose = () => {
      if (!settled) {
        settled = true
        resolve(false)
      }
    }
    backdrop.querySelector('[data-cancel]').onclick = () => settle(false)
    backdrop.querySelector('[data-ok]').onclick = () => settle(true)
  })
}

/* ---------------------------------- AI ---------------------------------- */

function updateAiSendButton() {
  if (state.aiStreaming) {
    els.btnAiSend.innerHTML = `${icon('stop')}<span>停止</span>`
    els.btnAiSend.classList.add('stopping')
  } else {
    els.btnAiSend.innerHTML = `${icon('send')}<span>发送</span>`
    els.btnAiSend.classList.remove('stopping')
  }
}

function renderAiMessage(message) {
  if (message.role === 'user') {
    return `<div class="ai-msg user" data-msg-id="${message.id}"><div class="ai-bubble">${escapeHtml(
      message.content
    )}</div></div>`
  }
  const tools =
    message.content && !message.streaming
      ? `<div class="ai-msg-tools">
          <button data-insert="${message.id}">${icon('plus')}插入文档</button>
          <button data-copy="${message.id}">${icon('copy')}复制</button>
        </div>`
      : ''
  const error = message.error ? `<div class="ai-error">${escapeHtml(message.error)}</div>` : ''
  const sources =
    message.sources && message.sources.length
      ? `<div class="ai-sources"><span class="ai-sources-label">参考来源</span>${message.sources
          .map(
            (source, index) =>
              `<button class="ai-source" data-source-path="${escapeHtml(source.path)}" title="打开文档">[${index + 1}] ${escapeHtml(
                source.title
              )}${source.heading ? ` · ${escapeHtml(source.heading)}` : ''}</button>`
          )
          .join('')}</div>`
      : ''
  return `<div class="ai-msg assistant" data-msg-id="${message.id}">
    <div class="ai-bubble ${message.streaming ? 'streaming' : ''}">${escapeHtml(message.content)}</div>
    ${error}${sources}${tools}
  </div>`
}

function renderAiMessages() {
  if (!state.aiMessages.length) {
    els.aiMessages.innerHTML = `<div class="ai-empty">${icon(
      'sparkles'
    )}<p>直接向知识库提问，AI 会检索本地文档并标注来源<br>也可以用上方快捷操作处理当前文档</p></div>`
    return
  }
  const stick =
    els.aiMessages.scrollHeight - els.aiMessages.scrollTop - els.aiMessages.clientHeight < 120
  els.aiMessages.innerHTML = state.aiMessages.map(renderAiMessage).join('')
  if (stick) els.aiMessages.scrollTop = els.aiMessages.scrollHeight
}

function findAiMessage(id) {
  return state.aiMessages.find((message) => message.id === id)
}

function toggleAi(force) {
  const open = typeof force === 'boolean' ? force : !state.aiOpen
  state.aiOpen = open
  els.aiPanel.classList.toggle('hidden', !open)
  els.app.classList.toggle('ai-open', open)
  $('#btnAi').classList.toggle('active', open)
  if (open) {
    updateAiContext()
    if (!state.aiMessages.length) renderAiMessages()
    setTimeout(() => els.aiInput.focus(), 60)
    els.aiMessages.scrollTop = els.aiMessages.scrollHeight
  }
}

function aiReady() {
  const ai = state.config?.ai || {}
  const isLocal = /localhost|127\.0\.0\.1/.test(ai.baseUrl || '')
  if (!ai.baseUrl || (!ai.apiKey && !isLocal)) {
    toast('请先在设置中配置 AI 接口与 API Key', 'error')
    openSettings('ai')
    return false
  }
  return true
}

function buildSystemMessage(includeDocument, knowledge = []) {
  let base =
    '你是灵犀文档的 AI 助手，擅长基于本地知识库回答问题和 Markdown 写作。回答简洁、准确，保持 Markdown 结构，不要使用“好的”“以下是”等多余开场白，不要复述用户问题。'
  if (knowledge.length) {
    const blocks = knowledge
      .map((chunk, index) => {
        const where = chunk.heading
          ? `《${chunk.title}》/ ${chunk.heading}`
          : `《${chunk.title}》`
        return `[片段 ${index + 1}] ${where}\n${chunk.text}`
      })
      .join('\n\n')
    base += `\n\n用户开启了知识库检索。请优先依据下面的本地知识库片段回答，并在引用内容后标注来源编号（如 [1]、[2]）。如果片段不足以回答问题，请明确说明“知识库中没有找到相关内容”，再基于通用知识补充，不要编造。\n\n<知识库片段>\n${blocks}\n</知识库片段>`
  }
  if (includeDocument && state.currentPath) {
    const document = editor.getContent().slice(0, 12000)
    if (document.trim()) {
      base += `\n\n当前文档《${state.currentTitle}》内容如下：\n<document>\n${document}\n</document>`
    }
  }
  return base
}

function finalizeAi(errorMessage = '') {
  const message = state.aiMessages.find((item) => item.id === state.aiStreamingId)
  state.aiStreaming = false
  state.aiStreamingId = null
  state.aiRequestId = null
  if (message) {
    message.streaming = false
    if (errorMessage) message.error = errorMessage
    if (!message.content && !errorMessage) message.content = '（模型没有返回内容）'
  }
  updateAiSendButton()
  renderAiMessages()
}

function handleAiEvent(data) {
  if (!data || !data.id || data.id !== state.aiRequestId) return
  const message = findAiMessage(state.aiStreamingId)
  if (!message) return
  if (data.type === 'delta') {
    const bubble = els.aiMessages.querySelector(
      `[data-msg-id="${message.id}"] .ai-bubble`
    )
    const stick =
      els.aiMessages.scrollHeight - els.aiMessages.scrollTop - els.aiMessages.clientHeight < 90
    message.content += data.text || ''
    if (bubble) bubble.textContent = message.content
    if (stick) els.aiMessages.scrollTop = els.aiMessages.scrollHeight
    return
  }
  if (data.type === 'done') {
    finalizeAi()
    return
  }
  if (data.type === 'error') {
    if (data.message === '已停止生成') {
      finalizeAi()
      toast('已停止生成')
    } else {
      finalizeAi(data.message || 'AI 请求失败')
    }
  }
}

async function sendAi(input, { includeDocument = true, useKnowledge = state.aiUseKb } = {}) {
  if (state.aiStreaming) return
  const content = String(input ?? els.aiInput.value ?? '').trim()
  if (!content) return
  if (!aiReady()) return

  msgSeq += 1
  state.aiMessages.push({ id: `m${msgSeq}`, role: 'user', content })
  msgSeq += 1
  const assistant = {
    id: `m${msgSeq}`,
    role: 'assistant',
    content: '',
    streaming: true,
    sources: []
  }
  state.aiMessages.push(assistant)
  els.aiInput.value = ''
  renderAiMessages()

  const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  state.aiRequestId = requestId
  state.aiStreamingId = assistant.id
  state.aiStreaming = true
  updateAiSendButton()

  let knowledge = []
  if (useKnowledge) {
    els.aiKbStatus.textContent = '正在检索知识库…'
    try {
      const result = await window.api.retrieve(content, { limit: 6 })
      knowledge = Array.isArray(result?.chunks) ? result.chunks : []
    } catch {
      knowledge = []
    }
    if (!state.aiStreaming || state.aiRequestId !== requestId) return
    els.aiKbStatus.textContent = knowledge.length
      ? `已检索 ${knowledge.length} 段相关片段`
      : '知识库中未找到相关片段'
    assistant.sources = knowledge.map(({ path, title, heading }) => ({ path, title, heading }))
    renderAiMessages()
  }

  const history = state.aiMessages
    .filter((message) => message.content && !message.error)
    .slice(-12)
    .map((message) => ({ role: message.role, content: message.content }))
  const messages = [
    { role: 'system', content: buildSystemMessage(includeDocument, knowledge) },
    ...history
  ]

  try {
    const result = await window.api.aiChat({ id: requestId, messages })
    if (result && result.ok === false && state.aiStreaming) {
      finalizeAi(result.error || 'AI 请求失败')
    } else if (state.aiStreaming) {
      finalizeAi()
    }
  } catch (error) {
    if (state.aiStreaming) finalizeAi(errText(error))
  }
}

function runQuickAction(id) {
  const action = AI_QUICK_ACTIONS.find((item) => item.id === id)
  if (!action) return
  if (!state.currentPath) {
    toast('请先打开一篇文档', 'error')
    return
  }
  const selection = editor.getSelection()
  const selected = Boolean(selection.text.trim())
  const content = selected ? selection.text : editor.getContent()
  if (!content.trim()) {
    toast('当前文档还没有内容', 'error')
    return
  }
  toggleAi(true)
  sendAi(action.build(content, selected), { includeDocument: false, useKnowledge: false })
}

function renderAiQuick() {
  els.aiQuick.innerHTML = AI_QUICK_ACTIONS.map(
    (action) => `<button class="ai-chip" data-action="${action.id}">${escapeHtml(action.label)}</button>`
  ).join('')
}

/* --------------------------------- 设置 --------------------------------- */

function detectPreset(baseUrl) {
  const preset = AI_PRESETS.find((item) => item.baseUrl && item.baseUrl === baseUrl)
  return preset ? preset.id : 'custom'
}

function openSettings(focus = '') {
  const ai = state.config?.ai || {}
  let chosenTheme = state.theme
  const presetOptions = AI_PRESETS.map(
    (preset) =>
      `<option value="${preset.id}" ${preset.id === detectPreset(ai.baseUrl) ? 'selected' : ''}>${
        preset.name
      }</option>`
  ).join('')

  const body = `
    <div class="modal-section">
      <div class="modal-section-title">${icon('folder-open')} 知识库存储目录</div>
      <div class="path-box"><span>${escapeHtml(state.config?.root || '')}</span></div>
      <div style="display:flex;gap:8px">
        <button class="ghost-btn small" data-pick-root>更改目录</button>
        <button class="ghost-btn small" data-open-root>在文件管理器中打开</button>
      </div>
      <div class="hint">所有文档以 .md 文件保存在该目录，随时可以用其他编辑器打开，也可以整体迁移或备份。</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">${icon('sparkles')} AI 大模型</div>
      <div class="field">
        <label>接口预设</label>
        <select id="setPreset">${presetOptions}</select>
      </div>
      <div class="field">
        <label>接口地址（Base URL）</label>
        <input id="setBaseUrl" type="text" value="${escapeHtml(ai.baseUrl || '')}" placeholder="https://api.deepseek.com/v1">
        <div class="hint">兼容 OpenAI Chat Completions 协议，支持 DeepSeek、OpenAI、Moonshot、智谱、通义千问与本地 Ollama。</div>
      </div>
      <div class="row-2">
        <div class="field">
          <label>API Key</label>
          <input id="setApiKey" type="password" value="${escapeHtml(ai.apiKey || '')}" placeholder="sk-..." autocomplete="off">
        </div>
        <div class="field">
          <label>模型名称</label>
          <input id="setModel" type="text" value="${escapeHtml(ai.model || '')}" placeholder="deepseek-chat">
        </div>
      </div>
      <div class="field">
        <label>温度（越高越有创意）<span id="tempValue">${ai.temperature ?? 0.7}</span></label>
        <input id="setTemp" type="range" min="0" max="1.5" step="0.1" value="${ai.temperature ?? 0.7}" style="width:100%">
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="ghost-btn small" data-test>测试连接</button>
        <span class="test-status" id="testStatus">尚未测试</span>
      </div>
      <div class="hint">API Key 仅保存在本机配置文件，不会上传到任何第三方服务。</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">${icon('moon')} 外观</div>
      <div class="row-2">
        <button class="ghost-btn theme-choice ${chosenTheme === 'light' ? 'active' : ''}" data-theme-choice="light">浅色主题</button>
        <button class="ghost-btn theme-choice ${chosenTheme === 'dark' ? 'active' : ''}" data-theme-choice="dark">深色主题</button>
      </div>
    </div>
  `

  const modal = openModal({
    title: '设置',
    iconName: 'settings',
    width: 'wide',
    body,
    footer: `<span class="spacer"></span><button class="ghost-btn" data-cancel>取消</button><button class="primary-btn" data-save>保存设置</button>`
  })

  const baseUrlInput = modal.querySelector('#setBaseUrl')
  const modelInput = modal.querySelector('#setModel')
  const apiKeyInput = modal.querySelector('#setApiKey')
  const presetSelect = modal.querySelector('#setPreset')
  const tempInput = modal.querySelector('#setTemp')
  const tempValue = modal.querySelector('#tempValue')
  const testStatus = modal.querySelector('#testStatus')

  presetSelect.onchange = () => {
    const preset = AI_PRESETS.find((item) => item.id === presetSelect.value)
    if (!preset || preset.id === 'custom') return
    baseUrlInput.value = preset.baseUrl
    modelInput.value = preset.model
  }

  tempInput.oninput = () => {
    tempValue.textContent = tempInput.value
  }

  modal.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.onclick = () => {
      chosenTheme = button.dataset.themeChoice
      modal.querySelectorAll('[data-theme-choice]').forEach((item) => {
        item.classList.toggle('active', item === button)
      })
    }
  })

  modal.querySelector('[data-open-root]').onclick = () => window.api.openPath(state.root)

  modal.querySelector('[data-pick-root]').onclick = async () => {
    const config = await window.api.chooseRoot()
    if (!config) return
    cancelSave()
    state.config = config
    state.root = config.root
    state.kbs = config.kbs || state.kbs
    state.tree = []
    state.expanded.clear()
    persistExpanded()
    state.selectedDir = config.root
    state.indexPath = config.root
    state.currentPath = null
    closeModal()
    closeDoc()
    await refreshTree()
    applyTheme(config.theme || state.theme)
    renderRecents()
    toast('已切换知识库')
  }

  modal.querySelector('[data-test]').onclick = async () => {
    testStatus.className = 'test-status'
    testStatus.textContent = '正在测试…'
    try {
      await window.api.setConfig({
        ai: {
          baseUrl: baseUrlInput.value.trim(),
          apiKey: apiKeyInput.value.trim(),
          model: modelInput.value.trim(),
          temperature: Number(tempInput.value)
        }
      })
      const result = await window.api.aiTest()
      testStatus.className = 'test-status ok'
      testStatus.textContent = `连接成功${result.text ? `：${result.text.slice(0, 24)}` : ''}`
    } catch (error) {
      testStatus.className = 'test-status err'
      testStatus.textContent = errText(error).slice(0, 120)
    }
  }

  modal.querySelector('[data-cancel]').onclick = () => closeModal()

  modal.querySelector('[data-save]').onclick = async () => {
    try {
      state.config = await window.api.setConfig({
        theme: chosenTheme,
        ai: {
          baseUrl: baseUrlInput.value.trim(),
          apiKey: apiKeyInput.value.trim(),
          model: modelInput.value.trim(),
          temperature: Number(tempInput.value)
        }
      })
      applyTheme(chosenTheme)
      closeModal()
      toast('设置已保存')
      updateAiContext()
    } catch (error) {
      toast(errText(error), 'error')
    }
  }

  if (focus === 'ai') {
    setTimeout(() => {
      baseUrlInput.focus()
      baseUrlInput.select()
    }, 60)
  }
}

/* --------------------------------- 导出 --------------------------------- */

function openExportModal() {
  const total = countDocs(state.tree)
  const body = `
    <div class="export-list">
      <button class="export-option" data-export="html">
        <span class="export-icon">${icon('code')}</span>
        <div>
          <h3>HTML 合集（推荐）</h3>
          <p>把全部文档合并为一个可直接分享的 HTML 文件，图片自动内嵌，带目录与打印样式。</p>
        </div>
      </button>
      <button class="export-option" data-export="markdown">
        <span class="export-icon">${icon('file-text')}</span>
        <div>
          <h3>Markdown 合集</h3>
          <p>合并为一个 Markdown 文件，保留原文格式，本地图片转为内嵌数据，便于二次编辑。</p>
        </div>
      </button>
      <button class="export-option" data-export="zip">
        <span class="export-icon">${icon('download')}</span>
        <div>
          <h3>完整知识库压缩包</h3>
          <p>将当前知识库目录（含图片与附件）原样打包为 ZIP，适合备份或迁移到其他设备。</p>
        </div>
      </button>
    </div>
    <div class="export-hint">当前知识库共 ${total} 篇文档 · ${escapeHtml(state.root)}</div>
  `
  const modal = openModal({
    title: '导出知识库',
    iconName: 'download',
    width: 'wide',
    body,
    footer: `<span class="spacer"></span><button class="ghost-btn" data-cancel>关闭</button>`
  })
  modal.querySelector('[data-cancel]').onclick = () => closeModal()
  modal.querySelectorAll('[data-export]').forEach((button) => {
    button.onclick = () => exportAs(button.dataset.export)
  })
}

async function exportAs(type) {
  closeModal()
  if (state.currentPath && state.dirty) await saveDoc()
  await refreshTree()
  const name = basename(state.root) || '知识库'
  try {
    if (type === 'zip') {
      toast('正在打包知识库…')
      const result = await window.api.exportZip()
      if (!result) return
      toast('ZIP 已导出', 'success', {
        label: '打开所在位置',
        onClick: () => window.api.showItem(result.path)
      })
      return
    }

    if (type === 'html') {
      const filePath = await window.api.saveDialog({
        defaultName: `${name}-合集.html`,
        type: 'html'
      })
      if (!filePath) return
      toast('正在生成 HTML 合集…')
      const html = await buildHtmlBundle(state.tree, name)
      await window.api.writePath(filePath, html)
      toast('HTML 合集已导出', 'success', {
        label: '打开文件',
        onClick: () => window.api.openPath(filePath)
      })
      return
    }

    if (type === 'markdown') {
      const filePath = await window.api.saveDialog({
        defaultName: `${name}-合集.md`,
        type: 'markdown'
      })
      if (!filePath) return
      toast('正在生成 Markdown 合集…')
      const markdown = await buildMarkdownBundle(state.tree, name)
      await window.api.writePath(filePath, markdown)
      toast('Markdown 合集已导出', 'success', {
        label: '打开文件',
        onClick: () => window.api.openPath(filePath)
      })
    }
  } catch (error) {
    toast(`导出失败：${errText(error)}`, 'error')
  }
}

/* --------------------------------- 图片 --------------------------------- */

async function handleImageFile(file, position) {
  if (!state.currentPath) {
    toast('请先打开一篇文档再插入图片', 'error')
    return
  }
  try {
    const dataUrl = await blobToDataUrl(file)
    const result = await window.api.saveAsset({
      docPath: state.currentPath,
      dataUrl,
      fileName: file.name || 'image'
    })
    editor.insertText(`${result.markdown}\n`, position)
    toast('图片已保存到 .assets 目录')
  } catch (error) {
    toast(`图片保存失败：${errText(error)}`, 'error')
  }
}

async function handlePastedImageSrc(src, position) {
  if (!state.currentPath) {
    toast('请先打开一篇文档再插入图片', 'error')
    return
  }
  if (/^https?:\/\//i.test(src)) {
    editor.insertText(`![](${src})\n`, position)
    return
  }
  try {
    const result = await window.api.saveAsset({
      docPath: state.currentPath,
      dataUrl: src,
      fileName: 'image'
    })
    editor.insertText(`${result.markdown}\n`, position)
    toast('图片已保存到 .assets 目录')
  } catch (error) {
    toast(`图片保存失败：${errText(error)}`, 'error')
  }
}

const HL_SWATCH = {
  yellow: '#f7d774',
  green: '#7fce9b',
  blue: '#7fb6ef',
  pink: '#f0a6c0',
  purple: '#b9a3ea',
  gray: '#b6bfcc',
  none: 'transparent'
}

const HIGHLIGHT_COLORS = [
  { color: 'yellow', label: '黄色高亮' },
  { color: 'green', label: '绿色高亮' },
  { color: 'blue', label: '蓝色高亮' },
  { color: 'pink', label: '粉色高亮' },
  { color: 'purple', label: '紫色高亮' },
  { color: 'gray', label: '灰色高亮' },
  { separator: true },
  { color: 'none', label: '移除高亮块' }
]

function applyHighlightBlock(color) {
  if (!state.currentPath) {
    toast('请先打开一篇文档', 'error')
    return
  }
  editor.toggleHighlightBlock(color)
}

/* ------------------------------- 最近编辑列表 ------------------------------- */

function renderRecents() {
  const items = (state.recentDocs || [])
    .filter((item) => item && item.path && isPathInside(item.path, state.root))
    .slice(0, 6)
  const isRoot = (state.indexPath || state.root) === state.root
  els.indexRecentSection.classList.toggle('hidden', !items.length || !isRoot)
  els.indexRecentList.innerHTML = items
    .map((item) =>
      indexRow({
        type: 'file',
        path: item.path,
        name: item.title || basename(item.path),
        meta: formatTime(item.at)
      })
    )
    .join('')
}

/* --------------------------------- 事件绑定 -------------------------------- */

function setupEvents() {
  $('#btnNewDoc').onclick = () => createDocIn(currentTargetDir())
  $('#btnEmptyNew').onclick = () => createDocIn(state.root)
  $('#btnNewFolder').onclick = () => createFolderIn(currentTargetDir())
  $('#btnRefresh').onclick = async () => {
    await refreshTree()
    toast('目录已刷新')
  }
  $('#btnHome').onclick = () => showKbList()
  $('#btnCollapseSidebar').onclick = () => applySidebarCollapsed(true)
  $('#btnExpandSidebar').onclick = () => applySidebarCollapsed(false)
  $('#indexNewDoc').onclick = () => createDocIn(state.indexPath || state.root)
  $('#indexNewFolder').onclick = () => createFolderIn(state.indexPath || state.root)
  $('#indexEmptyNew').onclick = () => createDocIn(state.indexPath || state.root)
  $('#indexOpenFolder').onclick = () => window.api.openPath(state.indexPath || state.root)
  $('#kbAdd').onclick = addKnowledgeBase
  els.kbListView.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-kb-remove]')
    if (removeBtn) {
      event.stopPropagation()
      removeKnowledgeBase(removeBtn.dataset.kbRemove)
      return
    }
    const row = event.target.closest('[data-kb-path]')
    if (row) enterKb(row.dataset.kbPath)
  })
  els.kbSideList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-kb-side]')
    if (item) enterKb(item.dataset.kbSide)
  })
  els.indexView.addEventListener('click', (event) => {
    const dir = event.target.closest('[data-index-dir]')
    if (dir) {
      showIndex(dir.dataset.indexDir)
      return
    }
    const file = event.target.closest('[data-index-file]')
    if (file) openDoc(file.dataset.indexFile)
  })
  els.breadcrumb.addEventListener('click', (event) => {
    if (event.target.closest('[data-crumb-kb]')) {
      showKbList()
      return
    }
    const crumb = event.target.closest('[data-crumb-path]')
    if (crumb) showIndex(crumb.dataset.crumbPath)
  })
  $('#btnSwitchKb').onclick = showKbList
  $('#btnOpenRoot').onclick = () => window.api.openPath(state.root)
  $('#btnSettings').onclick = () => openSettings()
  $('#btnExport').onclick = () => openExportModal()
  $('#btnFormat').onclick = () => runFormat()
  $('#btnHighlight').onclick = (event) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const items = HIGHLIGHT_COLORS.map((item) =>
      item.separator
        ? item
        : { label: item.label, color: HL_SWATCH[item.color], onClick: () => applyHighlightBlock(item.color) }
    )
    showContextMenu(rect.right - 190, rect.bottom + 6, items)
  }
  $('#btnAi').onclick = () => toggleAi()
  $('#btnAiClose').onclick = () => toggleAi(false)
  $('#btnAiSettings').onclick = () => openSettings('ai')
  $('#btnTheme').onclick = () => toggleTheme()

  $('#btnMore').onclick = (event) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const items = state.currentPath
      ? [
          { label: '重命名文档', icon: 'edit', onClick: () => renameNode(state.currentPath, state.currentTitle, false) },
          { label: '在文件夹中显示', icon: 'folder-open', onClick: () => window.api.showItem(state.currentPath) },
          { separator: true },
          { label: '删除文档', icon: 'trash', danger: true, onClick: () => deleteNode(state.currentPath, state.currentTitle, false) },
          { separator: true },
          { label: '设置', icon: 'settings', onClick: () => openSettings() }
        ]
      : [
          { label: '新建文档', icon: 'file-plus', onClick: () => createDocIn(currentTargetDir()) },
          { label: '新建文件夹', icon: 'folder-plus', onClick: () => createFolderIn(currentTargetDir()) },
          { separator: true },
          { label: '设置', icon: 'settings', onClick: () => openSettings() }
        ]
    showContextMenu(rect.right - 190, rect.bottom + 6, items)
  }

  $('#btnAiSend').onclick = () => {
    if (state.aiStreaming) {
      window.api.aiAbort(state.aiRequestId)
    } else {
      sendAi()
    }
  }

  els.aiInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (!state.aiStreaming) sendAi()
    }
  })

  if (els.aiUseKb) {
    els.aiUseKb.checked = state.aiUseKb
    els.aiUseKb.onchange = () => {
      state.aiUseKb = els.aiUseKb.checked
      localStorage.setItem('moji:useKb', state.aiUseKb ? '1' : '0')
      els.aiKbStatus.textContent = ''
      updateAiContext()
    }
  }

  els.aiQuick.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-action]')
    if (chip) runQuickAction(chip.dataset.action)
  })

  els.aiMessages.addEventListener('click', async (event) => {
    const sourceButton = event.target.closest('[data-source-path]')
    if (sourceButton) {
      try {
        await openDoc(sourceButton.dataset.sourcePath)
      } catch (error) {
        toast(errText(error), 'error')
      }
      return
    }
    const insertButton = event.target.closest('[data-insert]')
    if (insertButton) {
      const message = findAiMessage(insertButton.dataset.insert)
      if (!message) return
      if (!state.currentPath) {
        toast('请先打开一篇文档', 'error')
        return
      }
      editor.insertText(`${message.content.trim()}\n`)
      toast('已插入到光标位置')
      return
    }
    const copyButton = event.target.closest('[data-copy]')
    if (copyButton) {
      const message = findAiMessage(copyButton.dataset.copy)
      if (!message) return
      try {
        await navigator.clipboard.writeText(message.content)
        toast('已复制到剪贴板')
      } catch {
        toast('复制失败', 'error')
      }
    }
  })

  els.viewToggle.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]')
    if (button) setViewMode(button.dataset.mode)
  })

  els.docTitle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      els.docTitle.blur()
    }
  })
  els.docTitle.addEventListener('blur', () => commitTitle())

  els.fileTree.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-action="new-doc"]')
    if (actionButton) {
      event.stopPropagation()
      createDocIn(actionButton.dataset.path)
      return
    }
    const row = event.target.closest('.tree-row')
    if (!row) return
    const path = row.dataset.path
    if (row.dataset.type === 'dir') {
      state.selectedDir = path
      if (event.target.closest('.tree-twisty')) {
        toggleExpand(path)
        return
      }
      showIndex(path)
      return
    }
    openDoc(path)
  })

  els.fileTree.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.tree-row')
    if (!row) return
    event.preventDefault()
    const path = row.dataset.path
    const type = row.dataset.type
    if (type === 'dir') {
      const name = basename(path)
      showContextMenu(event.clientX, event.clientY, [
        { label: '新建文档', icon: 'file-plus', onClick: () => createDocIn(path) },
        { label: '新建文件夹', icon: 'folder-plus', onClick: () => createFolderIn(path) },
        { separator: true },
        { label: '重命名', icon: 'edit', onClick: () => renameNode(path, name, true) },
        { label: '在文件管理器中显示', icon: 'folder-open', onClick: () => window.api.showItem(path) },
        { separator: true },
        { label: '删除文件夹', icon: 'trash', danger: true, onClick: () => deleteNode(path, name, true) }
      ])
    } else {
      const title = stripMdExtension(basename(path))
      showContextMenu(event.clientX, event.clientY, [
        { label: '打开', icon: 'file-text', onClick: () => openDoc(path) },
        { label: '重命名', icon: 'edit', onClick: () => renameNode(path, title, false) },
        { label: '在文件管理器中显示', icon: 'folder-open', onClick: () => window.api.showItem(path) },
        { separator: true },
        { label: '删除文档', icon: 'trash', danger: true, onClick: () => deleteNode(path, title, false) }
      ])
    }
  })

  els.searchInput.addEventListener('input', () => {
    state.searchQuery = els.searchInput.value.trim()
    els.searchClear.classList.toggle('hidden', !state.searchQuery)
    renderTree()
    clearTimeout(searchTimer)
    if (!state.searchQuery) {
      searchSeq += 1
      els.searchPanel.classList.add('hidden')
      return
    }
    searchTimer = setTimeout(() => runFullTextSearch(state.searchQuery), 300)
  })

  els.searchClear.onclick = () => {
    els.searchInput.value = ''
    els.searchInput.dispatchEvent(new Event('input'))
    els.searchInput.focus()
  }

  els.searchResults.addEventListener('click', (event) => {
    const item = event.target.closest('[data-path]')
    if (item) openDoc(item.dataset.path, { line: Number(item.dataset.line) || 0 })
  })

  els.preview.addEventListener('click', async (event) => {
    const copyButton = event.target.closest('[data-code-copy]')
    if (copyButton) {
      const code = copyButton.closest('.code-block')?.querySelector('code')?.textContent || ''
      try {
        await navigator.clipboard.writeText(code)
        copyButton.textContent = '已复制'
        setTimeout(() => {
          copyButton.textContent = '复制'
        }, 1500)
      } catch {
        toast('复制失败', 'error')
      }
      return
    }
    const link = event.target.closest('a')
    if (!link) return
    const href = link.getAttribute('href') || ''
    if (/^https?:/i.test(href)) {
      event.preventDefault()
      window.api.openExternal(href)
      return
    }
    if (href.startsWith('#') || href.startsWith('mailto:')) return
    const clean = href.split('#')[0]
    if (!state.currentPath || !clean) return
    const abs = resolvePath(dirname(state.currentPath), clean)
    if (/\.(md|markdown)$/i.test(abs)) {
      event.preventDefault()
      openDoc(abs)
    }
  })

  document.addEventListener('click', (event) => {
    if (!els.contextMenu.classList.contains('hidden') && !els.contextMenu.contains(event.target)) {
      hideContextMenu()
    }
  })

  document.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey
    if (event.key === 'Escape') {
      if (!els.contextMenu.classList.contains('hidden')) {
        hideContextMenu()
        return
      }
      if (modalState) closeModal()
      return
    }
    if (!mod) return
    const key = event.key.toLowerCase()
    if (key === 's') {
      event.preventDefault()
      saveDoc()
    } else if (key === 'n') {
      event.preventDefault()
      createDocIn(currentTargetDir())
    } else if (key === 'k') {
      event.preventDefault()
      els.searchInput.focus()
      els.searchInput.select()
    } else if (key === ',') {
      event.preventDefault()
      openSettings()
    } else if (key === 'l' && event.shiftKey) {
      event.preventDefault()
      runFormat()
    } else if (key === 'p' && event.shiftKey) {
      event.preventDefault()
      togglePreview()
    }
  })

  window.addEventListener('blur', () => {
    if (state.dirty) saveDoc()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.dirty) saveDoc()
  })

  window.addEventListener('resize', hideContextMenu)
  window.addEventListener('scroll', hideContextMenu, true)
}

function runFormat() {
  if (!state.currentPath) {
    toast('请先打开一篇文档', 'error')
    return
  }
  const before = editor.getContent()
  const after = formatMarkdown(before)
  if (after === before) {
    toast('当前排版已经很规范')
    return
  }
  editor.replaceContent(after)
  toast('已自动排版')
}

/* --------------------------------- 启动 --------------------------------- */

async function boot() {
  mountIcons()
  applySplit()
  applySidebarCollapsed(state.sidebarCollapsed)
  setupEvents()
  setupResizer()
  applyTheme(state.theme)
  setViewMode(state.viewMode, { persist: false })
  renderAiQuick()
  renderAiMessages()
  renderRecents()

  editor = createEditor({
    parent: els.editor,
    onChange: handleContentChange,
    onPasteImage: handleImageFile,
    onPasteImageSrc: handlePastedImageSrc,
    onDropImage: handleImageFile,
    onSave: saveDoc,
    onFormat: runFormat,
    onTogglePreview: togglePreview
  })

  try {
    state.config = await window.api.getConfig()
    state.kbs = state.config.kbs || []
    state.root = state.config.root || state.root
    const info = await window.api.info()
    state.platform = info.platform
    document.body.classList.toggle('platform-darwin', info.platform === 'darwin')
    applyTheme(state.config.theme || state.theme)
    await refreshTree()
    renderRecents()
    window.api.onAiEvent(handleAiEvent)
    showKbList()
  } catch (error) {
    toast(errText(error), 'error')
    showKbList()
  }
}

boot()
