import { isTauri } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'
import { readFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { Note } from './data'

export type UserProfile = {
  username: string
  displayName: string
  bio: string
  spaceName: string
}

export type AppSettings = {
  sourceDirectory: string
  keepSourceCopy: boolean
  uploadAfterImport: boolean
}

export type SelectedKnowledgeDocument = {
  fileName: string
  sourcePath: string
  bytes: Uint8Array
  mimeType: string
  supportedForIndexing: boolean
}

export const defaultProfile: UserProfile = {
  username: 'lzc',
  displayName: '林知远',
  bio: '持续整理，持续思考。',
  spaceName: '个人空间',
}

export const defaultSettings: AppSettings = {
  sourceDirectory: '',
  keepSourceCopy: true,
  uploadAfterImport: true,
}

const databasePath = 'sqlite:zhixu.db'
let databasePromise: Promise<Database> | null = null
let notesLoadPromise: Promise<Note[]> | null = null

const getDatabase = () => {
  databasePromise ??= Database.load(databasePath).then(async (database) => {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        tag TEXT NOT NULL,
        collection TEXT NOT NULL,
        updated TEXT NOT NULL,
        read_time INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        favorite INTEGER NOT NULL DEFAULT 0
      )
    `)
    await database.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
    await database.execute(`
      CREATE TABLE IF NOT EXISTS document_sources (
        document_id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        local_path TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    return database
  })
  return databasePromise
}

const fromRow = (row: Record<string, unknown>): Note => ({
  id: Number(row.id),
  title: String(row.title),
  summary: String(row.summary),
  content: String(row.content),
  tag: String(row.tag),
  collection: String(row.collection),
  updated: String(row.updated),
  readTime: Number(row.read_time),
  pinned: Boolean(row.pinned),
  favorite: Boolean(row.favorite),
})

const saveToDatabase = async (database: Database, notes: Note[]) => {
  await database.execute('DELETE FROM notes')
  for (const note of notes) {
    await database.execute(
      `INSERT INTO notes (id, title, summary, content, tag, collection, updated, read_time, pinned, favorite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [note.id, note.title, note.summary, note.content, note.tag, note.collection, note.updated, note.readTime, note.pinned ? 1 : 0, note.favorite ? 1 : 0],
    )
  }
}

export async function loadNotes(fallback: Note[]): Promise<Note[]> {
  if (!isTauri()) {
    const saved = localStorage.getItem('zhixu-notes')
    return saved ? (JSON.parse(saved) as Note[]) : fallback
  }
  notesLoadPromise ??= (async () => {
    const database = await getDatabase()
    const rows = await database.select<Record<string, unknown>[]>('SELECT * FROM notes ORDER BY id DESC')
    if (rows.length) return rows.map(fromRow)
    await saveToDatabase(database, fallback)
    return fallback
  })()
  return notesLoadPromise
}

export async function persistNotes(notes: Note[]) {
  if (!isTauri()) {
    localStorage.setItem('zhixu-notes', JSON.stringify(notes))
    return
  }
  await saveToDatabase(await getDatabase(), notes)
}

export async function loadProfile(): Promise<UserProfile> {
  if (!isTauri()) {
    const saved = localStorage.getItem('zhixu-profile')
    return saved ? { ...defaultProfile, ...(JSON.parse(saved) as Partial<UserProfile>) } : defaultProfile
  }
  const database = await getDatabase()
  const rows = await database.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', ['profile'])
  return rows.length ? { ...defaultProfile, ...(JSON.parse(rows[0].value) as Partial<UserProfile>) } : defaultProfile
}

export async function persistProfile(profile: UserProfile) {
  if (!isTauri()) {
    localStorage.setItem('zhixu-profile', JSON.stringify(profile))
    return
  }
  const database = await getDatabase()
  await database.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['profile', JSON.stringify(profile)],
  )
}

export async function loadSettings(): Promise<AppSettings> {
  if (!isTauri()) {
    const saved = localStorage.getItem('zhixu-settings')
    return saved ? { ...defaultSettings, ...(JSON.parse(saved) as Partial<AppSettings>) } : defaultSettings
  }
  const database = await getDatabase()
  const rows = await database.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', ['app'])
  return rows.length ? { ...defaultSettings, ...(JSON.parse(rows[0].value) as Partial<AppSettings>) } : defaultSettings
}

export async function persistSettings(settings: AppSettings) {
  if (!isTauri()) {
    localStorage.setItem('zhixu-settings', JSON.stringify(settings))
    return
  }
  const database = await getDatabase()
  await database.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['app', JSON.stringify(settings)],
  )
}

export async function selectSourceDirectory(): Promise<string | null> {
  if (!isTauri()) return null
  const selected = await open({ directory: true, multiple: false })
  return typeof selected === 'string' ? selected : null
}

export async function selectKnowledgeDocument(): Promise<SelectedKnowledgeDocument | null> {
  if (!isTauri()) return null
  const selected = await open({
    multiple: false,
    filters: [{ name: '知识文档', extensions: ['md', 'markdown', 'txt', 'pdf', 'docx', 'html', 'htm', 'epub', 'csv'] }],
  })
  if (!selected || Array.isArray(selected)) return null
  const fileName = selected.split(/[\\/]/).pop() || 'document.txt'
  const markdown = /\.md$|\.markdown$/i.test(fileName)
  const plainText = /\.txt$/i.test(fileName)
  const mimeType = markdown ? 'text/markdown' : plainText ? 'text/plain' : mimeTypeFor(fileName)
  return {
    fileName,
    sourcePath: selected,
    bytes: await readFile(selected),
    mimeType,
    supportedForIndexing: markdown || plainText,
  }
}

export async function preserveSourceFile(document: SelectedKnowledgeDocument, directory: string) {
  if (!isTauri() || !directory) return null
  const separator = directory.includes('\\') ? '\\' : '/'
  const normalized = directory.replace(/[\\/]$/, '')
  const destination = `${normalized}${separator}${document.fileName}`
  if (destination.toLowerCase() !== document.sourcePath.toLowerCase()) {
    await writeFile(destination, document.bytes)
  }
  return destination
}

export async function saveDocumentSource(documentId: string, fileName: string, localPath: string) {
  if (!isTauri()) return
  const database = await getDatabase()
  await database.execute(
    `INSERT INTO document_sources (document_id, file_name, local_path, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(document_id) DO UPDATE SET file_name = excluded.file_name, local_path = excluded.local_path, updated_at = excluded.updated_at`,
    [documentId, fileName, localPath, new Date().toISOString()],
  )
}

export async function loadDocumentSources(): Promise<Record<string, string>> {
  if (!isTauri()) return {}
  const database = await getDatabase()
  const rows = await database.select<{ document_id: string; local_path: string }[]>('SELECT document_id, local_path FROM document_sources')
  return Object.fromEntries(rows.map((row) => [row.document_id, row.local_path]))
}

export async function removeDocumentSource(documentId: string) {
  if (!isTauri()) return
  await (await getDatabase()).execute('DELETE FROM document_sources WHERE document_id = $1', [documentId])
}

export async function openSourceFile(path: string) {
  if (!isTauri()) throw new Error('浏览器模式不能打开本机源文件')
  const { openPath } = await import('@tauri-apps/plugin-opener')
  await openPath(path)
}

function mimeTypeFor(fileName: string) {
  if (/\.pdf$/i.test(fileName)) return 'application/pdf'
  if (/\.docx$/i.test(fileName)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (/\.html?$/i.test(fileName)) return 'text/html'
  if (/\.epub$/i.test(fileName)) return 'application/epub+zip'
  if (/\.csv$/i.test(fileName)) return 'text/csv'
  return 'application/octet-stream'
}

export async function exportMarkdown(notes: Note[]) {
  if (!isTauri()) return
  const path = await save({ defaultPath: 'zhixu-notes.md', filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (!path) return
  const markdown = notes.map((note) => `# ${note.title}\n\n> ${note.collection} · ${note.tag}\n\n${note.content}`).join('\n\n---\n\n')
  await writeTextFile(path, markdown)
}
