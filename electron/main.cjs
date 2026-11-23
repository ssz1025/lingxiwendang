const { app, BrowserWindow, ipcMain, clipboard, dialog, shell, protocol, net } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { retrieve, invalidate: invalidateIndex } = require('./retrieval.cjs')

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

app.setName('灵犀文档')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'kbasset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

const DEFAULT_AI = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.7
}

let mainWindow = null
let config = null
const aiControllers = new Map()

/* ---------------------------------- 配置 ---------------------------------- */

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function defaultRoot() {
  return path.join(app.getPath('documents'), '灵犀知识库')
}

function migrateLegacyRoot() {
  const legacy = path.join(app.getPath('documents'), '墨记知识库')
  const next = defaultRoot()
  try {
    if (!fs.existsSync(legacy)) return null
    if (!fs.existsSync(next)) fs.renameSync(legacy, next)
    return fs.existsSync(next) ? next : null
  } catch {
    return null
  }
}

function migrateLegacyConfig() {
  try {
    if (fs.existsSync(configPath())) return
    const legacy = path.join(app.getPath('appData'), '墨记 Markdown', 'config.json')
    if (!fs.existsSync(legacy)) return
    fs.mkdirSync(path.dirname(configPath()), { recursive: true })
    fs.copyFileSync(legacy, configPath())
  } catch {
    /* 迁移失败时使用默认配置 */
  }
}

function loadConfig() {
  migrateLegacyConfig()
  const base = {
    root: defaultRoot(),
    kbs: [],
    recents: [],
    theme: 'light',
    lastDoc: null,
    ai: { ...DEFAULT_AI }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    const legacyRoot = path.join(app.getPath('documents'), '墨记知识库')
    if (raw.root && path.resolve(raw.root) === legacyRoot) {
      const migrated = migrateLegacyRoot()
      if (migrated) raw.root = migrated
    }
    const fixLegacyPath = (value) =>
      typeof value === 'string' && value.startsWith(legacyRoot)
        ? path.join(defaultRoot(), path.relative(legacyRoot, value))
        : value
    raw.lastDoc = fixLegacyPath(raw.lastDoc)
    if (Array.isArray(raw.recents)) raw.recents = raw.recents.map(fixLegacyPath)
    const merged = {
      ...base,
      ...raw,
      ai: { ...base.ai, ...(raw.ai || {}) }
    }
    merged.kbs = normalizeKbs(raw.kbs, merged.root)
    return merged
  } catch {
    return { ...base, kbs: normalizeKbs([], base.root) }
  }
}

function normalizeKbs(list, activeRoot) {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const value = typeof item === 'string' ? item : item && item.path
    if (!value) continue
    const abs = path.resolve(value)
    if (seen.has(abs)) continue
    seen.add(abs)
    result.push({ name: path.basename(abs) || '知识库', path: abs })
  }
  if (activeRoot) {
    const abs = path.resolve(activeRoot)
    if (!seen.has(abs)) result.unshift({ name: path.basename(abs) || '知识库', path: abs })
  }
  return result
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
}

async function ensureRoot(root) {
  await fsp.mkdir(root, { recursive: true })
  const existing = await collectFiles(root)
  if (existing.length) return

  const guideDir = path.join(root, '入门指南')
  await fsp.mkdir(guideDir, { recursive: true })
  await fsp.writeFile(path.join(guideDir, '欢迎使用灵犀.md'), WELCOME_DOC, 'utf8')
  await fsp.writeFile(path.join(guideDir, 'Markdown 语法速查.md'), SYNTAX_DOC, 'utf8')
}

/* --------------------------------- 文件系统 -------------------------------- */

function isMarkdown(name) {
  return /\.(md|markdown)$/i.test(name)
}

async function walkTree(dir) {
  let entries = []
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({
        type: 'dir',
        name: entry.name,
        path: abs,
        children: await walkTree(abs)
      })
    } else if (entry.isFile() && isMarkdown(entry.name)) {
      let stat = null
      try {
        stat = await fsp.stat(abs)
      } catch {
        continue
      }
      nodes.push({
        type: 'file',
        name: entry.name,
        title: entry.name.replace(/\.(md|markdown)$/i, ''),
        path: abs,
        mtime: stat.mtimeMs,
        size: stat.size
      })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  })
  return nodes
}

