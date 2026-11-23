export function normalizePath(input) {
  return String(input || '').replace(/\\/g, '/')
}

export function basename(input) {
  const normalized = normalizePath(input).replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}

export function stripMdExtension(name) {
  return String(name || '').replace(/\.(md|markdown)$/i, '')
}

export function dirname(input) {
  const normalized = normalizePath(input).replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return normalized.startsWith('/') ? '/' : ''
  return normalized.slice(0, idx)
}

export function isAbsolutePath(input) {
  const normalized = normalizePath(input)
  return normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)
}

export function resolvePath(baseDir, relative) {
  const rel = normalizePath(relative)
  if (isAbsolutePath(rel)) return rel
  const parts = normalizePath(baseDir).split('/')
  for (const segment of rel.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 1) parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

export function assetUrl(absPath) {
  return `kbasset://local/?p=${encodeURIComponent(normalizePath(absPath))}`
}

export function isExternalUrl(src) {
  return /^(https?:|data:|mailto:|kbasset:|blob:)/i.test(String(src || ''))
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatTime(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
  const now = new Date()
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function debounce(fn, wait = 200) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function countWords(text) {
  return String(text || '').replace(/\s+/g, '').length
}
