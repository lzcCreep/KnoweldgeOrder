import { invoke, isTauri } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import Database from '@tauri-apps/plugin-sql'
import { mkdir, readDir, readFile, readTextFile, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { open, save } from '@tauri-apps/plugin-dialog'
import { collections, type Collection, type Note, type SyncStatus } from './data'

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
  notificationsEnabled: boolean
  appearance: 'system' | 'light' | 'dark'
  aiBaseUrl: string
  aiApiKey: string
  aiModel: string
  aiTemperature: number
  aiMaxTokens: number
}

export type TodoItem = {
  id: string
  text: string
  completed: boolean
  day: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  spaceId?: string
  revision: number
  syncStatus: SyncStatus
  syncError: string | null
}

export type SelectedKnowledgeDocument = {
  fileName: string
  sourcePath: string
  bytes: Uint8Array
  mimeType: string
  supportedForIndexing: boolean
}

export type LocalKnowledgeFile = {
  id: string
  name: string
  relativePath: string
  path: string
  mimeType: 'text/markdown' | 'text/plain'
  size: number
  updatedAt: string
  storage: 'filesystem' | 'browser'
  collection: string
  favorite: boolean
  archived: boolean
  archiveFolderId: string | null
  inDatabase: boolean
}

export type ArchiveFolder = {
  id: string
  spaceId?: string
  parentId: string | null
  name: string
  createdAt: string
  updatedAt: string
}

export const defaultProfile: UserProfile = {
  username: 'lzc',
  displayName: '林知远',
  bio: '持续整理，持续思考。',
  spaceName: '个人空间',
}

export const defaultSettings: AppSettings = {
  sourceDirectory: 'knowledge-files',
  keepSourceCopy: true,
  uploadAfterImport: true,
  notificationsEnabled: true,
  appearance: 'system',
  aiBaseUrl: '',
  aiApiKey: '',
  aiModel: '',
  aiTemperature: 0.2,
  aiMaxTokens: 1200,
}

const draftCollection = '草稿箱'
const legacyInboxCollection = '收件箱'

let databasePathPromise: Promise<string> | null = null
let databasePromise: Promise<Database> | null = null

const browserNotesKey = 'zhixu-notes-v2'
const browserQueueKey = 'zhixu-sync-queue'
const browserCollectionsKey = 'zhixu-collections'
const browserTodosKey = 'zhixu-todos'
const browserKnowledgeFilesKey = 'zhixu-knowledge-files-v1'
const browserArchiveFoldersKey = 'zhixu-archive-folders-v1'

type BrowserKnowledgeFile = LocalKnowledgeFile & {
  directory: string
  content: string
}

type NoteRow = Record<string, unknown>

export type PendingNoteChange = {
  operation: 'upsert' | 'delete'
  note: Note
}

type BrowserQueueItem = {
  entityId: string
  operation: PendingNoteChange['operation']
  attemptCount: number
  lastError: string | null
  updatedAt: string
}

const resolveDatabasePath = () => {
  databasePathPromise ??= invoke<string>('resolve_database_path').then((path) => `sqlite:${path}`)
  return databasePathPromise
}

const getDatabase = () => {
  databasePromise ??= resolveDatabasePath().then((databasePath) => Database.load(databasePath)).then(async (database) => {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS local_notes (
        id TEXT PRIMARY KEY,
        space_id TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        tag TEXT NOT NULL,
        collection TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        read_time INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        favorite INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        sync_error TEXT,
        deleted_at TEXT
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
    await database.execute(`
      CREATE TABLE IF NOT EXISTS local_archive_folders (
        id TEXT PRIMARY KEY,
        space_id TEXT,
        parent_id TEXT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    await database.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS local_archive_folder_name_idx
      ON local_archive_folders(coalesce(space_id, ''), coalesce(parent_id, ''), name)
    `)
    await database.execute(`
      CREATE TABLE IF NOT EXISTS local_archive_items (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        folder_id TEXT,
        archived_at TEXT NOT NULL,
        PRIMARY KEY(entity_type, entity_id)
      )
    `)
    await database.execute(`
      CREATE TABLE IF NOT EXISTS local_knowledge_metadata (
        file_id TEXT PRIMARY KEY,
        relative_path TEXT NOT NULL,
        collection TEXT NOT NULL DEFAULT '草稿箱',
        favorite INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `)
    await database.execute(`
      CREATE TABLE IF NOT EXISTS local_todos (
        id TEXT PRIMARY KEY,
        space_id TEXT,
        text TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        day TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        sync_error TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    await ensureLocalTodoColumns(database)
    await database.execute(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(entity_type, entity_id)
      )
    `)
    await database.execute(`
      CREATE TRIGGER IF NOT EXISTS local_notes_queue_insert
      AFTER INSERT ON local_notes
      WHEN NEW.sync_status = 'pending'
      BEGIN
        INSERT INTO sync_queue (id, entity_type, entity_id, operation, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), 'note', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.updated_at, NEW.updated_at)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          operation = excluded.operation,
          attempt_count = 0,
          last_error = NULL,
          updated_at = excluded.updated_at;
      END
    `)
    await database.execute(`
      CREATE TRIGGER IF NOT EXISTS local_notes_queue_update
      AFTER UPDATE ON local_notes
      WHEN NEW.sync_status = 'pending' AND (
        OLD.title IS NOT NEW.title OR OLD.content IS NOT NEW.content OR
        OLD.favorite IS NOT NEW.favorite OR OLD.deleted_at IS NOT NEW.deleted_at OR
        OLD.sync_status IS NOT NEW.sync_status OR OLD.updated_at IS NOT NEW.updated_at
      )
      BEGIN
        INSERT INTO sync_queue (id, entity_type, entity_id, operation, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), 'note', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.updated_at, NEW.updated_at)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          operation = excluded.operation,
          attempt_count = 0,
          last_error = NULL,
          updated_at = excluded.updated_at;
      END
    `)
    await migrateLegacyNotes(database)
    return database
  })
  return databasePromise
}

async function ensureLocalTodoColumns(database: Database) {
  const columns = await database.select<{ name: string }[]>('PRAGMA table_info(local_todos)')
  const existing = new Set(columns.map((column) => column.name))
  const additions = [
    ['space_id', 'TEXT'],
    ['text', "TEXT NOT NULL DEFAULT ''"],
    ['completed', 'INTEGER NOT NULL DEFAULT 0'],
    ['day', "TEXT NOT NULL DEFAULT ''"],
    ['revision', 'INTEGER NOT NULL DEFAULT 0'],
    ['sync_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['sync_error', 'TEXT'],
    ['deleted_at', 'TEXT'],
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ] as const
  for (const [name, definition] of additions) {
    if (!existing.has(name)) await database.execute(`ALTER TABLE local_todos ADD COLUMN ${name} ${definition}`)
  }
  const now = new Date().toISOString()
  await database.execute("UPDATE local_todos SET day = $1 WHERE day IS NULL OR day = ''", [localDayKey()])
  await database.execute("UPDATE local_todos SET created_at = $1 WHERE created_at IS NULL OR created_at = ''", [now])
  await database.execute("UPDATE local_todos SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''")
}

const fromRow = (row: NoteRow): Note => ({
  id: String(row.id),
  title: String(row.title),
  summary: String(row.summary),
  content: String(row.content),
  tag: String(row.tag),
  collection: normalizeCollectionName(String(row.collection)),
  updated: formatUpdatedAt(String(row.updated_at)),
  readTime: Number(row.read_time),
  pinned: Boolean(row.pinned),
  favorite: Boolean(row.favorite),
  revision: Number(row.revision || 0),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  spaceId: row.space_id ? String(row.space_id) : undefined,
  syncStatus: String(row.sync_status || 'pending') as SyncStatus,
  syncError: row.sync_error ? String(row.sync_error) : null,
  archived: Boolean(row.archive_item_id),
  archiveFolderId: row.archive_folder_id ? String(row.archive_folder_id) : null,
})

async function migrateLegacyNotes(database: Database) {
  const migrated = await database.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', ['local_notes_v2_migrated'])
  if (migrated.length) return

  const legacyTable = await database.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
  )
  if (legacyTable.length) {
    const deviceId = await getOrCreateDeviceId(database)
    const rows = await database.select<NoteRow[]>('SELECT * FROM notes ORDER BY id DESC')
    for (const row of rows) {
      const rawId = String(row.id)
      const id = rawId.startsWith('nte_') ? rawId : `nte_${deviceId.replaceAll('-', '')}_${rawId}`
      const timestamp = new Date().toISOString()
      await database.execute(
        `INSERT OR IGNORE INTO local_notes
          (id, title, summary, content, tag, collection, created_at, updated_at, read_time, pinned, favorite, revision, sync_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, 0, 'pending')`,
        [id, row.title, row.summary, row.content, row.tag, row.collection, timestamp,
          Number(row.read_time || 1), row.pinned ? 1 : 0, row.favorite ? 1 : 0],
      )
    }
  }
  await database.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['local_notes_v2_migrated', new Date().toISOString()],
  )
}