async function collectFiles(dir, out = []) {
  let entries = []
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(abs, out)
    } else if (entry.isFile() && isMarkdown(entry.name)) {
      out.push(abs)
    }
  }
  return out
}

function safeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}${ext}`)
  let i = 2
  while (true) {
    try {
      await fsp.access(candidate)
      candidate = path.join(dir, `${base} ${i}${ext}`)
      i += 1
    } catch {
      return candidate
    }
  }
}

async function searchFiles(root, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const files = await collectFiles(root)
  const results = []
  for (const file of files) {
    let content = ''
    try {
      content = await fsp.readFile(file, 'utf8')
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const idx = line.toLowerCase().indexOf(q)
      if (idx !== -1) {
        const start = Math.max(0, idx - 30)
        const snippet = line.slice(start, start + 120)
        results.push({
          path: file,
          title: path.basename(file).replace(/\.(md|markdown)$/i, ''),
          line: i + 1,
          snippet: (start > 0 ? '…' : '') + snippet
        })
        if (results.length >= 80) return results
        break
      }
    }
  }
  return results
}

function resolveChatUrl(baseUrl) {
  const raw = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!raw) throw new Error('请先在设置中配置 AI 接口地址')
  if (/\/chat\/completions$/.test(raw)) return raw
  if (/\/v\d+$/.test(raw) || /\/api\/paas\/v4$/.test(raw)) return `${raw}/chat/completions`
  return `${raw}/v1/chat/completions`
}

/* ---------------------------------- 主进程 --------------------------------- */

async function createWindow() {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: config.theme === 'dark' ? '#16181d' : '#ffffff',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 20 } : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL()
    if (url !== current) event.preventDefault()
  })

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    if (process.env.OPEN_DEVTOOLS) mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isDev
  }))

  ipcMain.handle('config:get', async () => {
    await ensureRoot(config.root)
    return { ...config, configFile: configPath() }
  })

  ipcMain.handle('config:set', (_event, patch) => {
    const prevRoot = config.root
    const next = { ...config, ...(patch || {}) }
    if (patch && patch.ai) next.ai = { ...config.ai, ...patch.ai }
    if (patch && Array.isArray(patch.recents)) next.recents = patch.recents.slice(0, 8)
    next.kbs = normalizeKbs(next.kbs, next.root)
    config = next
    saveConfig()
    if (config.root !== prevRoot) invalidateIndex()
    return { ...config, configFile: configPath() }
  })

  ipcMain.handle('root:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择知识库目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const root = result.filePaths[0]
    await ensureRoot(root)
    const recents = [root, ...config.recents.filter((item) => item !== root)].slice(0, 8)
    const kbs = normalizeKbs([...config.kbs, { name: path.basename(root), path: root }], root)
    config = { ...config, root, kbs, recents, lastDoc: null }
    saveConfig()
    invalidateIndex()
    return { ...config, configFile: configPath() }
  })

  ipcMain.handle('kb:add', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '添加知识库目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const root = result.filePaths[0]
    await ensureRoot(root)
    config = { ...config, kbs: normalizeKbs([...config.kbs, { name: path.basename(root), path: root }], config.root) }
    saveConfig()
    return { ...config, configFile: configPath() }
  })

  ipcMain.handle('kb:switch', async (_event, kbPath) => {
    const target = (config.kbs || []).find((item) => path.resolve(item.path) === path.resolve(kbPath))
    if (!target) throw new Error('知识库不存在')
    await ensureRoot(target.path)
    config = { ...config, root: target.path, lastDoc: null }
    saveConfig()
    invalidateIndex()
    return { ...config, configFile: configPath() }
  })

  ipcMain.handle('kb:remove', async (_event, kbPath) => {
    const target = path.resolve(kbPath)
    const kbs = (config.kbs || []).filter((item) => path.resolve(item.path) !== target)
    if (!kbs.length) throw new Error('至少保留一个知识库')
    let root = config.root
    let lastDoc = config.lastDoc
    if (path.resolve(root) === target) {
      root = kbs[0].path
      lastDoc = null
      await ensureRoot(root)
      invalidateIndex()
    }
    config = { ...config, kbs, root, lastDoc }
    saveConfig()
    return { ...config, configFile: configPath() }
  })

  ipcMain.handle('kb:tree', async () => {
    await ensureRoot(config.root)
    return {
      root: config.root,
      tree: await walkTree(config.root)
    }
  })

  ipcMain.handle('kb:search', (_event, query) => searchFiles(config.root, query))

  ipcMain.handle('kb:retrieve', async (_event, query, options) => {
    try {
      const result = await retrieve(config.root, query, options || {})
      return { ...result, root: config.root }
    } catch (error) {
      return { chunks: [], docs: 0, error: String(error?.message || error) }
    }
  })

  ipcMain.handle('file:read', async (_event, filePath) => {
    const content = await fsp.readFile(filePath, 'utf8')
    return { path: filePath, content }
  })

  ipcMain.handle('file:write', async (_event, { filePath, content }) => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    await fsp.writeFile(filePath, content, 'utf8')
    invalidateIndex()
    return { path: filePath, savedAt: Date.now() }
  })

  ipcMain.handle('file:create', async (_event, { dir, name, content }) => {
    const targetDir = dir || config.root
    await fsp.mkdir(targetDir, { recursive: true })
    const base = safeName(name) || '未命名文档'
    const cleanBase = base.replace(/\.(md|markdown)$/i, '') || '未命名文档'
    const filePath = await uniquePath(targetDir, cleanBase, '.md')
    const body = typeof content === 'string' ? content : `# ${path.basename(filePath, '.md')}\n\n`
    await fsp.writeFile(filePath, body, 'utf8')
    invalidateIndex()
    return { path: filePath, title: path.basename(filePath, '.md'), content: body }
  })

  ipcMain.handle('folder:create', async (_event, { dir, name }) => {
    const targetDir = dir || config.root
    await fsp.mkdir(targetDir, { recursive: true })
    const base = safeName(name) || '新建文件夹'
    let candidate = path.join(targetDir, base)
    let i = 2
    while (true) {
      try {
        await fsp.access(candidate)
        candidate = path.join(targetDir, `${base} ${i}`)
        i += 1
      } catch {
        break
      }
    }
    await fsp.mkdir(candidate, { recursive: true })
    return { path: candidate, name: path.basename(candidate) }
  })

  ipcMain.handle('node:rename', async (_event, { nodePath, newName }) => {
    const isDir = (await fsp.stat(nodePath)).isDirectory()
    const clean = safeName(newName)
    if (!clean) throw new Error('名称不能为空')
    if (isDir) {
      const target = path.join(path.dirname(nodePath), clean)
      if (target !== nodePath) {
        try {
          await fsp.access(target)
          throw new Error('同名文件夹已存在')
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        await fsp.rename(nodePath, target)
      }
      invalidateIndex()
      return { path: target, title: path.basename(target) }
    }
    const base = clean.replace(/\.(md|markdown)$/i, '')
    const target = path.join(path.dirname(nodePath), `${base}.md`)
    if (target !== nodePath) {
      try {
        await fsp.access(target)
        throw new Error('同名文档已存在')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await fsp.rename(nodePath, target)
    }
    invalidateIndex()
    return { path: target, title: base }
  })

  ipcMain.handle('node:delete', async (_event, nodePath) => {
    if (!nodePath.startsWith(config.root)) throw new Error('只能删除知识库内的文件')
    await shell.trashItem(nodePath)
    invalidateIndex()
    return { ok: true }
  })

  ipcMain.handle('asset:save', async (_event, { docPath, dataUrl, fileName }) => {
    if (!docPath) throw new Error('请先打开一篇文档')
    const match = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || ''))
    if (!match) throw new Error('图片数据无效')
    const mime = match[1]
    const ext = Object.entries(MIME).find(([, value]) => value === mime)?.[0] || '.png'
    const docDir = path.dirname(docPath)
    const assetDir = path.join(docDir, '.assets')
    await fsp.mkdir(assetDir, { recursive: true })
    const base = safeName(String(fileName || '').replace(/\.[a-zA-Z0-9]+$/, '')) || `image-${Date.now()}`
    const name = `${base}-${Date.now().toString(36)}${ext}`
    const abs = path.join(assetDir, name)
    await fsp.writeFile(abs, Buffer.from(match[2], 'base64'))
    return {
      abs,
      rel: `./.assets/${name}`,
      markdown: `![${base}](./.assets/${name})`
    }
  })

  ipcMain.handle('clipboard:readImage', async () => {
    let items = []
    try {
      items = await clipboard.read()
    } catch {
      return null
    }
    const candidates = []
    for (const item of items) {
      for (const type of item.types || []) {
        const lower = String(type).toLowerCase()
        if (lower === 'image/png' || lower.includes('apple png') || lower.includes('png pasteboard')) {
          candidates.push({ item, type, mime: 'image/png' })
        }
      }
    }
    for (const item of items) {
      for (const type of item.types || []) {
        const lower = String(type).toLowerCase()
        if (lower === 'image/jpeg' || lower.includes('jpeg pasteboard')) {
          candidates.push({ item, type, mime: 'image/jpeg' })
        }
      }
    }
    for (const candidate of candidates) {
      try {
        const blob = await candidate.item.getType(candidate.type)
        if (!blob || !blob.size) continue
        const buffer = Buffer.from(await blob.arrayBuffer())
        if (buffer.length) return `data:${candidate.mime};base64,${buffer.toString('base64')}`
      } catch {
        /* 尝试下一个格式 */
      }
    }
    return null
  })

  ipcMain.handle('dialog:save', async (_event, { defaultName, type }) => {
    const filters =
      type === 'html'
        ? [{ name: 'HTML 文档', extensions: ['html'] }]
        : type === 'markdown'
          ? [{ name: 'Markdown 文档', extensions: ['md'] }]
          : [{ name: '所有文件', extensions: ['*'] }]
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出知识库',
      defaultPath: path.join(app.getPath('downloads'), defaultName || '知识库导出'),
      filters
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('file:writePath', async (_event, { filePath, content }) => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    await fsp.writeFile(filePath, content, 'utf8')
    return { path: filePath }
  })

  ipcMain.handle('export:zip', async () => {
    const root = config.root
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出知识库压缩包',
      defaultPath: path.join(app.getPath('downloads'), `${path.basename(root)}.zip`),
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return null
    await zipFolder(root, result.filePath)
    return { path: result.filePath }
  })

  ipcMain.handle('shell:openPath', async (_event, target) => {
    if (!target) return
    await shell.openPath(target)
  })

  ipcMain.handle('shell:showItem', async (_event, target) => {
    if (!target) return
    shell.showItemInFolder(target)
  })

  ipcMain.handle('shell:openExternal', async (_event, url) => {
    if (/^https?:/i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('ai:chat', async (event, payload) => runAiChat(event, payload))
  ipcMain.handle('ai:test', async () => testAi())
  ipcMain.handle('ai:abort', (_event, id) => {
    const controller = aiControllers.get(id)
    if (controller) controller.abort()
    aiControllers.delete(id)
    return { ok: true }
  })
}

/* ----------------------------------- AI ---------------------------------- */

async function testAi() {
  const { baseUrl, apiKey, model } = config.ai
  const response = await fetch(resolveChatUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '回复“连接成功”四个字' }],
      temperature: 0,
      max_tokens: 20,
      stream: false
    })
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}：${text.slice(0, 200)}`)
  }
  const data = await response.json()
  return { ok: true, text: data.choices?.[0]?.message?.content || '' }
}

async function runAiChat(event, payload) {
  const { id, messages, maxTokens } = payload || {}
  const { baseUrl, apiKey, model, temperature } = config.ai
  if (!baseUrl) throw new Error('请先在设置中配置 AI 接口地址')
  if (!apiKey && !/localhost|127\.0\.0\.1/.test(baseUrl)) {
    throw new Error('请先在设置中填写 API Key')
  }

  const controller = new AbortController()
  if (id) aiControllers.set(id, controller)
  const send = (data) => {
    if (!event.sender.isDestroyed()) event.sender.send('ai:event', { id, ...data })
  }

  try {
    const response = await fetch(resolveChatUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        max_tokens: maxTokens,
        stream: true
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`AI 接口返回 HTTP ${response.status}：${text.slice(0, 300)}`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream')) {
      const data = await response.json()
      const text = data.choices?.[0]?.message?.content || ''
      send({ type: 'delta', text })
      send({ type: 'done' })
      return { ok: true, text }
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content || ''
          if (delta) {
            full += delta
            send({ type: 'delta', text: delta })
          }
        } catch {
          /* 忽略不完整的数据帧 */
        }
      }
    }
    send({ type: 'done' })
    return { ok: true, text: full }
  } catch (error) {
    const message = error.name === 'AbortError' ? '已停止生成' : error.message
    send({ type: 'error', message })
    return { ok: false, error: message }
  } finally {
    if (id) aiControllers.delete(id)
  }
}

/* ---------------------------------- 压缩包 --------------------------------- */

function zipFolder(source, target) {
  return new Promise((resolve, reject) => {
    const archiver = require('archiver')
    const output = fs.createWriteStream(target)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(source, path.basename(source))
    archive.finalize()
  })
}

/* --------------------------------- 示例文档 --------------------------------- */

const WELCOME_DOC = `# 欢迎使用灵犀文档

