import { basicSetup } from 'codemirror'
import { EditorState, Prec } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, placeholder } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const HL_OPEN_RE = /^:::\s*hl(?:[\s-]+([a-zA-Z]+))?\s*$/
const HL_CLOSE_RE = /^:::\s*$/
const HL_COLORS = new Set(['yellow', 'green', 'blue', 'pink', 'purple', 'gray'])

const hlLineCache = new Map()

function hlLineDecoration(className) {
  let deco = hlLineCache.get(className)
  if (!deco) {
    deco = Decoration.line({ class: className })
    hlLineCache.set(className, deco)
  }
  return deco
}

function buildHlDecorations(doc) {
  const blocks = []
  let active = null
  for (let n = 1; n <= doc.lines; n += 1) {
    const text = doc.line(n).text.trim()
    if (!active) {
      const match = HL_OPEN_RE.exec(text)
      if (match) {
        const color = (match[1] || '').toLowerCase()
        active = { color: HL_COLORS.has(color) ? color : 'yellow', start: n }
      }
    } else if (HL_CLOSE_RE.test(text)) {
      blocks.push({ ...active, end: n })
      active = null
    }
  }

  const decorations = []
  for (const block of blocks) {
    for (let n = block.start; n <= block.end; n += 1) {
      const classes = ['cm-hl-line', `cm-hl-${block.color}`]
      if (n === block.start) classes.push('cm-hl-first')
      if (n === block.end) classes.push('cm-hl-last')
      decorations.push(hlLineDecoration(classes.join(' ')).range(doc.line(n).from))
    }
  }
  return Decoration.set(decorations)
}

const hlBlockDecorations = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildHlDecorations(view.state.doc)
    }

    update(update) {
      if (update.docChanged) this.decorations = buildHlDecorations(update.state.doc)
    }
  },
  { decorations: (value) => value.decorations }
)

const highlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: '700', color: 'var(--cm-heading)', lineHeight: '1.45' },
  { tag: tags.heading2, fontSize: '1.28em', fontWeight: '700', color: 'var(--cm-heading)', lineHeight: '1.5' },
  { tag: tags.heading3, fontSize: '1.13em', fontWeight: '600', color: 'var(--cm-heading)' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600', color: 'var(--cm-heading)' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--cm-strong)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--cm-em)' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--cm-punct)' },
  { tag: tags.link, color: 'var(--cm-link)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--cm-link)' },
  { tag: tags.quote, color: 'var(--cm-quote)', fontStyle: 'italic' },
  { tag: tags.monospace, color: 'var(--cm-code)', fontFamily: 'var(--font-mono)' },
  { tag: tags.keyword, color: 'var(--cm-keyword)' },
  { tag: tags.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--cm-number)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--cm-string)' },
  { tag: [tags.function(tags.variableName), tags.className], color: 'var(--cm-function)' },
  { tag: tags.operator, color: 'var(--cm-keyword)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--cm-mark)' },
  { tag: tags.punctuation, color: 'var(--cm-punct)' },
  { tag: tags.invalid, color: '#e5484d' }
])

const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--text)',
      fontSize: '15px'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-sans)',
      lineHeight: '1.85',
      padding: '30px 0 90px',
      overflow: 'auto'
    },
    '.cm-content': {
      padding: '0 44px',
      maxWidth: '900px',
      margin: '0 auto',
      caretColor: 'var(--accent)',
      width: '100%'
    },
    '.cm-line': { padding: '0 2px' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--text-3)',
      paddingLeft: '10px',
      userSelect: 'none'
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--accent)' },
    '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '.cm-placeholder': { color: 'var(--text-3)' },
    '.cm-panels': { backgroundColor: 'var(--bg-sub)', color: 'var(--text)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
    '.cm-searchMatch': { backgroundColor: 'var(--search-match)', outline: '1px solid var(--accent-soft-border)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--search-match-active)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-md)'
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent-soft)',
      color: 'var(--text)'
    }
  },
  { dark: false }
)

function extractImageSrc(html) {
  if (!html) return ''
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const src = parsed.querySelector('img')?.getAttribute('src') || ''
    return /^(data:image\/|https?:\/\/|kbasset:)/i.test(src) ? src : ''
  } catch {
    return ''
  }
}

