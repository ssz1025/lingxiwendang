const fsp = require('node:fs/promises')
const path = require('node:path')

const SKIP_DIRS = new Set(['node_modules', '.assets', '.git', '.obsidian', '.trash'])
const MAX_FILES = 800
const MAX_CHUNK = 900
const CACHE_TTL = 20000

let cache = { root: '', at: 0, chunks: [], df: new Map(), total: 0 }

function invalidate() {
  cache = { root: '', at: 0, chunks: [], df: new Map(), total: 0 }
}

async function collectMarkdown(root, out = [], depth = 0) {
  if (depth > 8 || out.length >= MAX_FILES) return out
  let entries = []
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break
    if (entry.name.startsWith('.')) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await collectMarkdown(full, out, depth + 1)
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function splitLong(text, max = MAX_CHUNK) {
  if (text.length <= max) return [text]
  const pieces = []
  let rest = text
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max)
    if (cut < max * 0.4) cut = rest.lastIndexOf('\n', max)
    if (cut < max * 0.4) cut = max
    pieces.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) pieces.push(rest)
  return pieces
}

function chunkFile(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const chunks = []
  let headings = []
  let buffer = []
  let inFence = false

  const flush = () => {
    const raw = buffer.join('\n').trim()
    buffer = []
    if (!raw) return
    for (const piece of splitLong(raw)) {
      chunks.push({
        heading: headings.filter(Boolean).join(' / '),
        text: piece
      })
    }
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence
    const match = !inFence && /^(#{1,6})\s+(.*)$/.exec(line)
    if (match) {
      flush()
      const level = match[1].length
      headings = headings.slice(0, level - 1)
      headings[level - 1] = match[2].trim()
    } else {
      buffer.push(line)
    }
  }
  flush()
  return chunks
}

function tokenize(text) {
  const tokens = []
  const lower = String(text || '').toLowerCase()
  const latin = lower.match(/[a-z0-9][a-z0-9_+#.-]{1,}/g)
  if (latin) tokens.push(...latin)
  const cjkRuns = lower.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || []
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

function countTokens(tokens) {
  const map = new Map()
  for (const token of tokens) map.set(token, (map.get(token) || 0) + 1)
  return map
}

async function buildIndex(root) {
  const files = await collectMarkdown(root)
  const chunks = []
  const df = new Map()
  let totalLength = 0

  for (const file of files) {
    let content = ''
    try {
      content = await fsp.readFile(file, 'utf8')
    } catch {
      continue
    }
    const title = path.basename(file).replace(/\.(md|markdown)$/i, '')
    const folder = path.dirname(file) === root ? '' : path.relative(root, path.dirname(file))
    const rawChunks = chunkFile(content)

    for (const chunk of rawChunks) {
      const rawHeading = chunk.heading || ''
      const segments = rawHeading.split(' / ').filter(Boolean)
      if (segments[0] === title) segments.shift()
      const heading = segments.join(' / ')
      const text = `${heading ? `## ${heading}\n` : ''}${chunk.text}`.trim()
      if (!text) continue
      const tf = countTokens(tokenize(text))
      const length = [...tf.values()].reduce((sum, value) => sum + value, 0)
      if (!length) continue
      chunks.push({ path: file, title, folder, heading, text, tf, length })
      totalLength += length
      for (const token of tf.keys()) df.set(token, (df.get(token) || 0) + 1)
    }
  }

  const avgLength = chunks.length ? totalLength / chunks.length : 1
  return { root, at: Date.now(), chunks, df, total: chunks.length, avgLength, docs: files.length }
}

async function ensureIndex(root) {
  if (cache.root === root && Date.now() - cache.at < CACHE_TTL && cache.chunks.length) {
    return cache
  }
  cache = await buildIndex(root)
  return cache
}

async function retrieve(root, query, options = {}) {
  const text = String(query || '').trim()
  if (!text) return { chunks: [], docs: 0 }
  const limit = Math.min(Math.max(Number(options.limit) || 6, 1), 12)
  const index = await ensureIndex(root)
  if (!index.chunks.length) return { chunks: [], docs: 0 }

  const queryTokens = [...new Set(tokenize(text))]
  if (!queryTokens.length) return { chunks: [], docs: 0 }

  const N = index.chunks.length
  const avgLength = index.avgLength || 1
  const k1 = 1.5
  const b = 0.72
  const scored = []

  for (const chunk of index.chunks) {
    let score = 0
    let matched = 0
    const headTokens = new Set(tokenize(`${chunk.title} ${chunk.heading}`))
    for (const token of queryTokens) {
      const tf = chunk.tf.get(token)
      if (!tf) continue
      matched += 1
      const df = index.df.get(token) || 1
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
      const norm = 1 - b + (b * chunk.length) / avgLength
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * norm))
      if (headTokens.has(token)) score += idf * 1.4
    }
    if (score <= 0) continue
    score *= 1 + 0.25 * (matched / queryTokens.length)
    scored.push({ chunk, score })
  }

  scored.sort((a, b2) => b2.score - a.score)
  const picked = scored.slice(0, limit)
  return {
    docs: index.docs,
    chunks: picked.map(({ chunk, score }) => ({
      path: chunk.path,
      title: chunk.title,
      folder: chunk.folder,
      heading: chunk.heading,
      score: Number(score.toFixed(3)),
      text: chunk.text.slice(0, 1400)
    }))
  }
}

module.exports = { retrieve, invalidate }