灵犀文档是一个**本地优先**的 Markdown 知识库工具：所有文档都以 \`.md\` 文件的形式存放在你的电脑里，随时可以用其他编辑器打开。

## 三步开始

1. 在左侧目录树中新建文档或文件夹
2. 在中间区域书写 Markdown，右侧实时预览
3. 打开 AI 助手并勾选「使用本地知识库」，直接向你的知识库提问

> 小提示：直接粘贴截图，图片会自动保存到当前文档旁的 \`.assets\` 目录。

## 常用能力

- **知识库目录**：文件夹 + 文档的树形结构，清晰管理多层知识
- **知识库问答**：AI 自动检索本地知识库的相关片段，回答附带来源文档
- **实时预览**：标题、列表、表格、引用、代码块与高亮一应俱全
- **自动排版**：一键规范标题、列表与空行
- **AI 助手**：接入任意 OpenAI 兼容接口，支持流式输出
- **完整导出**：可导出 HTML 合集、Markdown 合集或整库 ZIP

## 代码示例

\`\`\`js
function greet(name) {
  return \`你好，\${name}！\`
}

console.log(greet('灵犀'))
\`\`\`

## 快捷操作

| 操作 | 快捷键 |
| --- | --- |
| 保存 | ⌘ / Ctrl + S |
| 新建文档 | ⌘ / Ctrl + N |
| 切换预览 | ⌘ / Ctrl + Shift + P |
| 自动排版 | ⌘ / Ctrl + Shift + L |
`