export function createEditor({
  parent,
  onChange,
  onPasteImage,
  onPasteImageSrc,
  onDropImage,
  onSave,
  onFormat,
  onTogglePreview
}) {
  let muted = false

  const extensions = [
    basicSetup,
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,
    editorTheme,
    syntaxHighlighting(highlightStyle),
    hlBlockDecorations,
    placeholder('开始书写 Markdown…'),
    Prec.high(
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            onSave?.()
            return true
          }
        },
        {
          key: 'Mod-Shift-l',
          run: () => {
            onFormat?.()
            return true
          }
        },
        {
          key: 'Mod-Shift-p',
          run: () => {
            onTogglePreview?.()
            return true
          }
        },
        { key: 'Mod-b', run: (view) => wrapSelection(view, '**', '**') },
        { key: 'Mod-i', run: (view) => wrapSelection(view, '*', '*') },
        { key: 'Mod-Shift-x', run: (view) => wrapSelection(view, '~~', '~~') },
        { key: 'Mod-Shift-h', run: (view) => wrapSelection(view, '==', '==') },
        { key: 'Mod-Alt-b', run: (view) => applyHighlightBlock(view) },
        { key: 'Mod-Alt-1', run: (view) => setHeading(view, 1) },
        { key: 'Mod-Alt-2', run: (view) => setHeading(view, 2) },
        { key: 'Mod-Alt-3', run: (view) => setHeading(view, 3) },
        indentWithTab
      ])
    ),
    EditorView.domEventHandlers({
      paste(event, view) {
        const data = event.clipboardData
        if (!data) return false
        const position = view.state.selection.main.from
        const items = Array.from(data.items || [])
        const imageItem = items.find((item) => item.type.startsWith('image/'))
        let file = imageItem?.getAsFile?.() || null
        if (!file) {
          file = Array.from(data.files || []).find((item) => item.type.startsWith('image/')) || null
        }
        if (file) {
          event.preventDefault()
          onPasteImage?.(file, position)
          return true
        }

        const imageSrc = extractImageSrc(data.getData('text/html'))
        if (imageSrc) {
          event.preventDefault()
          onPasteImageSrc?.(imageSrc, position)
          return true
        }

        const text = data.getData('text/plain')
        const types = Array.from(data.types || [])
        const imageOnly = !text && types.every((type) => type.startsWith('image/') || type === 'Files')
        if (imageOnly && window.api?.readClipboardImage) {
          event.preventDefault()
          window.api
            .readClipboardImage()
            .then((dataUrl) => {
              if (dataUrl) onPasteImageSrc?.(dataUrl, position)
            })
            .catch(() => {})
          return true
        }
        return false
      },
      drop(event, view) {
        const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
          file.type.startsWith('image/')
        )
        if (!files.length) return false
        event.preventDefault()
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from
        files.forEach((file, index) => onDropImage?.(file, pos + index))
        return true
      }
    }),
    EditorView.updateListener.of((update) => {
      if (muted) return
      if (!update.docChanged) return
      onChange?.(update.view.state.doc.toString())
    })
  ]

  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) })

  function wrapSelection(editorView, before, after) {
    const { from, to } = editorView.state.selection.main
    const selected = editorView.state.sliceDoc(from, to)
    if (!selected) {
      editorView.dispatch({
        changes: { from, to, insert: `${before}${after}` },
        selection: { anchor: from + before.length }
      })
    } else {
      editorView.dispatch({
        changes: { from, to, insert: `${before}${selected}${after}` },
        selection: { anchor: from + before.length, head: from + before.length + selected.length }
      })
    }
    editorView.focus()
    return true
  }

  function setHeading(editorView, level) {
    const line = editorView.state.doc.lineAt(editorView.state.selection.main.from)
    const text = line.text.replace(/^\s{0,3}#{1,6}\s*/, '')
    const prefix = `${'#'.repeat(level)} `
    editorView.dispatch({
      changes: { from: line.from, to: line.to, insert: prefix + text.trim() },
      selection: { anchor: line.from + prefix.length + text.trim().length }
    })
    editorView.focus()
    return true
  }

  function applyHighlightBlock(editorView, color = 'yellow') {
    const doc = editorView.state.doc
    const { from, to } = editorView.state.selection.main
    const startLine = doc.lineAt(from)
    const endLine = doc.lineAt(to)
    const prevLine = startLine.number > 1 ? doc.line(startLine.number - 1) : null
    const nextLine = endLine.number < doc.lines ? doc.line(endLine.number + 1) : null
    const wrapped =
      prevLine && nextLine && HL_OPEN_RE.test(prevLine.text.trim()) && HL_CLOSE_RE.test(nextLine.text.trim())

    if (wrapped) {
      if (color === 'none') {
        editorView.dispatch({
          changes: [
            { from: prevLine.from, to: startLine.from },
            { from: endLine.to, to: nextLine.to }
          ],
          selection: { anchor: prevLine.from }
        })
        editorView.focus()
        return true
      }
      const marker = color === 'yellow' ? ':::hl' : `:::hl ${color}`
      editorView.dispatch({ changes: { from: prevLine.from, to: prevLine.to, insert: marker } })
      editorView.focus()
      return true
    }

    if (color === 'none') return true

    const leading = prevLine && prevLine.text.trim() ? '\n' : ''
    const trailing = nextLine && nextLine.text.trim() ? '\n' : ''
    const name = HL_COLORS.has(color) ? color : 'yellow'
    const marker = name === 'yellow' ? ':::hl' : `:::hl ${name}`
    const inner = doc.sliceString(startLine.from, endLine.to)
    const insert = `${leading}${marker}\n${inner}\n:::${trailing}`
    const innerFrom = startLine.from + leading.length + marker.length + 1
    editorView.dispatch({
      changes: { from: startLine.from, to: endLine.to, insert },
      selection: { anchor: innerFrom, head: innerFrom + inner.length }
    })
    editorView.focus()
    return true
  }

  return {
    view,
    toggleHighlightBlock(color) {
      return applyHighlightBlock(view, color)
    },
    setContent(content) {
      muted = true
      view.setState(EditorState.create({ doc: String(content ?? ''), extensions }))
      muted = false
    },
    getContent() {
      return view.state.doc.toString()
    },
    setCursorLine(lineNumber) {
      const total = view.state.doc.lines
      const target = Math.max(1, Math.min(lineNumber, total))
      const line = view.state.doc.line(target)
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
      view.focus()
    },
    getSelection() {
      const { from, to } = view.state.selection.main
      return { from, to, text: view.state.sliceDoc(from, to) }
    },
    insertText(text, pos) {
      const at = typeof pos === 'number' ? pos : view.state.selection.main.from
      view.dispatch({
        changes: { from: at, insert: text },
        selection: { anchor: at + text.length },
        scrollIntoView: true
      })
      view.focus()
    },
    replaceContent(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 }
      })
    },
    focus() {
      view.focus()
    },
    destroy() {
      view.destroy()
    }
  }
}