async function getOrCreateDeviceId(database: Database) {
  const rows = await database.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', ['device_id'])
  if (rows.length) return rows[0].value
  const deviceId = createUuid()
  await database.execute('INSERT INTO settings (key, value) VALUES ($1, $2)', ['device_id', deviceId])
  return deviceId
}

export async function loadNotes(fallback: Note[] = []): Promise<Note[]> {
  if (!isTauri()) {
    const saved = localStorage.getItem(browserNotesKey) || localStorage.getItem('zhixu-notes')
    if (!saved) return fallback
    const parsed = (JSON.parse(saved) as Note[]).map(normalizeBrowserNote)
    localStorage.setItem(browserNotesKey, JSON.stringify(parsed))
    parsed.filter((note) => note.syncStatus !== 'synced').forEach(enqueueBrowserNote)
    return parsed.filter((note) => !note.deletedAt)
  }
  const rows = await (await getDatabase()).select<NoteRow[]>(
    `SELECT n.*, ai.entity_id AS archive_item_id, ai.folder_id AS archive_folder_id
     FROM local_notes n LEFT JOIN local_archive_items ai
       ON ai.entity_type = 'note' AND ai.entity_id = n.id
     WHERE n.deleted_at IS NULL ORDER BY n.updated_at DESC`,
  )
  return rows.map(fromRow)
}

export async function createLocalNote(input: { title: string; content: string; collection: string; spaceId?: string; archived?: boolean; archiveFolderId?: string | null }): Promise<Note> {
  const timestamp = new Date().toISOString()
  const note: Note = {
    id: `nte_${createUuid()}`,
    title: input.title,
    summary: summarize(input.content),
    content: input.content,
    tag: '本地笔记',
    collection: input.collection,
    updated: formatUpdatedAt(timestamp),
    readTime: readingTime(input.content),
    favorite: false,
    pinned: false,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncStatus: 'pending',
    syncError: null,
    spaceId: input.spaceId,
    archived: Boolean(input.archived),
    archiveFolderId: input.archived ? input.archiveFolderId || null : null,
  }
  if (!isTauri()) {
    writeBrowserNote(note)
    enqueueBrowserNote(note)
    return note
  }
  await insertNote(await getDatabase(), note)
  return note
}

export async function updateLocalNote(id: Note['id'], patch: Partial<Pick<Note, 'title' | 'content' | 'collection' | 'tag' | 'favorite' | 'pinned' | 'archived' | 'archiveFolderId'>>): Promise<Note> {
  const current = await findStoredNote(String(id))
  if (!current) throw new Error('本地笔记不存在')
  const timestamp = new Date().toISOString()
  const next: Note = {
    ...current,
    ...patch,
    summary: patch.content === undefined ? current.summary : summarize(patch.content),
    readTime: patch.content === undefined ? current.readTime : readingTime(patch.content),
    updated: formatUpdatedAt(timestamp),
    updatedAt: timestamp,
    syncStatus: 'pending',
    syncError: null,
  }
  if (!isTauri()) {
    writeBrowserNote(next)
    enqueueBrowserNote(next)
    return next
  }
  await insertNote(await getDatabase(), next)
  return next
}

export async function deleteLocalNote(id: Note['id']) {
  const current = await findStoredNote(String(id))
  if (!current) throw new Error('本地笔记不存在')
  const timestamp = new Date().toISOString()
  const deleted: Note = {
    ...current,
    updated: formatUpdatedAt(timestamp),
    updatedAt: timestamp,
    deletedAt: timestamp,
    syncStatus: 'pending',
    syncError: null,
  }
  if (!isTauri()) {
    writeBrowserNote(deleted)
    enqueueBrowserNote(deleted)
    return
  }
  await insertNote(await getDatabase(), deleted)
}

export async function mergeCloudNotes(cloudNotes: Note[]) {
  for (const cloudNote of cloudNotes) {
    const local = await findStoredNote(String(cloudNote.id))
    if (local && ['pending', 'syncing', 'failed', 'conflict'].includes(local.syncStatus || '')) continue
    await writeSyncedNote({
      ...cloudNote,
      collection: local?.collection || cloudNote.collection,
      tag: local?.tag || cloudNote.tag,
      pinned: local?.pinned || cloudNote.pinned,
      syncStatus: 'synced',
      syncError: null,
    })
  }
}