const SYNTAX_DOC = `# Markdown 语法速查

## 标题

\`\`\`markdown
# 一级标题
## 二级标题
### 三级标题
\`\`\`

## 强调与标记

\`\`\`markdown
**加粗文本**
*斜体文本*
~~删除线~~
==高亮文本==
\`\`\`

## 列表

\`\`\`markdown
- 无序列表
- 第二项

1. 有序列表
2. 第二项
\`\`\`

## 引用

> 这是一段引用文字。

## 表格

| 名称 | 说明 |
| --- | --- |
| 文档 | 以 .md 文件保存 |
| 图片 | 粘贴后自动归档到 .assets |

## 代码

行内代码：\`npm run dev\`

\`\`\`bash
npm install
npm run dev
\`\`\`

## 链接与图片

\`\`\`markdown
[链接文字](https://example.com)
![图片说明](./.assets/example.png)
\`\`\`
`

/* ---------------------------------- 启动 ---------------------------------- */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    config = loadConfig()
    saveConfig()
    await ensureRoot(config.root)
    protocol.handle('kbasset', async (request) => {
      try {
        const url = new URL(request.url)
        const filePath = url.searchParams.get('p')
        if (!filePath) return new Response('Missing path', { status: 400 })
        const data = await fsp.readFile(filePath)
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
        return new Response(data, { headers: { 'Content-Type': type } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
    registerIpc()
    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
