import { useEffect, useRef } from 'react'
import Vditor from 'vditor'
import lutePath from 'vditor/dist/js/lute/lute.min.js?url'
import 'vditor/dist/index.css'
import 'vditor/dist/js/i18n/zh_CN.js'
import 'vditor/dist/js/icons/ant.js'

const toolbar = [
  'headings',
  'bold',
  'italic',
  'list',
  'link',
  'table',
  'code',
  {
    name: 'more',
    toolbar: ['undo', 'redo', 'strike', 'quote', 'ordered-list', 'check', 'inline-code'],
  },
]

function markBundledIconsReady() {
  if (document.getElementById('vditorIconScript')) return
  const marker = document.createElement('script')
  marker.id = 'vditorIconScript'
  marker.type = 'application/json'
  document.head.appendChild(marker)
}

function applyHeadingShortcut(editor: Vditor, level: number) {
  const headingMenu = editor.vditor.toolbar?.elements?.headings
  const headingButton = headingMenu?.querySelector<HTMLButtonElement>(`button[data-tag="h${level}"]`)
  headingButton?.click()
}

function disposeEditor(editor: Vditor) {
  const state = editor as unknown as { vditor?: { element?: HTMLElement }; isDestroyed?: boolean }
  if (!state.vditor?.element) {
    state.isDestroyed = true
    return
  }
  editor.destroy()
}

export default function MarkdownEditor({ markdown, theme, onChange }: { markdown: string; theme: 'light' | 'dark'; onChange: (markdown: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  const initialMarkdownRef = useRef(markdown)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!hostRef.current) return
    markBundledIconsReady()

    let editor: Vditor | null = null
    let disposed = false
    let editorForm: HTMLFormElement | null = null
    let syncBeforeSubmit: (() => void) | null = null
    const publishValue = (value: string) => {
      if (inputRef.current) inputRef.current.value = value
      onChangeRef.current(value)
    }
    editor = new Vditor(hostRef.current, {
      _lutePath: lutePath,
      value: initialMarkdownRef.current,
      mode: 'ir',
      lang: 'zh_CN',
      theme: theme === 'dark' ? 'dark' : 'classic',
      cache: { enable: false },
      height: 'auto',
      minHeight: 340,
      placeholder: '记下此刻的想法…',
      toolbar,
      toolbarConfig: { pin: false },
      counter: { enable: false },
      resize: { enable: false },
      preview: {
        mode: 'editor',
        delay: 80,
        theme: { current: theme },
        hljs: { enable: false },
        markdown: {
          autoSpace: false,
          fixTermTypo: false,
          codeBlockPreview: true,
          mathBlockPreview: false,
        },
      },
      input: publishValue,
      keydown: (event) => {
        if (!editor || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return
        const level = Number(event.key)
        if (!Number.isInteger(level) || level < 1 || level > 6) return
        event.preventDefault()
        applyHeadingShortcut(editor, level)
      },
      after: () => {
        if (disposed || !editor) return
        const content = editor.vditor.ir?.element
        content?.setAttribute('role', 'textbox')
        content?.setAttribute('aria-label', 'editable markdown')
        content?.setAttribute('aria-multiline', 'true')
        const headingAction = editor.vditor.toolbar?.elements?.headings?.querySelector<HTMLButtonElement>(':scope > button')
        headingAction?.setAttribute('aria-label', '标题 <Ctrl+1 至 Ctrl+6>')
        editorForm = hostRef.current?.closest('form') || null
        syncBeforeSubmit = () => {
          if (editor) publishValue(editor.getValue())
        }
        editorForm?.addEventListener('submit', syncBeforeSubmit)
      },
    })

    return () => {
      disposed = true
      if (syncBeforeSubmit) editorForm?.removeEventListener('submit', syncBeforeSubmit)
      if (editor) disposeEditor(editor)
    }
  }, [theme])

  return (
    <>
      <div className="note-vditor-shell" ref={hostRef} />
      <input ref={inputRef} type="hidden" name="content" defaultValue={markdown} />
    </>
  )
}