export async function completeNoteSync(cloudNote: Note, expectedUpdatedAt?: string): Promise<boolean> {
  const local = await findStoredNote(String(cloudNote.id))
  if (expectedUpdatedAt && local?.updatedAt !== expectedUpdatedAt) {
    await updateLocalCloudVersion(String(cloudNote.id), cloudNote.revision || 0, cloudNote.spaceId)
    return false
  }
  const synced = {
    ...cloudNote,
    collection: local?.collection || cloudNote.collection,
    tag: local?.tag || cloudNote.tag,
    pinned: local?.pinned || cloudNote.pinned,
    syncStatus: 'synced',
    syncError: null,
  } satisfies Note
  if (!isTauri()) {
    await writeSyncedNote(synced)
    return true
  }
  const database = await getDatabase()
  const result = await database.execute(
    `UPDATE local_notes SET
       space_id = $1, title = $2, summary = $3, content = $4, tag = $5, collection = $6,
       created_at = $7, updated_at = $8, read_time = $9, pinned = $10, favorite = $11,
       revision = $12, sync_status = 'synced', sync_error = NULL, deleted_at = NULL
     WHERE id = $13 AND ($14 IS NULL OR updated_at = $14)`,
    [synced.spaceId || null, synced.title, synced.summary, synced.content, synced.tag, synced.collection,
      synced.createdAt || synced.updatedAt, synced.updatedAt, synced.readTime, synced.pinned ? 1 : 0,
      synced.favorite ? 1 : 0, synced.revision || 0, String(synced.id), expectedUpdatedAt || null],
  )
  if (!result.rowsAffected) {
    await updateLocalCloudVersion(String(cloudNote.id), cloudNote.revision || 0, cloudNote.spaceId)
    return false
  }
  await writeNoteArchiveMapping(database, synced)
  await database.execute(
    "DELETE FROM sync_queue WHERE entity_type = 'note' AND entity_id = $1 AND ($2 IS NULL OR updated_at = $2)",
    [String(cloudNote.id), expectedUpdatedAt || null],
  )
  return true
}

export async function completeNoteDelete(id: Note['id'], expectedUpdatedAt?: string) {
  if (!isTauri()) {
    const notes = readBrowserNotes().map((note) => String(note.id) === String(id) && (!expectedUpdatedAt || note.updatedAt === expectedUpdatedAt)
      ? { ...note, syncStatus: 'synced' as const }
      : note)
    localStorage.setItem(browserNotesKey, JSON.stringify(notes))
    const unchanged = notes.find((note) => String(note.id) === String(id))?.updatedAt === expectedUpdatedAt
    if (!expectedUpdatedAt || unchanged) removeBrowserQueue(String(id))
    return
  }
  const database = await getDatabase()
  await database.execute(
    "UPDATE local_notes SET sync_status = 'synced', sync_error = NULL WHERE id = $1 AND ($2 IS NULL OR updated_at = $2)",
    [String(id), expectedUpdatedAt || null],
  )
  await database.execute(
    "DELETE FROM sync_queue WHERE entity_type = 'note' AND entity_id = $1 AND ($2 IS NULL OR updated_at = $2)",
    [String(id), expectedUpdatedAt || null],
  )
  await database.execute("DELETE FROM local_archive_items WHERE entity_type = 'note' AND entity_id = $1", [String(id)])
}

export async function listPendingNoteChanges(): Promise<PendingNoteChange[]> {
  if (!isTauri()) {
    const notes = readBrowserNotes()
    return readBrowserQueue().flatMap((item) => {
      const note = notes.find((candidate) => String(candidate.id) === item.entityId)
      return note ? [{ operation: item.operation, note }] : []
    })
  }
  const rows = await (await getDatabase()).select<(NoteRow & { operation: string })[]>(
    `SELECT n.*, q.operation, ai.entity_id AS archive_item_id, ai.folder_id AS archive_folder_id FROM sync_queue q
     JOIN local_notes n ON n.id = q.entity_id
     LEFT JOIN local_archive_items ai ON ai.entity_type = 'note' AND ai.entity_id = n.id
     WHERE q.entity_type = 'note' ORDER BY q.created_at ASC`,
  )
  return rows.map((row) => ({ operation: row.operation as PendingNoteChange['operation'], note: fromRow(row) }))
}

export async function pendingNoteCount() {
  if (!isTauri()) return readBrowserQueue().length
  const rows = await (await getDatabase()).select<{ count: number }[]>(
    "SELECT count(*) AS count FROM sync_queue WHERE entity_type = 'note'",
  )
  return Number(rows[0]?.count || 0)
}

export async function markNoteSyncing(id: Note['id'], expectedUpdatedAt?: string) {
  await setNoteSyncState(String(id), 'syncing', null, expectedUpdatedAt)
  if (!isTauri()) {
    const queue = readBrowserQueue().map((item) => item.entityId === String(id) && (!expectedUpdatedAt || item.updatedAt === expectedUpdatedAt)
      ? { ...item, attemptCount: item.attemptCount + 1 }
      : item)
    localStorage.setItem(browserQueueKey, JSON.stringify(queue))
    return
  }
  await (await getDatabase()).execute(
    "UPDATE sync_queue SET attempt_count = attempt_count + 1, last_error = NULL WHERE entity_type = 'note' AND entity_id = $1 AND ($2 IS NULL OR updated_at = $2)",
    [String(id), expectedUpdatedAt || null],
  )
}

export async function markNoteSyncFailed(id: Note['id'], message: string, conflict = false, expectedUpdatedAt?: string) {
  await setNoteSyncState(String(id), conflict ? 'conflict' : 'failed', message, expectedUpdatedAt)
  if (!isTauri()) {
    const queue = readBrowserQueue().map((item) => item.entityId === String(id) && (!expectedUpdatedAt || item.updatedAt === expectedUpdatedAt)
      ? { ...item, lastError: message }
      : item)
    localStorage.setItem(browserQueueKey, JSON.stringify(queue))
    return
  }
  await (await getDatabase()).execute(
    "UPDATE sync_queue SET last_error = $1 WHERE entity_type = 'note' AND entity_id = $2 AND ($3 IS NULL OR updated_at = $3)",
    [message, String(id), expectedUpdatedAt || null],
  )
}

async function insertNote(database: Database, note: Note) {
  const timestamp = note.updatedAt || new Date().toISOString()
  await database.execute(
    `INSERT INTO local_notes
      (id, space_id, title, summary, content, tag, collection, created_at, updated_at, read_time,
       pinned, favorite, revision, sync_status, sync_error, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT(id) DO UPDATE SET
       space_id = excluded.space_id,
       title = excluded.title,
       summary = excluded.summary,
       content = excluded.content,
       tag = excluded.tag,
       collection = excluded.collection,
       updated_at = excluded.updated_at,
       read_time = excluded.read_time,
       pinned = excluded.pinned,
       favorite = excluded.favorite,
       revision = excluded.revision,
       sync_status = excluded.sync_status,
       sync_error = excluded.sync_error,
       deleted_at = excluded.deleted_at`,
    [String(note.id), note.spaceId || null, note.title, note.summary, note.content, note.tag, note.collection,
      note.createdAt || timestamp, timestamp, note.readTime, note.pinned ? 1 : 0, note.favorite ? 1 : 0,
      note.revision || 0, note.syncStatus || 'pending', note.syncError || null, note.deletedAt || null],
  )
  await writeNoteArchiveMapping(database, note)
}

async function writeNoteArchiveMapping(database: Database, note: Note) {
  if (note.archived && !note.deletedAt) {
    await database.execute(
      `INSERT INTO local_archive_items (entity_type, entity_id, folder_id, archived_at)
       VALUES ('note', $1, $2, $3)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET folder_id = excluded.folder_id, archived_at = excluded.archived_at`,
      [String(note.id), note.archiveFolderId || null, note.updatedAt || new Date().toISOString()],
    )
  } else {
    await database.execute("DELETE FROM local_archive_items WHERE entity_type = 'note' AND entity_id = $1", [String(note.id)])
  }
}

async function writeSyncedNote(note: Note) {
  const normalized = normalizeBrowserNote({ ...note, syncStatus: 'synced', syncError: null })
  if (!isTauri()) {
    writeBrowserNote(normalized)
    removeBrowserQueue(String(normalized.id))
    return
  }
  await insertNote(await getDatabase(), normalized)
}

async function findStoredNote(id: string): Promise<Note | null> {
  if (!isTauri()) return readBrowserNotes().find((note) => String(note.id) === id) || null
  const rows = await (await getDatabase()).select<NoteRow[]>(
    `SELECT n.*, ai.entity_id AS archive_item_id, ai.folder_id AS archive_folder_id
     FROM local_notes n LEFT JOIN local_archive_items ai
       ON ai.entity_type = 'note' AND ai.entity_id = n.id WHERE n.id = $1`,
    [id],
  )
  return rows.length ? fromRow(rows[0]) : null
}

async function setNoteSyncState(id: string, syncStatus: SyncStatus, syncError: string | null, expectedUpdatedAt?: string) {
  if (!isTauri()) {
    const notes = readBrowserNotes().map((note) => String(note.id) === id && (!expectedUpdatedAt || note.updatedAt === expectedUpdatedAt)
      ? { ...note, syncStatus, syncError }
      : note)
    localStorage.setItem(browserNotesKey, JSON.stringify(notes))
    return
  }
  await (await getDatabase()).execute(
    'UPDATE local_notes SET sync_status = $1, sync_error = $2 WHERE id = $3 AND ($4 IS NULL OR updated_at = $4)',
    [syncStatus, syncError, id, expectedUpdatedAt || null],
  )
}

async function updateLocalCloudVersion(id: string, revision: number, spaceId?: string) {
  if (!isTauri()) {
    const notes = readBrowserNotes().map((note) => String(note.id) === id
      ? { ...note, revision: Math.max(note.revision || 0, revision), spaceId: spaceId || note.spaceId }
      : note)
    localStorage.setItem(browserNotesKey, JSON.stringify(notes))
    return
  }
  await (await getDatabase()).execute(
    'UPDATE local_notes SET revision = max(revision, $1), space_id = coalesce($2, space_id) WHERE id = $3',
    [revision, spaceId || null, id],
  )
}

function readBrowserNotes(): Note[] {
  const saved = localStorage.getItem(browserNotesKey)
  return saved ? (JSON.parse(saved) as Note[]).map(normalizeBrowserNote) : []
}

function writeBrowserNote(note: Note) {
  const notes = readBrowserNotes()
  const index = notes.findIndex((candidate) => String(candidate.id) === String(note.id))
  if (index >= 0) notes[index] = note
  else notes.unshift(note)
  localStorage.setItem(browserNotesKey, JSON.stringify(notes))
}

function readBrowserQueue(): BrowserQueueItem[] {
  const saved = localStorage.getItem(browserQueueKey)
  return saved ? JSON.parse(saved) as BrowserQueueItem[] : []
}

function enqueueBrowserNote(note: Note) {
  const queue = readBrowserQueue()
  const item: BrowserQueueItem = {
    entityId: String(note.id),
    operation: note.deletedAt ? 'delete' : 'upsert',
    attemptCount: 0,
    lastError: null,
    updatedAt: note.updatedAt || new Date().toISOString(),
  }
  const index = queue.findIndex((candidate) => candidate.entityId === item.entityId)
  if (index >= 0) queue[index] = item
  else queue.push(item)
  localStorage.setItem(browserQueueKey, JSON.stringify(queue))
}

function removeBrowserQueue(id: string) {
  localStorage.setItem(browserQueueKey, JSON.stringify(readBrowserQueue().filter((item) => item.entityId !== id)))
}

function normalizeBrowserNote(note: Note): Note {
  const timestamp = note.updatedAt || note.createdAt || new Date().toISOString()
  return {
    ...note,
    id: String(note.id).startsWith('nte_') ? String(note.id) : `nte_${createUuid()}`,
    summary: note.summary || summarize(note.content),
    tag: note.tag || '本地笔记',
    collection: normalizeCollectionName(note.collection),
    updated: formatUpdatedAt(timestamp),
    readTime: note.readTime || readingTime(note.content),
    revision: note.revision || 0,
    createdAt: note.createdAt || timestamp,
    updatedAt: timestamp,
    deletedAt: note.deletedAt || null,
    syncStatus: note.syncStatus || 'pending',
    syncError: note.syncError || null,
    archived: Boolean(note.archived),
    archiveFolderId: note.archiveFolderId || null,
  }
}

function summarize(content: string) {
  return content.trim().replace(/\s+/g, ' ').slice(0, 72) || '暂无摘要。'
}

function readingTime(content: string) {
  return Math.max(1, Math.ceil(content.length / 300))
}

function formatUpdatedAt(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function createUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function loadTodos(day = localDayKey()): Promise<TodoItem[]> {
  if (!isTauri()) return sortTodos(readBrowserTodos().filter((todo) => todo.day === day && !todo.deletedAt))
  const rows = await (await getDatabase()).select<Record<string, unknown>[]>(
    'SELECT * FROM local_todos WHERE day = $1 AND deleted_at IS NULL ORDER BY completed ASC, created_at ASC',
    [day],
  )
  return rows.map(todoFromRow)
}

export async function createTodo(text: string, spaceId?: string): Promise<TodoItem> {
  const timestamp = new Date().toISOString()
  const todo: TodoItem = {
    id: `todo_${createUuid()}`,
    text: text.trim(),
    completed: false,
    day: localDayKey(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    spaceId,
    revision: 0,
    syncStatus: 'pending',
    syncError: null,
  }
  await writeLocalTodo(todo)
  return todo
}

export async function updateTodo(todo: TodoItem, patch: Partial<Pick<TodoItem, 'text' | 'completed'>>): Promise<TodoItem> {
  const updated: TodoItem = {
    ...todo,
    ...patch,
    text: (patch.text ?? todo.text).trim(),
    updatedAt: new Date().toISOString(),
    syncStatus: 'pending',
    syncError: null,
  }
  await writeLocalTodo(updated)
  return updated
}

export async function deleteTodo(todo: TodoItem): Promise<TodoItem> {
  const deleted = { ...todo, deletedAt: new Date().toISOString(), syncStatus: 'pending' as const, syncError: null }
  await writeLocalTodo(deleted)
  return deleted
}

export async function listPendingTodoChanges(): Promise<TodoItem[]> {
  if (!isTauri()) return readBrowserTodos().filter((todo) => todo.syncStatus !== 'synced')
  const rows = await (await getDatabase()).select<Record<string, unknown>[]>(
    "SELECT * FROM local_todos WHERE sync_status <> 'synced' ORDER BY created_at ASC",
  )
  return rows.map(todoFromRow)
}

export async function markTodoSyncing(id: string) {
  await setTodoSyncState(id, 'syncing', null)
}

export async function markTodoSyncFailed(id: string, message: string) {
  await setTodoSyncState(id, 'failed', message)
}

export async function completeTodoSync(todo: TodoItem, expectedUpdatedAt?: string): Promise<boolean> {
  const local = await findLocalTodo(todo.id)
  if (expectedUpdatedAt && local && local.updatedAt !== expectedUpdatedAt) {
    await writeLocalTodo({
      ...local,
      spaceId: todo.spaceId,
      revision: Math.max(local.revision, todo.revision),
      syncStatus: 'pending',
      syncError: null,
    })
    return false
  }
  await writeLocalTodo({ ...todo, deletedAt: null, syncStatus: 'synced', syncError: null })
  return true
}

export async function completeTodoDelete(id: string) {
  if (!isTauri()) {
    writeBrowserTodos(readBrowserTodos().filter((todo) => todo.id !== id))
    return
  }
  await (await getDatabase()).execute('DELETE FROM local_todos WHERE id = $1', [id])
}

export async function mergeCloudTodos(cloudTodos: TodoItem[]) {
  for (const cloudTodo of cloudTodos) {
    const local = await findLocalTodo(cloudTodo.id)
    if (local && local.syncStatus !== 'synced') continue
    await completeTodoSync(cloudTodo)
  }
}

function readBrowserTodos(): TodoItem[] {
  const saved = localStorage.getItem(browserTodosKey)
  return saved ? (JSON.parse(saved) as TodoItem[]).map(normalizeTodo) : []
}

function writeBrowserTodos(todos: TodoItem[]) {
  localStorage.setItem(browserTodosKey, JSON.stringify(todos))
}

function sortTodos(todos: TodoItem[]) {
  return [...todos].sort((left, right) => Number(left.completed) - Number(right.completed) || left.createdAt.localeCompare(right.createdAt))
}

async function findLocalTodo(id: string): Promise<TodoItem | null> {
  if (!isTauri()) return readBrowserTodos().find((todo) => todo.id === id) || null
  const rows = await (await getDatabase()).select<Record<string, unknown>[]>('SELECT * FROM local_todos WHERE id = $1', [id])
  return rows.length ? todoFromRow(rows[0]) : null
}

async function writeLocalTodo(todo: TodoItem) {
  const normalized = normalizeTodo(todo)
  if (!isTauri()) {
    const todos = readBrowserTodos()
    const index = todos.findIndex((item) => item.id === normalized.id)
    if (index >= 0) todos[index] = normalized
    else todos.push(normalized)
    writeBrowserTodos(todos)
    return
  }
  await (await getDatabase()).execute(
    `INSERT INTO local_todos
      (id, space_id, text, completed, day, revision, sync_status, sync_error, deleted_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT(id) DO UPDATE SET
       space_id = excluded.space_id,
       text = excluded.text,
       completed = excluded.completed,
       day = excluded.day,
       revision = excluded.revision,
       sync_status = excluded.sync_status,
       sync_error = excluded.sync_error,
       deleted_at = excluded.deleted_at,
       updated_at = excluded.updated_at`,
    [normalized.id, normalized.spaceId || null, normalized.text, normalized.completed ? 1 : 0, normalized.day,
      normalized.revision, normalized.syncStatus, normalized.syncError, normalized.deletedAt,
      normalized.createdAt, normalized.updatedAt],
  )
}

async function setTodoSyncState(id: string, syncStatus: SyncStatus, syncError: string | null) {
  const todo = await findLocalTodo(id)
  if (!todo) return
  await writeLocalTodo({ ...todo, syncStatus, syncError })
}

function normalizeTodo(todo: Partial<TodoItem> & Pick<TodoItem, 'id' | 'text' | 'day' | 'createdAt' | 'updatedAt'>): TodoItem {
  return {
    id: todo.id,
    text: todo.text,
    completed: Boolean(todo.completed),
    day: todo.day,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    deletedAt: todo.deletedAt || null,
    spaceId: todo.spaceId,
    revision: Number(todo.revision || 0),
    syncStatus: todo.syncStatus || 'pending',
    syncError: todo.syncError || null,
  }
}

function todoFromRow(row: Record<string, unknown>): TodoItem {
  return normalizeTodo({
    id: String(row.id),
    text: String(row.text),
    completed: Boolean(row.completed),
    day: String(row.day),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    spaceId: row.space_id ? String(row.space_id) : undefined,
    revision: Number(row.revision || 0),
    syncStatus: String(row.sync_status || 'pending') as SyncStatus,
    syncError: row.sync_error ? String(row.sync_error) : null,
  })
}

function localDayKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
    return normalizeSettings(saved ? JSON.parse(saved) as Partial<AppSettings> : {})
  }
  const database = await getDatabase()
  const rows = await database.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', ['app'])
  return normalizeSettings(rows.length ? JSON.parse(rows[0].value) as Partial<AppSettings> : {})
}

export async function persistSettings(settings: AppSettings) {
  const normalized = normalizeSettings(settings)
  if (!isTauri()) {
    localStorage.setItem('zhixu-settings', JSON.stringify(normalized))
    return
  }
  const database = await getDatabase()
  await database.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['app', JSON.stringify(normalized)],
  )
}

export async function loadCollections(): Promise<Collection[]> {
  if (!isTauri()) {
    const saved = localStorage.getItem(browserCollectionsKey)
    return normalizeCollections(saved ? JSON.parse(saved) as Collection[] : collections)
  }
  const database = await getDatabase()
  const rows = await database.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', ['collections'])
  return normalizeCollections(rows.length ? JSON.parse(rows[0].value) as Collection[] : collections)
}

export async function persistCollections(items: Collection[]) {
  const normalized = normalizeCollections(items)
  if (!isTauri()) {
    localStorage.setItem(browserCollectionsKey, JSON.stringify(normalized))
    return
  }
  const database = await getDatabase()
  await database.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['collections', JSON.stringify(normalized)],
  )
}

export async function loadArchiveFolders(spaceId = ''): Promise<ArchiveFolder[]> {
  if (!isTauri()) {
    const saved = localStorage.getItem(browserArchiveFoldersKey)
    const folders = saved ? JSON.parse(saved) as ArchiveFolder[] : []
    return folders.filter((folder) => !spaceId || !folder.spaceId || folder.spaceId === spaceId)
  }
  const rows = await (await getDatabase()).select<Record<string, unknown>[]>(
    `SELECT * FROM local_archive_folders
     WHERE $1 = '' OR space_id IS NULL OR space_id = $1
     ORDER BY created_at, name`,
    [spaceId],
  )
  return rows.map((row) => ({
    id: String(row.id),
    spaceId: row.space_id ? String(row.space_id) : undefined,
    parentId: row.parent_id ? String(row.parent_id) : null,
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }))
}

export async function createLocalArchiveFolder(name: string, parentId: string | null, spaceId?: string, requestedId?: string): Promise<ArchiveFolder> {
  const normalizedName = normalizeArchiveFolderName(name)
  const folders = await loadArchiveFolders(spaceId || '')
  const existingById = requestedId ? folders.find((folder) => folder.id === requestedId) : undefined
  if (existingById) {
    const next = { ...existingById, spaceId: spaceId || existingById.spaceId, parentId: parentId || null, name: normalizedName, updatedAt: new Date().toISOString() }
    if (!isTauri()) {
      localStorage.setItem(browserArchiveFoldersKey, JSON.stringify(readBrowserArchiveFolders().map((folder) => folder.id === next.id ? next : folder)))
    } else {
      await (await getDatabase()).execute(
        'UPDATE local_archive_folders SET space_id = $1, parent_id = $2, name = $3, updated_at = $4 WHERE id = $5',
        [next.spaceId || null, next.parentId, next.name, next.updatedAt, next.id],
      )
    }
    return next
  }
  if (folders.some((folder) => folder.parentId === (parentId || null) && folder.name === normalizedName)) {
    throw new Error('同一级下已存在同名目录')
  }
  if (parentId && !folders.some((folder) => folder.id === parentId)) throw new Error('上级归档目录不存在')
  const timestamp = new Date().toISOString()
  const folder: ArchiveFolder = {
    id: requestedId || `arf_${createUuid()}`,
    spaceId,
    parentId: parentId || null,
    name: normalizedName,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  if (!isTauri()) {
    const all = readBrowserArchiveFolders()
    all.push(folder)
    localStorage.setItem(browserArchiveFoldersKey, JSON.stringify(all))
    return folder
  }
  await (await getDatabase()).execute(
    `INSERT INTO local_archive_folders (id, space_id, parent_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT(id) DO UPDATE SET space_id = excluded.space_id, parent_id = excluded.parent_id,
       name = excluded.name, updated_at = excluded.updated_at`,
    [folder.id, folder.spaceId || null, folder.parentId, folder.name, timestamp],
  )
  return folder
}

export async function deleteLocalArchiveFolder(folderId: string) {
  if (!isTauri()) {
    const folders = readBrowserArchiveFolders()
    const removed = descendantFolderIds(folders, folderId)
    localStorage.setItem(browserArchiveFoldersKey, JSON.stringify(folders.filter((folder) => !removed.has(folder.id))))
    localStorage.setItem(browserNotesKey, JSON.stringify(readBrowserNotes().map((note) => removed.has(note.archiveFolderId || '')
      ? { ...note, archiveFolderId: null }
      : note)))
    localStorage.setItem(browserKnowledgeFilesKey, JSON.stringify(readBrowserKnowledgeFiles().map((file) => removed.has(file.archiveFolderId || '')
      ? { ...file, archiveFolderId: null }
      : file)))
    return
  }
  const database = await getDatabase()
  const rows = await database.select<{ id: string }[]>(
    `WITH RECURSIVE descendants(id) AS (
       SELECT id FROM local_archive_folders WHERE id = $1
       UNION ALL SELECT f.id FROM local_archive_folders f JOIN descendants d ON f.parent_id = d.id
     ) SELECT id FROM descendants`,
    [folderId],
  )
  const ids = rows.map((row) => row.id)
  for (const id of ids) await database.execute('UPDATE local_archive_items SET folder_id = NULL WHERE folder_id = $1', [id])
  for (const id of [...ids].reverse()) await database.execute('DELETE FROM local_archive_folders WHERE id = $1', [id])
}

export async function selectSourceDirectory(): Promise<string | null> {
  if (!isTauri()) return null
  const selected = await open({ directory: true, multiple: false })
  return typeof selected === 'string' ? selected : null
}

export async function selectKnowledgeDocument(): Promise<SelectedKnowledgeDocument | null> {
  if (!isTauri()) return selectBrowserKnowledgeDocument()
  const selected = await open({
    multiple: false,
    filters: [{ name: '知识库文本', extensions: ['md', 'markdown', 'txt'] }],
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

export async function listKnowledgeFiles(directory: string): Promise<LocalKnowledgeFile[]> {
  const normalizedDirectory = normalizeKnowledgeDirectory(directory)
  if (!isTauri()) {
    return readBrowserKnowledgeFiles()
      .filter((file) => file.directory === normalizedDirectory)
      .map(toLocalKnowledgeFile)
      .sort(sortKnowledgeFiles)
  }

  const filesystemDirectory = await prepareKnowledgeDirectory(normalizedDirectory)
  await mkdir(filesystemDirectory, { recursive: true })
  const files: LocalKnowledgeFile[] = []

  const scan = async (parent: string, relativeParent = ''): Promise<void> => {
    const entries = await readDir(parent)
    for (const entry of entries) {
      if (entry.isSymlink) continue
      const fullPath = await join(parent, entry.name)
      const relativePath = relativeParent ? `${relativeParent}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        await scan(fullPath, relativePath)
        continue
      }
      if (!entry.isFile || !isEditableKnowledgeFile(entry.name)) continue
      const info = await stat(fullPath)
      files.push({
        id: `filesystem:${fullPath}`,
        name: entry.name,
        relativePath,
        path: fullPath,
        mimeType: knowledgeMimeType(entry.name),
        size: info.size,
        updatedAt: info.mtime?.toISOString() || new Date().toISOString(),
        storage: 'filesystem',
        collection: draftCollection,
        favorite: false,
        archived: false,
        archiveFolderId: null,
        inDatabase: false,
      })
    }
  }

  await scan(filesystemDirectory)
  return (await hydrateKnowledgeFiles(await getDatabase(), files)).sort(sortKnowledgeFiles)
}

export async function importKnowledgeFile(document: SelectedKnowledgeDocument, directory: string): Promise<LocalKnowledgeFile> {
  if (!document.supportedForIndexing || !isEditableKnowledgeFile(document.fileName)) {
    throw new Error('知识库文件目前只支持 Markdown 和 TXT')
  }
  const normalizedDirectory = normalizeKnowledgeDirectory(directory)
  if (!isTauri()) {
    const now = new Date().toISOString()
    const separator = normalizedDirectory.includes('\\') ? '\\' : '/'
    const path = `${normalizedDirectory}${normalizedDirectory.endsWith(separator) ? '' : separator}${document.fileName}`
    const content = new TextDecoder('utf-8').decode(document.bytes).replace(/^\uFEFF/, '')
    const record: BrowserKnowledgeFile = {
      id: `browser:${normalizedDirectory.toLowerCase()}:${document.fileName.toLowerCase()}`,
      name: document.fileName,
      relativePath: document.fileName,
      path,
      mimeType: knowledgeMimeType(document.fileName),
      size: document.bytes.byteLength,
      updatedAt: now,
      storage: 'browser',
      collection: draftCollection,
      favorite: false,
      archived: false,
      archiveFolderId: null,
      inDatabase: true,
      directory: normalizedDirectory,
      content,
    }
    const files = readBrowserKnowledgeFiles()
    const index = files.findIndex((file) => file.id === record.id)
    if (index >= 0) files[index] = record
    else files.unshift(record)
    localStorage.setItem(browserKnowledgeFilesKey, JSON.stringify(files))
    return toLocalKnowledgeFile(record)
  }

  const path = await preserveSourceFile(document, normalizedDirectory)
  if (!path) throw new Error('无法写入知识库目录')
  const info = await stat(path)
  return updateKnowledgeFileMetadata({
    id: `filesystem:${path}`,
    name: document.fileName,
    relativePath: document.fileName,
    path,
    mimeType: knowledgeMimeType(document.fileName),
    size: info.size,
    updatedAt: info.mtime?.toISOString() || new Date().toISOString(),
    storage: 'filesystem',
    collection: draftCollection,
    favorite: false,
    archived: false,
    archiveFolderId: null,
    inDatabase: false,
  }, {})
}

export async function readKnowledgeFile(file: LocalKnowledgeFile): Promise<string> {
  if (file.storage === 'browser' || !isTauri()) {
    const stored = readBrowserKnowledgeFiles().find((candidate) => candidate.id === file.id)
    if (!stored) throw new Error('本地知识库文件不存在')
    return stored.content
  }
  return (await readTextFile(file.path)).replace(/^\uFEFF/, '')
}

export async function saveKnowledgeFile(file: LocalKnowledgeFile, content: string): Promise<LocalKnowledgeFile> {
  if (file.storage === 'browser' || !isTauri()) {
    const files = readBrowserKnowledgeFiles()
    const index = files.findIndex((candidate) => candidate.id === file.id)
    if (index < 0) throw new Error('本地知识库文件不存在')
    const updatedAt = new Date().toISOString()
    const encodedSize = new TextEncoder().encode(content).byteLength
    files[index] = { ...files[index], content, size: encodedSize, updatedAt }
    localStorage.setItem(browserKnowledgeFilesKey, JSON.stringify(files))
    return toLocalKnowledgeFile(files[index])
  }

  await writeTextFile(file.path, content)
  const info = await stat(file.path)
  return {
    ...file,
    size: info.size,
    updatedAt: info.mtime?.toISOString() || new Date().toISOString(),
  }
}

export async function updateKnowledgeFileMetadata(file: LocalKnowledgeFile, patch: Partial<Pick<LocalKnowledgeFile, 'collection' | 'favorite' | 'archived' | 'archiveFolderId'>>): Promise<LocalKnowledgeFile> {
  const updatedAt = new Date().toISOString()
  const next: LocalKnowledgeFile = {
    ...file,
    ...patch,
    collection: normalizeCollectionName(patch.collection ?? file.collection),
    favorite: patch.favorite ?? file.favorite,
    archived: patch.archived ?? file.archived,
    archiveFolderId: (patch.archived ?? file.archived) ? (patch.archiveFolderId === undefined ? file.archiveFolderId : patch.archiveFolderId) : null,
    inDatabase: true,
  }
  if (!isTauri() || file.storage === 'browser') {
    const files = readBrowserKnowledgeFiles()
    const index = files.findIndex((candidate) => candidate.id === file.id)
    if (index < 0) throw new Error('本地知识库文件不存在')
    files[index] = { ...files[index], ...next, updatedAt: files[index].updatedAt }
    localStorage.setItem(browserKnowledgeFilesKey, JSON.stringify(files))
    return next
  }
  const database = await getDatabase()
  await database.execute(
    `INSERT INTO local_knowledge_metadata (file_id, relative_path, collection, favorite, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(file_id) DO UPDATE SET relative_path = excluded.relative_path, collection = excluded.collection,
       favorite = excluded.favorite, updated_at = excluded.updated_at`,
    [file.id, file.relativePath, next.collection, next.favorite ? 1 : 0, updatedAt],
  )
  if (next.archived) {
    await database.execute(
      `INSERT INTO local_archive_items (entity_type, entity_id, folder_id, archived_at)
       VALUES ('document', $1, $2, $3)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET folder_id = excluded.folder_id, archived_at = excluded.archived_at`,
      [file.id, next.archiveFolderId, updatedAt],
    )
  } else {
    await database.execute("DELETE FROM local_archive_items WHERE entity_type = 'document' AND entity_id = $1", [file.id])
  }
  return next
}

export async function preserveSourceFile(document: SelectedKnowledgeDocument, directory: string) {
  if (!isTauri() || !directory) return null
  const normalized = await prepareKnowledgeDirectory(directory)
  const separator = normalized.includes('\\') ? '\\' : '/'
  await mkdir(normalized, { recursive: true })
  const destination = `${normalized}${normalized.endsWith(separator) ? '' : separator}${document.fileName}`
  if (destination.toLowerCase() !== document.sourcePath.toLowerCase()) {
    await writeFile(destination, document.bytes)
  }
  return destination
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const temperature = Number(settings.aiTemperature)
  const maxTokens = Number(settings.aiMaxTokens)
  return {
    ...defaultSettings,
    ...settings,
    sourceDirectory: settings.sourceDirectory?.trim() || defaultSettings.sourceDirectory,
    appearance: settings.appearance === 'light' || settings.appearance === 'dark' ? settings.appearance : 'system',
    aiBaseUrl: settings.aiBaseUrl?.trim() || '',
    aiApiKey: settings.aiApiKey?.trim() || '',
    aiModel: settings.aiModel?.trim() || '',
    aiTemperature: Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : defaultSettings.aiTemperature,
    aiMaxTokens: Number.isFinite(maxTokens) ? Math.min(8192, Math.max(64, Math.round(maxTokens))) : defaultSettings.aiMaxTokens,
  }
}

function normalizeKnowledgeDirectory(directory: string) {
  const value = directory.trim()
  if (!value) return defaultSettings.sourceDirectory
  if (/^[A-Za-z]:[\\/]*$/.test(value)) return `${value.slice(0, 2)}\\`
  if (/^[\\/]+$/.test(value)) return value.slice(0, 1)
  return value.replace(/[\\/]+$/, '')
}

async function prepareKnowledgeDirectory(directory: string) {
  return invoke<string>('prepare_knowledge_directory', { path: normalizeKnowledgeDirectory(directory) })
}

function isEditableKnowledgeFile(fileName: string) {
  return /\.(?:md|markdown|txt)$/i.test(fileName)
}

function knowledgeMimeType(fileName: string): LocalKnowledgeFile['mimeType'] {
  return /\.(?:md|markdown)$/i.test(fileName) ? 'text/markdown' : 'text/plain'
}

function sortKnowledgeFiles(left: LocalKnowledgeFile, right: LocalKnowledgeFile) {
  return right.updatedAt.localeCompare(left.updatedAt) || left.relativePath.localeCompare(right.relativePath, 'zh-CN')
}

async function hydrateKnowledgeFiles(database: Database, files: LocalKnowledgeFile[]): Promise<LocalKnowledgeFile[]> {
  const metadataRows = await database.select<Record<string, unknown>[]>('SELECT * FROM local_knowledge_metadata')
  const archiveRows = await database.select<Record<string, unknown>[]>(
    "SELECT entity_id, folder_id FROM local_archive_items WHERE entity_type = 'document'",
  )
  const metadata = new Map(metadataRows.map((row) => [String(row.file_id), row]))
  const archives = new Map(archiveRows.map((row) => [String(row.entity_id), row]))
  const timestamp = new Date().toISOString()
  const hydrated: LocalKnowledgeFile[] = []
  for (const file of files) {
    let row = metadata.get(file.id)
    if (!row) {
      await database.execute(
        `INSERT INTO local_knowledge_metadata (file_id, relative_path, collection, favorite, updated_at)
         VALUES ($1, $2, $3, 0, $4) ON CONFLICT(file_id) DO NOTHING`,
        [file.id, file.relativePath, draftCollection, timestamp],
      )
      row = { collection: draftCollection, favorite: 0 }
    }
    const archive = archives.get(file.id)
    hydrated.push({
      ...file,
      collection: normalizeCollectionName(String(row.collection || draftCollection)),
      favorite: Boolean(row.favorite),
      archived: Boolean(archive),
      archiveFolderId: archive?.folder_id ? String(archive.folder_id) : null,
      inDatabase: true,
    })
  }
  return hydrated
}

function readBrowserKnowledgeFiles(): BrowserKnowledgeFile[] {
  const saved = localStorage.getItem(browserKnowledgeFilesKey)
  const files = saved ? JSON.parse(saved) as BrowserKnowledgeFile[] : []
  return files.map((file) => ({
    ...file,
    collection: normalizeCollectionName(file.collection),
    favorite: Boolean(file.favorite),
    archived: Boolean(file.archived),
    archiveFolderId: file.archiveFolderId || null,
    inDatabase: true,
  }))
}

function toLocalKnowledgeFile(file: BrowserKnowledgeFile): LocalKnowledgeFile {
  return {
    id: file.id,
    name: file.name,
    relativePath: file.relativePath,
    path: file.path,
    mimeType: file.mimeType,
    size: file.size,
    updatedAt: file.updatedAt,
    storage: file.storage,
    collection: normalizeCollectionName(file.collection),
    favorite: Boolean(file.favorite),
    archived: Boolean(file.archived),
    archiveFolderId: file.archiveFolderId || null,
    inDatabase: true,
  }
}

function readBrowserArchiveFolders(): ArchiveFolder[] {
  const saved = localStorage.getItem(browserArchiveFoldersKey)
  return saved ? JSON.parse(saved) as ArchiveFolder[] : []
}

function descendantFolderIds(folders: ArchiveFolder[], rootId: string) {
  const ids = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id)
        changed = true
      }
    }
  }
  return ids
}

function normalizeArchiveFolderName(value: string) {
  const name = value.trim()
  if (!name || name.length > 80 || /[\\/]/.test(name)) throw new Error('目录名称需为 1-80 个字符，且不能包含路径分隔符')
  return name
}

function normalizeCollections(items: Collection[]): Collection[] {
  const seen = new Set<string>()
  return items.flatMap((item) => {
    const name = item?.name?.trim()
    if (!name || name === draftCollection || name === legacyInboxCollection || seen.has(name)) return []
    seen.add(name)
    return [{ name, color: item.color || '#407a62' }]
  })
}

function normalizeCollectionName(value: string | undefined | null) {
  const name = value?.trim()
  return !name || name === legacyInboxCollection ? draftCollection : name
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
  await invoke('open_local_file', { path })
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
  const markdown = notes.map((note) => `# ${note.title}\n\n> ${note.collection} · ${note.tag}\n\n${note.content}`).join('\n\n---\n\n')
  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'zhixu-notes.md'
    link.click()
    URL.revokeObjectURL(url)
    return
  }
  const path = await save({ defaultPath: 'zhixu-notes.md', filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (!path) return
  await writeTextFile(path, markdown)
}

function selectBrowserKnowledgeDocument(): Promise<SelectedKnowledgeDocument | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.txt'
    input.hidden = true
    document.body.appendChild(input)

    const finish = (result: SelectedKnowledgeDocument | null) => {
      input.remove()
      resolve(result)
    }
    input.addEventListener('cancel', () => finish(null), { once: true })
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        finish(null)
        return
      }
      void file.arrayBuffer()
        .then((buffer) => {
          const markdown = /\.md$|\.markdown$/i.test(file.name)
          const plainText = /\.txt$/i.test(file.name)
          finish({
            fileName: file.name,
            sourcePath: '',
            bytes: new Uint8Array(buffer),
            mimeType: file.type || (markdown ? 'text/markdown' : plainText ? 'text/plain' : mimeTypeFor(file.name)),
            supportedForIndexing: markdown || plainText,
          })
        })
        .catch(() => finish(null))
    }, { once: true })
    input.click()
  })
}
