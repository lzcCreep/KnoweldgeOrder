import { FormEvent, lazy, Suspense, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { convertFileSrc, isTauri } from '@tauri-apps/api/core'
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowUp,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  Clock3,
  Database,
  Eye,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Heart,
  Home,
  FilePenLine,
  Info,
  KeyRound,
  Lightbulb,
  Menu,
  Monitor,
  Moon,
  PanelRightClose,
  PenLine,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Sparkles,
  Sun,
  LogOut,
  LockKeyhole,
  Upload,
  User,
  Trash2,
  X,
} from 'lucide-react'
import { collections as defaultCollections, type Collection, type Note } from './data'
import { ApiError, chatDirectlyWithModel, chatWithModel, createArchiveFolder as createCloudArchiveFolder, createNote as createCloudNote, createSpace, createTodo as createCloudTodo, deleteArchiveFolder as deleteCloudArchiveFolder, deleteDocument, deleteNote as deleteCloudNote, deleteTodo as deleteCloudTodo, getDocumentContent, getNote as getCloudNote, listArchive, listDocuments, listNotes, listTodos as listCloudTodos, login, logout, register, renameSpace, updateDocumentMetadata, updateNote as updateCloudNote, updateProfile, updateTodo as updateCloudTodo, uploadDocument, type ApiDocument, type ApiNote, type ApiSpace, type ApiTodo, type AuthSession, type ModelReference } from './api'
import { completeNoteDelete, completeNoteSync, completeTodoDelete, completeTodoSync, createLocalArchiveFolder, createLocalNote, createTodo as createLocalTodo, defaultProfile, defaultSettings, deleteLocalArchiveFolder, deleteLocalNote, deleteTodo as deleteLocalTodo, importKnowledgeFile, listKnowledgeFiles, listPendingNoteChanges, listPendingTodoChanges, loadArchiveFolders, loadCollections, loadDocumentSources, loadNotes, loadProfile, loadSettings, loadTodos, markNoteSyncFailed, markNoteSyncing, markTodoSyncFailed, markTodoSyncing, mergeCloudNotes, mergeCloudTodos, openSourceFile, pendingNoteCount, persistCollections, persistProfile, persistSettings, readKnowledgeFile, saveDocumentSource, saveKnowledgeFile, selectKnowledgeDocument, selectSourceDirectory, updateKnowledgeFileMetadata, updateLocalNote, updateTodo as updateLocalTodo, type AppSettings, type ArchiveFolder, type LocalKnowledgeFile, type TodoItem, type UserProfile } from './storage'

type View = '首页' | '全部笔记' | '知识库文件' | '草稿箱' | '收藏' | '归档' | '个人资料'
type Message = { role: 'assistant' | 'user'; text: string; sources?: Note[]; fileSources?: LocalKnowledgeFile[]; cloudSources?: ModelReference[] }
type DocumentPreview = { document: ApiDocument; content: string; mimeType: string }
type ArchiveTarget =
  | { kind: 'note'; item: Note }
  | { kind: 'local-file'; item: LocalKnowledgeFile }
  | { kind: 'cloud-file'; item: ApiDocument }
type LocalFileMetadataPatch = Partial<Pick<LocalKnowledgeFile, 'collection' | 'favorite' | 'archived' | 'archiveFolderId'>>
type CloudFileMetadataPatch = { collection?: string; favorite?: boolean; archived?: boolean; archive_folder_id?: string | null }
type PendingEditorNavigation = { destination: string; action: () => void }
type ResolvedAppearance = 'light' | 'dark'

const appVersionFallback = '0.1.0'
const releaseSeenStorageKey = 'zhixu-release-seen-version'
const releaseDate = '2026-08-17'
const releaseHighlights = [
  { title: '笔记工作流', detail: '笔记详情改为主页面展示，新建、编辑、删除、分类和本机优先保存链路已经接通。' },
  { title: '本地知识库', detail: '支持扫描、保存、阅读和编辑 Markdown/TXT，并分别显示本机保存与云端上传状态。' },
  { title: 'AI 管家', detail: '支持配置 OpenAI 兼容模型、引用本机或云端资料，桌面端面板宽度可以左右拖动。' },
  { title: '离线与同步', detail: '离线笔记、待办、个人资料和设置保存在本机；登录后按队列同步到云端。' },
]
const assistantWidthStorageKey = 'zhixu-assistant-width'
const assistantDefaultWidth = 348
const assistantMinWidth = 300
const assistantMaxWidth = 620
const MarkdownEditor = lazy(() => import('./MarkdownEditor'))

const starterMessages: Message[] = [
  {
    role: 'assistant',
    text: '在设置中配置模型服务后，我可以结合你的笔记和知识库文件回答问题。',
  },
]

function archiveFolderPath(folders: ArchiveFolder[], folderId: string | null) {
  if (!folderId) return '归档根目录'
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]))
  const names: string[] = []
  const visited = new Set<string>()
  let current = foldersById.get(folderId)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    names.unshift(current.name)
    current = current.parentId ? foldersById.get(current.parentId) : undefined
  }
  return names.length ? names.join(' / ') : '归档根目录'
}

function archivePathLabel(folders: ArchiveFolder[], folderId: string | null) {
  const path = archiveFolderPath(folders, folderId)
  return folderId ? `“${path}”` : path
}

function isDraftCollection(collection: string | null | undefined) {
  return !collection || collection === '草稿箱' || collection === '收件箱'
}

function archiveFolderStatus(folders: ArchiveFolder[], folderId: string | null | undefined) {
  return `已归档至${archivePathLabel(folders, folderId || null)}`
}

function orderArchiveFolders(folders: ArchiveFolder[]) {
  const remaining = new Map(folders.map((folder) => [folder.id, folder]))
  const ordered: ArchiveFolder[] = []
  while (remaining.size) {
    const ready = [...remaining.values()].filter((folder) => !folder.parentId || !remaining.has(folder.parentId))
    if (!ready.length) {
      ordered.push(...remaining.values())
      break
    }
    for (const folder of ready) {
      ordered.push(folder)
      remaining.delete(folder.id)
    }
  }
  return ordered
}

function flattenArchiveFolders(folders: ArchiveFolder[]) {
  const folderIds = new Set(folders.map((folder) => folder.id))
  const children = new Map<string | null, ArchiveFolder[]>()
  const visited = new Set<string>()
  const flattened: { folder: ArchiveFolder; depth: number }[] = []
  const sortFolders = (items: ArchiveFolder[]) => items.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }))

  for (const folder of folders) {
    const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null
    children.set(parentId, [...(children.get(parentId) || []), folder])
  }

  const visit = (folder: ArchiveFolder, depth: number) => {
    if (visited.has(folder.id)) return
    visited.add(folder.id)
    flattened.push({ folder, depth })
    for (const child of sortFolders(children.get(folder.id) || [])) visit(child, depth + 1)
  }

  for (const folder of sortFolders(children.get(null) || [])) visit(folder, 0)
  for (const folder of sortFolders(folders.filter((item) => !visited.has(item.id)))) visit(folder, 0)
  return flattened
}

async function synchronizeArchiveFolderTree(session: AuthSession, spaceId: string) {
  const [localFolders, snapshot] = await Promise.all([
    loadArchiveFolders(spaceId),
    listArchive(session, spaceId),
  ])
  const remoteIds = new Set(snapshot.folders.map((folder) => folder.id))

  for (const folder of orderArchiveFolders(localFolders)) {
    if (!remoteIds.has(folder.id)) {
      await createCloudArchiveFolder(session, folder.name, folder.parentId, folder.id, spaceId)
    }
    await createLocalArchiveFolder(folder.name, folder.parentId, spaceId, folder.id)
  }
  for (const folder of snapshot.folders) {
    await createLocalArchiveFolder(folder.name, folder.parent_id, spaceId, folder.id)
  }
  return loadArchiveFolders(spaceId)
}

const fromApiNote = (note: ApiNote): Note => ({
  id: note.id,
  title: note.title,
  summary: note.content.slice(0, 72) || '暂无摘要。',
  content: note.content || '暂无正文。',
  tag: '云端笔记',
  collection: note.collection === '收件箱' ? '草稿箱' : note.collection || '草稿箱',
  updated: new Date(note.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  readTime: Math.max(1, Math.ceil(note.content.length / 300)),
  favorite: note.favorite,
  revision: note.revision,
  createdAt: note.created_at,
  updatedAt: note.updated_at,
  deletedAt: null,
  spaceId: note.space_id,
  syncStatus: 'synced',
  syncError: null,
  archived: Boolean(note.archived),
  archiveFolderId: note.archive_folder_id || null,
})

const toApiNote = (note: Note, session: AuthSession): ApiNote => ({
  id: String(note.id),
  space_id: note.spaceId || session.spaces[0]?.id || '',
  title: note.title,
  content: note.content,
  collection: note.collection,
  favorite: Boolean(note.favorite),
  revision: note.revision || 0,
  created_at: note.createdAt || new Date().toISOString(),
  updated_at: note.updatedAt || new Date().toISOString(),
  archived: Boolean(note.archived),
  archive_folder_id: note.archiveFolderId || null,
})

const fromApiTodo = (todo: ApiTodo): TodoItem => ({
  id: todo.id,
  text: todo.text,
  completed: todo.completed,
  day: todo.day,
  createdAt: todo.created_at,
  updatedAt: todo.updated_at,
  deletedAt: null,
  spaceId: todo.space_id,
  revision: todo.revision,
  syncStatus: 'synced',
  syncError: null,
})

const toApiTodo = (todo: TodoItem, session: AuthSession): ApiTodo => ({
  id: todo.id,
  space_id: todo.spaceId || session.spaces[0]?.id || '',
  text: todo.text,
  day: todo.day,
  completed: todo.completed,
  revision: todo.revision,
  created_at: todo.createdAt,
  updated_at: todo.updatedAt,
})

function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [appearancePreference, setAppearancePreference] = useState<AppSettings['appearance']>('system')
  const [systemAppearance, setSystemAppearance] = useState<ResolvedAppearance>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const resolvedAppearance: ResolvedAppearance = appearancePreference === 'system' ? systemAppearance : appearancePreference

  useEffect(() => {
    let cancelled = false
    void loadSettings().then((storedSettings) => {
      if (!cancelled) setAppearancePreference(storedSettings.appearance)
    }).catch((error) => console.error('读取外观设置失败', error))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemAppearance = (event: MediaQueryListEvent) => setSystemAppearance(event.matches ? 'dark' : 'light')
    colorScheme.addEventListener('change', updateSystemAppearance)
    return () => colorScheme.removeEventListener('change', updateSystemAppearance)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedAppearance
    document.documentElement.style.colorScheme = resolvedAppearance
  }, [resolvedAppearance])

  return workspaceOpen ? (
    <KnowledgeBaseApp appearance={resolvedAppearance} session={session} onAppearanceChange={setAppearancePreference} onLogout={() => { setSession(null); setWorkspaceOpen(false) }} />
  ) : (
    <LoginScreen
      onLogin={(nextSession) => { setSession(nextSession); setWorkspaceOpen(true) }}
      onOffline={() => { setSession(null); setWorkspaceOpen(true) }}
    />
  )
}

function LoginScreen({ onLogin, onOffline }: { onLogin: (session: AuthSession) => void; onOffline: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const username = String(form.get('username') || '')
    const password = String(form.get('password') || '')
    const displayName = String(form.get('displayName') || '').trim()
    const confirmPassword = String(form.get('confirmPassword') || '')

    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    setSubmitting(true)
    try {
      const session = mode === 'register'
        ? await register(username, password, displayName)
        : await login(username, password)
      setError('')
      onLogin(session)
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand"><BookOpen size={21} /></div>
        <p className="login-product">知序</p>
        <h1>{mode === 'login' ? '登录知识空间' : '创建云端账户'}</h1>
        <p className="login-subtitle">{mode === 'login' ? '访问你的本地笔记、文档与知识问答。' : '注册后自动创建个人空间，并立即登录。'}</p>
        <form onSubmit={handleLogin}>
          <label>
            <span>用户名</span>
            <div className="login-field"><User size={17} /><input name="username" autoComplete="username" required autoFocus /></div>
          </label>
          {mode === 'register' && <label>
            <span>显示名称</span>
            <div className="login-field"><User size={17} /><input name="displayName" autoComplete="name" maxLength={30} required /></div>
          </label>}
          <label>
            <span>密码</span>
            <div className="login-field"><LockKeyhole size={17} /><input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 6 : undefined} maxLength={72} required /></div>
          </label>
          {mode === 'register' && <label>
            <span>确认密码</span>
            <div className="login-field"><LockKeyhole size={17} /><input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} maxLength={72} required /></div>
          </label>}
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? '正在连接…' : mode === 'login' ? '登录' : '注册并登录'}</button>
        </form>
        <div className="login-mode-row">
          <span>{mode === 'login' ? '还没有账号？' : '已有账号？'}</span>
          <button type="button" onClick={() => { setMode((current) => current === 'login' ? 'register' : 'login'); setError('') }}>
            {mode === 'login' ? '注册' : '返回登录'}
          </button>
        </div>
        <div className="login-divider"><span>或</span></div>
        <button className="offline-entry" type="button" onClick={onOffline}><CloudOff size={16} />离线进入本地知识库</button>
        <p className="login-footnote">离线编辑会保存在当前设备，下次登录后继续同步。</p>
      </section>
    </main>
  )
}

function KnowledgeBaseApp({ session, appearance, onAppearanceChange, onLogout }: { session: AuthSession | null; appearance: ResolvedAppearance; onAppearanceChange: (appearance: AppSettings['appearance']) => void; onLogout: () => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [spaces, setSpaces] = useState<ApiSpace[]>(() => session?.spaces || [])
  const [activeSpaceId, setActiveSpaceId] = useState(() => session?.spaces[0]?.id || '')
  const [userCollections, setUserCollections] = useState<Collection[]>(defaultCollections)
  const [view, setView] = useState<View>('首页')
  const [activeCollection, setActiveCollection] = useState('全部')
  const [query, setQuery] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(() => window.innerWidth > 960)
  const [assistantWidth, setAssistantWidth] = useState(readAssistantWidth)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [messages, setMessages] = useState<Message[]>(starterMessages)
  const [prompt, setPrompt] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [testingModel, setTestingModel] = useState(false)
  const [notice, setNotice] = useState('')
  const [profile, setProfile] = useState<UserProfile>(() => session ? {
    username: session.user.username,
    displayName: session.user.display_name,
    bio: session.user.bio || '',
    spaceName: session.spaces[0]?.name || defaultProfile.spaceName,
  } : defaultProfile)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [appVersion, setAppVersion] = useState(appVersionFallback)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)
  const [seenReleaseVersion, setSeenReleaseVersion] = useState(() => window.localStorage.getItem(releaseSeenStorageKey) || '')
  const [spaceEditorOpen, setSpaceEditorOpen] = useState(false)
  const [collectionEditorOpen, setCollectionEditorOpen] = useState(false)
  const [archiveFolders, setArchiveFolders] = useState<ArchiveFolder[]>([])
  const [selectedArchiveFolderId, setSelectedArchiveFolderId] = useState<string | null>(null)
  const [archiveFolderEditorOpen, setArchiveFolderEditorOpen] = useState(false)
  const [archiveParentId, setArchiveParentId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null)
  const [todoEditorOpen, setTodoEditorOpen] = useState(false)
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null)
  const [documents, setDocuments] = useState<ApiDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(Boolean(session))
  const [uploadingDocument, setUploadingDocument] = useState(false)
  const [documentSources, setDocumentSources] = useState<Record<string, string>>({})
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null)
  const [knowledgeFiles, setKnowledgeFiles] = useState<LocalKnowledgeFile[]>([])
  const [knowledgeFilesLoading, setKnowledgeFilesLoading] = useState(true)
  const [selectedKnowledgeFile, setSelectedKnowledgeFile] = useState<LocalKnowledgeFile | null>(null)
  const [knowledgeFileContent, setKnowledgeFileContent] = useState('')
  const [knowledgeFileDraft, setKnowledgeFileDraft] = useState('')
  const [knowledgeFileMode, setKnowledgeFileMode] = useState<'preview' | 'edit'>('preview')
  const [knowledgeFileLoading, setKnowledgeFileLoading] = useState(false)
  const [knowledgeFileSaving, setKnowledgeFileSaving] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [conflictNote, setConflictNote] = useState<Note | null>(null)
  const [resolvingConflict, setResolvingConflict] = useState(false)
  const [pendingEditorNavigation, setPendingEditorNavigation] = useState<PendingEditorNavigation | null>(null)
  const syncInFlight = useRef(false)
  const todoSyncInFlight = useRef(false)
  const profileHydrated = useRef(false)
  const settingsHydrated = useRef(false)
  const noteEditorFormRef = useRef<HTMLFormElement>(null)

  const handleAssistantWidthChange = useCallback((width: number, persist = false) => {
    const nextWidth = clampAssistantWidth(width, window.innerWidth)
    setAssistantWidth(nextWidth)
    if (persist) window.localStorage.setItem(assistantWidthStorageKey, String(nextWidth))
  }, [])

  const openReleaseNotes = () => {
    window.localStorage.setItem(releaseSeenStorageKey, appVersion)
    setSeenReleaseVersion(appVersion)
    setReleaseNotesOpen(true)
  }

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 960) setAssistantWidth((current) => clampAssistantWidth(current, window.innerWidth))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2400)
  }, [])

  const reloadLocalNotes = useCallback(async () => {
    const [storedNotes, queuedCount] = await Promise.all([loadNotes(), pendingNoteCount()])
    setNotes(storedNotes)
    setPendingCount(queuedCount)
    setSelectedNote((current) => current
      ? storedNotes.find((note) => String(note.id) === String(current.id)) || null
      : null)
  }, [])

  const synchronizeNotes = useCallback(async (announce = true, preferredSpaceId = '') => {
    if (!session || syncInFlight.current) return
    syncInFlight.current = true
    setSyncing(true)
    let syncedCount = 0
    let failedCount = 0
    let awaitingSpace = false
    try {
      const changes = await listPendingNoteChanges()
      for (const change of changes) {
        const id = String(change.note.id)
        const targetSpaceId = change.note.spaceId || preferredSpaceId || activeSpaceId || spaces[0]?.id
        if (change.operation === 'upsert' && !targetSpaceId) {
          awaitingSpace = true
          continue
        }
        try {
          await markNoteSyncing(id, change.note.updatedAt)
          setNotes((current) => current.map((note) => String(note.id) === id && note.updatedAt === change.note.updatedAt
            ? { ...note, syncStatus: 'syncing', syncError: null }
            : note))
          if (change.operation === 'delete') {
            try {
              await deleteCloudNote(session, id)
            } catch (error) {
              if (!(error instanceof ApiError && error.status === 404)) throw error
            }
            await completeNoteDelete(id, change.note.updatedAt)
          } else {
            let cloudNote: ApiNote
            if (!change.note.revision) {
              cloudNote = await createCloudNote(session, change.note.title, change.note.content, change.note.collection, id, targetSpaceId,
                Boolean(change.note.archived), change.note.archiveFolderId || null)
              if (cloudNote.title !== change.note.title || cloudNote.content !== change.note.content || cloudNote.collection !== change.note.collection || cloudNote.favorite !== Boolean(change.note.favorite)
                || Boolean(cloudNote.archived) !== Boolean(change.note.archived) || (cloudNote.archive_folder_id || null) !== (change.note.archiveFolderId || null)) {
                cloudNote = await updateCloudNote(session, cloudNote, {
                  title: change.note.title,
                  content: change.note.content,
                  collection: change.note.collection,
                  favorite: Boolean(change.note.favorite),
                  archived: Boolean(change.note.archived),
                  archive_folder_id: change.note.archiveFolderId || null,
                })
              }
            } else {
              cloudNote = await updateCloudNote(session, toApiNote(change.note, session), {
                title: change.note.title,
                content: change.note.content,
                collection: change.note.collection,
                favorite: Boolean(change.note.favorite),
                archived: Boolean(change.note.archived),
                archive_folder_id: change.note.archiveFolderId || null,
              })
            }
            await completeNoteSync(fromApiNote(cloudNote), change.note.updatedAt)
          }
          syncedCount += 1
        } catch (error) {
          let conflict = error instanceof ApiError && error.status === 409
          if (conflict && change.operation === 'upsert') {
            try {
              const remote = await getCloudNote(session, id)
              const alreadyApplied = remote.title === change.note.title
                && remote.content === change.note.content
                && remote.collection === change.note.collection
                && remote.favorite === Boolean(change.note.favorite)
                && Boolean(remote.archived) === Boolean(change.note.archived)
                && (remote.archive_folder_id || null) === (change.note.archiveFolderId || null)
              if (alreadyApplied) {
                await completeNoteSync(fromApiNote(remote), change.note.updatedAt)
                syncedCount += 1
                continue
              }
            } catch {
              conflict = true
            }
          }
          const message = error instanceof Error ? error.message : '同步失败'
          await markNoteSyncFailed(id, message, conflict, change.note.updatedAt)
          setNotes((current) => current.map((note) => String(note.id) === id && note.updatedAt === change.note.updatedAt
            ? { ...note, syncStatus: conflict ? 'conflict' : 'failed', syncError: message }
            : note))
          failedCount += 1
        }
      }
      await reloadLocalNotes()
      if (announce) {
        if (failedCount) showNotice(`${syncedCount} 条已同步，${failedCount} 条需要处理`)
        else if (syncedCount) showNotice(`${syncedCount} 条本地变更已同步`)
        else showNotice('本地与云端已是最新状态')
      }
    } finally {
      syncInFlight.current = false
      setSyncing(false)
      const remaining = session ? await listPendingNoteChanges() : []
      if (!awaitingSpace && remaining.some((change) => change.note.syncStatus === 'pending')) {
        window.setTimeout(() => void synchronizeNotes(false), 0)
      }
    }
  }, [activeSpaceId, reloadLocalNotes, session, showNotice, spaces])

  const reloadLocalTodos = useCallback(async () => {
    setTodos(await loadTodos())
  }, [])

  const synchronizeTodos = useCallback(async (announce = false, preferredSpaceId = '') => {
    if (!session || todoSyncInFlight.current) return
    todoSyncInFlight.current = true
    let syncedCount = 0
    let failedCount = 0
    try {
      const changes = await listPendingTodoChanges()
      for (const change of changes) {
        if (change.deletedAt && !change.revision && !change.spaceId) {
          await completeTodoDelete(change.id)
          continue
        }
        const targetSpaceId = change.spaceId || preferredSpaceId || activeSpaceId || spaces[0]?.id
        if (!targetSpaceId) continue
        try {
          await markTodoSyncing(change.id)
          if (change.deletedAt) {
            try {
              await deleteCloudTodo(session, change.id)
            } catch (error) {
              if (!(error instanceof ApiError && error.status === 404)) throw error
            }
            await completeTodoDelete(change.id)
          } else {
            let cloudTodo: ApiTodo
            if (!change.revision) {
              cloudTodo = await createCloudTodo(session, {
                id: change.id,
                text: change.text,
                day: change.day,
                completed: change.completed,
              }, targetSpaceId)
            } else {
              cloudTodo = await updateCloudTodo(session, toApiTodo(change, session), {
                text: change.text,
                day: change.day,
                completed: change.completed,
              })
            }
            if (cloudTodo.text !== change.text || cloudTodo.day !== change.day || cloudTodo.completed !== change.completed) {
              cloudTodo = await updateCloudTodo(session, cloudTodo, {
                text: change.text,
                day: change.day,
                completed: change.completed,
              })
            }
            await completeTodoSync(fromApiTodo(cloudTodo), change.updatedAt)
          }
          syncedCount += 1
        } catch (error) {
          if (error instanceof ApiError && error.status === 409 && !change.deletedAt) {
            try {
              const remote = (await listCloudTodos(session, change.day, targetSpaceId)).items.find((item) => item.id === change.id)
              if (remote) {
                const resolved = await updateCloudTodo(session, remote, {
                  text: change.text,
                  day: change.day,
                  completed: change.completed,
                })
                await completeTodoSync(fromApiTodo(resolved), change.updatedAt)
                syncedCount += 1
                continue
              }
            } catch {
              // Keep the local change pending for a later retry.
            }
          }
          const message = error instanceof Error ? error.message : '待办同步失败'
          await markTodoSyncFailed(change.id, message)
          failedCount += 1
        }
      }
      await reloadLocalTodos()
      if (announce) {
        if (failedCount) showNotice(`${syncedCount} 项待办已同步，${failedCount} 项稍后重试`)
        else if (syncedCount) showNotice(`${syncedCount} 项待办已同步`)
      }
    } finally {
      todoSyncInFlight.current = false
      const remaining = await listPendingTodoChanges()
      const retryable = remaining.some((todo) => todo.syncStatus === 'pending'
        && Boolean(todo.spaceId || preferredSpaceId || activeSpaceId || spaces[0]?.id))
      if (retryable) window.setTimeout(() => void synchronizeTodos(false, preferredSpaceId), 0)
    }
  }, [activeSpaceId, reloadLocalTodos, session, showNotice, spaces])

  const refreshDocuments = useCallback(async (silent = false) => {
    if (!session || !activeSpaceId) {
      setDocuments([])
      setDocumentsLoading(false)
      return
    }
    if (!silent) setDocumentsLoading(true)
    try {
      const result = await listDocuments(session, '', activeSpaceId)
      setDocuments(result.items)
      setDocumentSources((current) => ({
        ...current,
        ...Object.fromEntries(result.items.filter((item) => item.local_path).map((item) => [item.id, item.local_path as string])),
      }))
    } catch (error) {
      console.error('加载知识库文件失败', error)
    } finally {
      if (!silent) setDocumentsLoading(false)
    }
  }, [activeSpaceId, session])

  const refreshKnowledgeFiles = useCallback(async (silent = false) => {
    if (!silent) setKnowledgeFilesLoading(true)
    try {
      setKnowledgeFiles(await listKnowledgeFiles(settings.sourceDirectory))
    } catch (error) {
      console.error('扫描知识库目录失败', error)
      if (!silent) showNotice(`无法读取知识库目录：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      if (!silent) setKnowledgeFilesLoading(false)
    }
  }, [settings.sourceDirectory, showNotice])

  useEffect(() => {
    if (!isTauri()) return
    void getVersion().then(setAppVersion).catch((error) => console.error('读取应用版本失败', error))
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [storedNotes, storedTodos, queuedCount, storedProfile, storedSettings, sources, storedCollections, storedArchiveFolders] = await Promise.all([
          loadNotes(), loadTodos(), pendingNoteCount(), loadProfile(), loadSettings(), loadDocumentSources(), loadCollections(), loadArchiveFolders(activeSpaceId),
        ])
        if (cancelled) return
        setNotes(storedNotes)
        setTodos(storedTodos)
        setPendingCount(queuedCount)
        if (!profileHydrated.current) {
          setProfile(session ? {
            ...storedProfile,
            username: session.user.username,
            displayName: session.user.display_name,
            bio: session.user.bio || '',
            spaceName: spaces.find((space) => space.id === activeSpaceId)?.name || storedProfile.spaceName,
          } : storedProfile)
          profileHydrated.current = true
        }
        setSettings(storedSettings)
        onAppearanceChange(storedSettings.appearance)
        settingsHydrated.current = true
        setDocumentSources(sources)
        setUserCollections(mergeCollections(storedCollections, storedNotes))
        setArchiveFolders(storedArchiveFolders)
        try {
          const storedKnowledgeFiles = await listKnowledgeFiles(storedSettings.sourceDirectory)
          if (!cancelled) setKnowledgeFiles(storedKnowledgeFiles)
        } catch (error) {
          console.error('加载知识库文件失败', error)
        } finally {
          if (!cancelled) setKnowledgeFilesLoading(false)
        }
      } catch (error) {
        console.error('加载本地数据失败', error)
      }
      if (!session || cancelled) return
      try {
        if (activeSpaceId) {
          try {
            const syncedFolders = await synchronizeArchiveFolderTree(session, activeSpaceId)
            if (!cancelled) setArchiveFolders(syncedFolders)
          } catch (error) {
            console.error('同步归档目录失败', error)
          }
        }
        const [noteBatches, todoBatches] = await Promise.all([
          Promise.all(spaces.map((space) => listNotes(session, '', space.id))),
          Promise.all(spaces.map((space) => listCloudTodos(session, formatLocalDayKey(), space.id))),
        ])
        const cloudNotes = noteBatches.flatMap((batch) => batch.items).map(fromApiNote)
        const cloudTodos = todoBatches.flatMap((batch) => batch.items).map(fromApiTodo)
        await mergeCloudNotes(cloudNotes)
        await mergeCloudTodos(cloudTodos)
        if (!cancelled) {
          await Promise.all([reloadLocalNotes(), reloadLocalTodos()])
          setUserCollections((current) => mergeCollections(current, cloudNotes))
          await Promise.all([synchronizeNotes(false), synchronizeTodos(false)])
        }
      } catch (error) {
        console.error('连接云端笔记失败', error)
        if (!cancelled) showNotice('云端暂不可用，已继续使用本地笔记')
      }
      if (!cancelled) await refreshDocuments()
    })()
    return () => { cancelled = true }
  }, [activeSpaceId, onAppearanceChange, refreshDocuments, reloadLocalNotes, reloadLocalTodos, session, showNotice, spaces, synchronizeNotes, synchronizeTodos])

  useEffect(() => {
    if (!settingsHydrated.current) return
    const timeout = window.setTimeout(() => {
      void persistSettings(settings).catch((error) => console.error('自动保存设置失败', error))
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [settings])

  useEffect(() => {
    const activeSpace = spaces.find((space) => space.id === activeSpaceId)
    if (!activeSpace) return
    setProfile((current) => ({ ...current, spaceName: activeSpace.name }))
  }, [activeSpaceId, spaces])

  useEffect(() => {
    if (!session) return
    const handleOnline = () => {
      void synchronizeNotes()
      void synchronizeTodos()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [session, synchronizeNotes, synchronizeTodos])

  const filteredNotes = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return notes.filter((note) => {
      const matchesView =
        view === '归档' ? Boolean(note.archived) : view === '收藏' ? Boolean(note.favorite) : view === '草稿箱' ? note.collection === '草稿箱' : true
      const matchesSpace = !session || !activeSpaceId || !note.spaceId || note.spaceId === activeSpaceId
      const matchesCollection =
        activeCollection === '全部' || note.collection === activeCollection
      const matchesQuery =
        !normalized ||
        `${note.title}${note.summary}${note.content}${note.tag}`
          .toLowerCase()
          .includes(normalized)
      return matchesView && matchesSpace && matchesCollection && matchesQuery
    })
  }, [activeCollection, activeSpaceId, notes, query, session, view])

  const activeSpaceNoteCount = useMemo(() => notes.filter((note) => (
    !session || !activeSpaceId || !note.spaceId || note.spaceId === activeSpaceId
  )).length, [activeSpaceId, notes, session])

  const activeDraftCount = useMemo(() => notes.filter((note) => (
    note.collection === '草稿箱'
      && (!session || !activeSpaceId || !note.spaceId || note.spaceId === activeSpaceId)
  )).length, [activeSpaceId, notes, session])

  const activeFavoriteCount = useMemo(() => notes.filter((note) => (
    Boolean(note.favorite)
      && (!session || !activeSpaceId || !note.spaceId || note.spaceId === activeSpaceId)
  )).length, [activeSpaceId, notes, session])

  const activeKnowledgeFileCount = useMemo(() => {
    const localFiles = knowledgeFiles
    const linkedCloudIds = new Set(localFiles.map((file) => findCloudDocument(file, documents)?.id).filter(Boolean))
    const cloudOnlyCount = documents.filter((document) => !linkedCloudIds.has(document.id)).length
    return localFiles.length + cloudOnlyCount
  }, [documents, knowledgeFiles])

  const handleImportDocument = async () => {
    if (uploadingDocument) return
    let importedFile: LocalKnowledgeFile | null = null
    try {
      if (!settings.sourceDirectory.trim()) {
        showNotice('请先设置知识库文件目录')
        setSettingsOpen(true)
        return
      }
      const selected = await selectKnowledgeDocument()
      if (!selected) return
      if (!selected.supportedForIndexing) {
        window.alert(`${selected.fileName} 不是可编辑的 Markdown/TXT 文件。`)
        return
      }
      setUploadingDocument(true)
      showNotice(`正在导入“${selected.fileName}”`)
      importedFile = await importKnowledgeFile(selected, settings.sourceDirectory)
      setKnowledgeFiles((current) => [importedFile as LocalKnowledgeFile, ...current.filter((file) => file.id !== importedFile?.id)])
      setView('知识库文件')
      await handleOpenKnowledgeFile(importedFile)

      if (!session || !settings.uploadAfterImport) {
        showNotice(importedFile.storage === 'filesystem'
          ? `已保存到本机知识库：${settings.sourceDirectory}`
          : '已保存到浏览器本地知识库')
        return
      }
      if (!activeSpaceId) {
        showNotice('已保存到本机；创建知识空间后才能同步云端')
        return
      }

      showNotice(`已保存本机，正在同步“${selected.fileName}”`)
      const result = await uploadDocument(session, selected.fileName, selected.bytes, selected.mimeType, settings.sourceDirectory, activeSpaceId)
      const localPath = importedFile.storage === 'filesystem' ? importedFile.path : result.document.local_path || ''
      const uploadedDocument: ApiDocument = {
        id: result.document.id,
        title: result.document.title,
        mime_type: selected.mimeType,
        status: result.document.status,
        page_count: null,
        chunk_count: 0,
        tags: [],
        local_path: localPath,
        updated_at: new Date().toISOString(),
      }
      if (localPath) {
        await saveDocumentSource(result.document.id, selected.fileName, localPath)
        setDocumentSources((current) => ({ ...current, [result.document.id]: localPath }))
      }
      setDocuments((current) => [uploadedDocument, ...current.filter((item) => item.id !== result.document.id)])
      showNotice(`本机文件已保存，云端索引：${statusLabel(result.job.status)}`)
      await refreshDocuments(true)
    } catch (error) {
      console.error('导入文档失败', error)
      window.alert(`${importedFile ? '文件已保存到本机，但云端同步失败' : '导入失败'}：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setUploadingDocument(false)
    }
  }

  const handleUploadKnowledgeFile = async (file: LocalKnowledgeFile) => {
    if (!session) {
      showNotice('文件已在本机知识库中；登录后才能上传云端')
      return
    }
    if (!activeSpaceId) {
      showNotice('请先创建或选择一个云端知识空间')
      return
    }
    if (uploadingDocument) return
    setUploadingDocument(true)
    try {
      const content = await readKnowledgeFile(file)
      const bytes = new TextEncoder().encode(content)
      const result = await uploadDocument(session, file.name, bytes, file.mimeType, settings.sourceDirectory, activeSpaceId)
      const localPath = file.storage === 'filesystem' ? file.path : result.document.local_path || ''
      const uploadedDocument: ApiDocument = {
        id: result.document.id,
        title: result.document.title,
        mime_type: file.mimeType,
        status: result.document.status,
        page_count: null,
        chunk_count: 0,
        tags: [],
        local_path: localPath,
        updated_at: new Date().toISOString(),
      }
      if (localPath) {
        await saveDocumentSource(result.document.id, file.name, localPath)
        setDocumentSources((current) => ({ ...current, [result.document.id]: localPath }))
      }
      setDocuments((current) => [uploadedDocument, ...current.filter((item) => item.id !== uploadedDocument.id)])
      showNotice('文件已保存到本机知识库，正在进行云端解析')
      await refreshDocuments(true)
    } catch (error) {
      window.alert(`上传云端失败，本机文件不受影响：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setUploadingDocument(false)
    }
  }

  const handleOpenKnowledgeFile = async (file: LocalKnowledgeFile) => {
    setSelectedKnowledgeFile(file)
    setDocumentPreview(null)
    setKnowledgeFileLoading(true)
    setKnowledgeFileMode('preview')
    try {
      const content = await readKnowledgeFile(file)
      setKnowledgeFileContent(content)
      setKnowledgeFileDraft(content)
    } catch (error) {
      setSelectedKnowledgeFile(null)
      window.alert(`无法读取文件：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setKnowledgeFileLoading(false)
    }
  }

  const handleCloseKnowledgeFile = () => {
    if (knowledgeFileDraft !== knowledgeFileContent && !window.confirm('当前修改还没有保存，确定返回文件列表吗？')) return
    setSelectedKnowledgeFile(null)
    setKnowledgeFileContent('')
    setKnowledgeFileDraft('')
    setKnowledgeFileMode('preview')
  }

  const handleSaveKnowledgeFile = async () => {
    if (!selectedKnowledgeFile || knowledgeFileSaving) return
    setKnowledgeFileSaving(true)
    try {
      const updated = await saveKnowledgeFile(selectedKnowledgeFile, knowledgeFileDraft)
      setSelectedKnowledgeFile(updated)
      setKnowledgeFiles((current) => current.map((file) => file.id === updated.id ? updated : file))
      setKnowledgeFileContent(knowledgeFileDraft)
      setKnowledgeFileMode('preview')
      showNotice('文件已写回本机知识库')
    } catch (error) {
      window.alert(`保存文件失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setKnowledgeFileSaving(false)
    }
  }

  const handleOpenLocalSource = async (file: LocalKnowledgeFile) => {
    if (file.storage !== 'filesystem') return
    try {
      await openSourceFile(file.path)
    } catch (error) {
      window.alert(`无法打开源文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleOpenSource = async (document: ApiDocument) => {
    const path = documentSources[document.id] || document.local_path
    if (!path) return
    try {
      await openSourceFile(path)
    } catch (error) {
      window.alert(`无法打开源文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handlePreviewDocument = async (document: ApiDocument) => {
    if (!session) return
    try {
      const result = await getDocumentContent(session, document.id)
      setSelectedKnowledgeFile(null)
      setDocumentPreview({ document, content: result.content, mimeType: result.mime_type })
    } catch (error) {
      window.alert(`无法读取提取文本：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleDeleteDocument = async (document: ApiDocument) => {
    if (!session) return
    if (!window.confirm(`删除“${document.title}”的云端记录？后端接通向量索引后，此操作也必须清理对应向量。`)) return
    try {
      await deleteDocument(session, document.id)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
      showNotice('知识库文件云端记录已删除')
    } catch (error) {
      window.alert(`删除失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const setNoteArchive = async (note: Note, archived: boolean, folderId: string | null) => {
    try {
      const updated = await updateLocalNote(note.id, { archived, archiveFolderId: archived ? folderId : null })
      setNotes((current) => current.map((item) => String(item.id) === String(updated.id) ? updated : item))
      setSelectedNote((current) => String(current?.id) === String(updated.id) ? updated : current)
      setPendingCount(await pendingNoteCount())
      showNotice(archived ? `已归档至${archivePathLabel(archiveFolders, folderId)}` : '已移出归档')
      if (session) void synchronizeNotes(false)
    } catch (error) {
      window.alert(`归档笔记失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const applyCloudDocumentMetadata = async (document: ApiDocument, patch: CloudFileMetadataPatch) => {
    if (!session) return null
    const updated = await updateDocumentMetadata(session, document, patch)
    setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item))
    setDocumentPreview((current) => current?.document.id === updated.id ? { ...current, document: updated } : current)
    return updated
  }

  const applyKnowledgeFileMetadata = async (file: LocalKnowledgeFile, patch: LocalFileMetadataPatch) => {
    const updated = await updateKnowledgeFileMetadata(file, patch)
    setKnowledgeFiles((current) => current.map((item) => item.id === updated.id ? updated : item))
    setSelectedKnowledgeFile((current) => current?.id === updated.id ? updated : current)
    const cloudDocument = findCloudDocument(updated, documents)
    if (session && cloudDocument) {
      const cloudPatch: CloudFileMetadataPatch = {}
      if (patch.collection !== undefined) cloudPatch.collection = updated.collection
      if (patch.favorite !== undefined) cloudPatch.favorite = updated.favorite
      if (patch.archived !== undefined) cloudPatch.archived = updated.archived
      if (patch.archiveFolderId !== undefined) cloudPatch.archive_folder_id = updated.archiveFolderId
      if (Object.keys(cloudPatch).length) await applyCloudDocumentMetadata(cloudDocument, cloudPatch)
    }
    return updated
  }

  const setKnowledgeFileArchive = async (file: LocalKnowledgeFile, archived: boolean, folderId: string | null) => {
    try {
      await applyKnowledgeFileMetadata(file, { archived, archiveFolderId: archived ? folderId : null })
      showNotice(archived ? `文件已归档至${archivePathLabel(archiveFolders, folderId)}` : '文件已移出归档')
    } catch (error) {
      window.alert(`归档文件失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const setKnowledgeFileCollection = async (file: LocalKnowledgeFile, collection: string) => {
    try {
      await applyKnowledgeFileMetadata(file, { collection })
      showNotice(isDraftCollection(collection) ? '文件已移入未分类' : `文件已归入“${collection}”`)
    } catch (error) {
      window.alert(`文件分类保存失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const setKnowledgeFileFavorite = async (file: LocalKnowledgeFile, favorite: boolean) => {
    try {
      await applyKnowledgeFileMetadata(file, { favorite })
      showNotice(favorite ? '文件已收藏' : '文件已取消收藏')
    } catch (error) {
      window.alert(`文件收藏状态保存失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const setCloudDocumentArchive = async (document: ApiDocument, archived: boolean, folderId: string | null) => {
    if (!session) return
    try {
      await applyCloudDocumentMetadata(document, { archived, archive_folder_id: archived ? folderId : null })
      showNotice(archived ? `云端文件已归档至${archivePathLabel(archiveFolders, folderId)}` : '云端文件已移出归档')
    } catch (error) {
      window.alert(`归档云端文件失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const setCloudDocumentCollection = async (document: ApiDocument, collection: string) => {
    if (!session) return
    try {
      await applyCloudDocumentMetadata(document, { collection })
      showNotice(isDraftCollection(collection) ? '云端文件已移入未分类' : `云端文件已归入“${collection}”`)
    } catch (error) {
      window.alert(`云端文件分类保存失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const setCloudDocumentFavorite = async (document: ApiDocument, favorite: boolean) => {
    if (!session) return
    try {
      await applyCloudDocumentMetadata(document, { favorite })
      showNotice(favorite ? '云端文件已收藏' : '云端文件已取消收藏')
    } catch (error) {
      window.alert(`云端文件收藏状态保存失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const submitArchiveTarget = (folderId: string | null) => {
    const target = archiveTarget
    setArchiveTarget(null)
    if (!target) return
    if (target.kind === 'note') void setNoteArchive(target.item, true, folderId)
    else if (target.kind === 'local-file') void setKnowledgeFileArchive(target.item, true, folderId)
    else void setCloudDocumentArchive(target.item, true, folderId)
  }

  const toggleFavorite = (id: Note['id']) => {
    const current = notes.find((note) => String(note.id) === String(id))
    if (!current) return
    void updateLocalNote(id, { favorite: !current.favorite })
      .then(async (updated) => {
        setNotes((items) => items.map((note) => String(note.id) === String(id) ? updated : note))
        setSelectedNote((selected) => String(selected?.id) === String(id) ? updated : selected)
        setPendingCount(await pendingNoteCount())
        if (session) void synchronizeNotes(false)
      })
      .catch((error) => window.alert(`收藏状态保存失败：${error instanceof Error ? error.message : '未知错误'}`))
  }

  const handleSaveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingNote) return
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') || '').trim()
    const content = String(form.get('content') || '').trim()
    const collection = String(form.get('collection') || '草稿箱')
    const archived = form.get('archived') === 'on'
    const archiveFolderId = archived ? String(form.get('archiveFolderId') || '') || null : null
    if (!title) {
      event.currentTarget.reportValidity()
      return
    }
    const navigationAfterSave = pendingEditorNavigation
    setSavingNote(true)
    try {
      const targetSpaceId = editingNote?.spaceId || activeSpaceId || spaces[0]?.id
      const saved = editingNote
        ? await updateLocalNote(editingNote.id, { title, content, collection, archived, archiveFolderId })
        : await createLocalNote({ title, content, collection, archived, archiveFolderId, spaceId: targetSpaceId || undefined })
      setNotes((current) => editingNote
        ? current.map((note) => String(note.id) === String(saved.id) ? saved : note)
        : [saved, ...current])
      setSelectedNote((current) => String(current?.id) === String(saved.id) ? saved : current)
      setPendingCount(await pendingNoteCount())
      const canSync = Boolean(saved.spaceId || targetSpaceId)
      showNotice(!session
        ? '已保存到本机，等待登录后同步'
        : canSync ? '已保存到本机，正在同步' : '已保存到本机，创建知识空间后可同步')
      setEditorOpen(false)
      setEditingNote(null)
      setPendingEditorNavigation(null)
      navigationAfterSave?.action()
      if (session && canSync) void synchronizeNotes(false, targetSpaceId)
    } catch (error) {
      console.error('保存笔记失败', error)
      window.alert(`保存失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setSavingNote(false)
    }
  }

  const handleDeleteNote = async (note: Note) => {
    try {
      const message = `确定删除“${note.title}”吗？笔记会先从本机移除${session ? '，并同步删除云端副本' : ''}。`
      const confirmed = isTauri()
        ? await confirmDialog(message, { title: '删除笔记', kind: 'warning', okLabel: '删除', cancelLabel: '取消' })
        : window.confirm(message)
      if (!confirmed) return

      await deleteLocalNote(note.id)
      setNotes((current) => current.filter((item) => String(item.id) !== String(note.id)))
      setSelectedNote(null)
      setEditorOpen(false)
      setEditingNote(null)
      setPendingCount(await pendingNoteCount())
      showNotice(session ? '笔记已从本机删除，正在同步云端' : '笔记已从本机删除')
      if (session) void synchronizeNotes(false)
    } catch (error) {
      window.alert(`删除失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const openNewNote = () => {
    setSelectedNote(null)
    setEditingNote(null)
    setEditorOpen(true)
  }

  const openNoteEditor = (note: Note) => {
    setEditingNote(note)
    setSelectedNote(null)
    setEditorOpen(true)
  }

  const handleResolveConflict = async (useLocal: boolean) => {
    if (!session || !conflictNote) return
    setResolvingConflict(true)
    try {
      const remote = await getCloudNote(session, String(conflictNote.id))
      const resolved = useLocal
        ? await updateCloudNote(session, remote, {
          title: conflictNote.title,
          content: conflictNote.content,
          collection: conflictNote.collection,
          favorite: Boolean(conflictNote.favorite),
          archived: Boolean(conflictNote.archived),
          archive_folder_id: conflictNote.archiveFolderId || null,
        })
        : remote
      await completeNoteSync(fromApiNote(resolved))
      await reloadLocalNotes()
      setConflictNote(null)
      showNotice(useLocal ? '已使用本机版本解决冲突' : '已采用云端版本')
    } catch (error) {
      window.alert(`解决冲突失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setResolvingConflict(false)
    }
  }

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const nextProfile: UserProfile = {
      username: session ? profile.username : String(form.get('username') || '').trim(),
      displayName: String(form.get('displayName') || '').trim(),
      bio: String(form.get('bio') || '').trim(),
      spaceName: String(form.get('spaceName') || '').trim(),
    }
    if (!nextProfile.username || !nextProfile.displayName || !nextProfile.spaceName) {
      showNotice(session ? '请填写显示名称和知识空间名称' : '请填写用户名、显示名称和知识空间名称')
      return
    }
    setSavingProfile(true)
    try {
      let savedProfile = nextProfile
      if (session) {
        const cloudUser = await updateProfile(session, nextProfile.displayName, nextProfile.bio)
        const activeSpace = spaces.find((space) => space.id === activeSpaceId)
        if (activeSpace && activeSpace.name !== nextProfile.spaceName) {
          const renamed = await renameSpace(session, activeSpace.id, nextProfile.spaceName)
          setSpaces((current) => current.map((space) => space.id === renamed.id ? renamed : space))
        }
        savedProfile = { ...nextProfile, username: cloudUser.username, displayName: cloudUser.display_name, bio: cloudUser.bio || '' }
      }
      await persistProfile(savedProfile)
      setProfile(savedProfile)
      showNotice(session ? '个人资料已同步到云端' : '个人资料已保存到本机')
    } catch (error) {
      console.error('保存个人资料失败', error)
      window.alert(`个人资料保存失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setSavingProfile(false)
    }
  }

  const handleSaveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const nextSettings = {
        ...settings,
        sourceDirectory: settings.sourceDirectory.trim() || defaultSettings.sourceDirectory,
      }
      await persistSettings(nextSettings)
      setSettings(nextSettings)
      setSettingsOpen(false)
      showNotice('应用设置已保存')
    } catch (error) {
      window.alert(`设置保存失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleSelectSourceDirectory = async () => {
    if (!isTauri()) {
      showNotice('浏览器模式不能浏览 Windows 目录，请直接填写目录标识')
      return
    }
    const directory = await selectSourceDirectory()
    if (directory) setSettings((current) => ({ ...current, sourceDirectory: directory }))
  }

  const handleTestModel = async () => {
    if (!settings.aiBaseUrl.trim() || !settings.aiModel.trim()) {
      window.alert('请先填写模型服务 URL 和模型名称。')
      return
    }
    setTestingModel(true)
    try {
      if (session) await chatWithModel(session, modelSettings(settings), '请只回复“连接成功”。', '')
      else await chatDirectlyWithModel(modelSettings(settings), '请只回复“连接成功”。', '')
      await persistSettings(settings)
      showNotice(`模型 ${settings.aiModel} 连接成功`)
    } catch (error) {
      window.alert(`模型连接失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setTestingModel(false)
    }
  }

  const handleCreateSpace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session) {
      showNotice('登录后才能创建云端知识空间')
      return
    }
    const name = String(new FormData(event.currentTarget).get('name') || '').trim()
    if (!name) return
    try {
      const created = await createSpace(session, name)
      setSpaces((current) => [...current, created])
      setActiveSpaceId(created.id)
      setProfile((current) => ({ ...current, spaceName: created.name }))
      setSpaceEditorOpen(false)
      showNotice(`已创建知识空间“${created.name}”`)
      void synchronizeNotes(false, created.id)
      void synchronizeTodos(false, created.id)
    } catch (error) {
      window.alert(`创建知识空间失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleCreateCollection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const color = String(form.get('color') || '#407a62')
    if (!name || name === '草稿箱' || name === '收件箱') return
    if (userCollections.some((item) => item.name === name)) {
      window.alert('这个分类已经存在。')
      return
    }
    try {
      const next = [...userCollections, { name, color }]
      await persistCollections(next)
      setUserCollections(next)
      setActiveCollection(name)
      setView('全部笔记')
      setCollectionEditorOpen(false)
      showNotice(`已创建分类“${name}”`)
    } catch (error) {
      window.alert(`创建分类失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleCreateArchiveFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') || '').trim()
    if (!name) return
    try {
      const folder = await createLocalArchiveFolder(name, archiveParentId, activeSpaceId || undefined)
      if (session && activeSpaceId) {
        await createCloudArchiveFolder(session, folder.name, folder.parentId, folder.id, activeSpaceId)
      }
      setArchiveFolders(await loadArchiveFolders(activeSpaceId))
      setSelectedArchiveFolderId(folder.id)
      setArchiveFolderEditorOpen(false)
      setArchiveParentId(null)
      showNotice(`已创建归档目录“${folder.name}”`)
    } catch (error) {
      window.alert(`创建归档目录失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleDeleteArchiveFolder = async (folder: ArchiveFolder) => {
    if (!window.confirm(`删除归档目录“${folder.name}”及其下级目录？其中内容会保留在归档根目录。`)) return
    try {
      if (session) {
        try {
          await deleteCloudArchiveFolder(session, folder.id)
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error
        }
      }
      await deleteLocalArchiveFolder(folder.id)
      setSelectedArchiveFolderId(null)
      await Promise.all([reloadLocalNotes(), refreshKnowledgeFiles(true), refreshDocuments(true)])
      setArchiveFolders(await loadArchiveFolders(activeSpaceId))
      showNotice('归档目录已删除，内容已移到归档根目录')
    } catch (error) {
      window.alert(`删除归档目录失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleDeleteCollection = async (collection: Collection) => {
    const affectedNotes = notes.filter((note) => note.collection === collection.name)
    const detail = affectedNotes.length
      ? `，其中 ${affectedNotes.length} 条笔记会移到草稿箱`
      : ''
    if (!window.confirm(`删除分类“${collection.name}”${detail}？`)) return
    try {
      const movedNotes = await Promise.all(affectedNotes.map((note) => updateLocalNote(note.id, { collection: '草稿箱' })))
      const movedById = new Map(movedNotes.map((note) => [String(note.id), note]))
      const nextCollections = userCollections.filter((item) => item.name !== collection.name)
      await persistCollections(nextCollections)
      setUserCollections(nextCollections)
      setNotes((current) => current.map((note) => movedById.get(String(note.id)) || note))
      setSelectedNote((current) => current ? movedById.get(String(current.id)) || current : null)
      setEditingNote((current) => current ? movedById.get(String(current.id)) || current : null)
      if (activeCollection === collection.name) {
        setActiveCollection('全部')
        setView('全部笔记')
      }
      setPendingCount(await pendingNoteCount())
      showNotice(affectedNotes.length
        ? `分类已删除，${affectedNotes.length} 条笔记已移到草稿箱`
        : '分类已删除')
      if (session && affectedNotes.length) void synchronizeNotes(false)
    } catch (error) {
      window.alert(`删除分类失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleSaveTodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = String(new FormData(event.currentTarget).get('text') || '').trim()
    if (!text) return
    const targetSpaceId = editingTodo?.spaceId || activeSpaceId || spaces[0]?.id
    try {
      const saved = editingTodo
        ? await updateLocalTodo({ ...editingTodo, spaceId: targetSpaceId || undefined }, { text })
        : await createLocalTodo(text, targetSpaceId || undefined)
      setTodos((current) => sortTodoItems(editingTodo
        ? current.map((todo) => todo.id === saved.id ? saved : todo)
        : [...current, saved]))
      setTodoEditorOpen(false)
      setEditingTodo(null)
      showNotice(session && targetSpaceId ? '待办已保存到本机，正在同步' : '待办已保存到本机')
      if (session && targetSpaceId) void synchronizeTodos(false, targetSpaceId)
    } catch (error) {
      window.alert(`待办保存失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleToggleTodo = async (todo: TodoItem) => {
    const targetSpaceId = todo.spaceId || activeSpaceId || spaces[0]?.id
    try {
      const updated = await updateLocalTodo({ ...todo, spaceId: targetSpaceId || undefined }, { completed: !todo.completed })
      setTodos((current) => sortTodoItems(current.map((item) => item.id === updated.id ? updated : item)))
      if (session && targetSpaceId) void synchronizeTodos(false, targetSpaceId)
    } catch (error) {
      window.alert(`待办更新失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleDeleteTodo = async (todo: TodoItem) => {
    if (!window.confirm(`删除待办“${todo.text}”？`)) return
    const targetSpaceId = todo.spaceId || activeSpaceId || spaces[0]?.id
    try {
      await deleteLocalTodo({ ...todo, spaceId: targetSpaceId || undefined })
      setTodos((current) => current.filter((item) => item.id !== todo.id))
      if (session && targetSpaceId) void synchronizeTodos(false, targetSpaceId)
    } catch (error) {
      window.alert(`待办删除失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const askAssistant = async (event: FormEvent) => {
    event.preventDefault()
    const question = prompt.trim()
    if (!question || isThinking) return

    setMessages((current) => [...current, { role: 'user', text: question }])
    setPrompt('')
    if (!settings.aiBaseUrl.trim() || !settings.aiModel.trim()) {
      setMessages((current) => [...current, { role: 'assistant', text: '尚未配置模型服务，请先在设置中填写 URL、API Key 和模型名称。' }])
      setSettingsOpen(true)
      return
    }
    setIsThinking(true)
    try {
      const availableNotes = notes.filter((note) => !activeSpaceId || !note.spaceId || note.spaceId === activeSpaceId)
      if (session) {
        const usedSources = rankNoteSources(question, availableNotes, false)
        const context = usedSources.map((note) => `《${note.title}》\n${note.content}`).join('\n\n---\n\n').slice(0, 14000)
        const response = await chatWithModel(session, modelSettings(settings), question, context, activeSpaceId)
        setMessages((current) => [...current, {
          role: 'assistant',
          text: response.answer,
          sources: usedSources,
          cloudSources: response.references?.filter((reference) => reference.type === 'cloud_document'),
        }])
      } else {
        const localContext = await buildLocalModelContext(question, availableNotes, settings.sourceDirectory)
        setKnowledgeFiles(localContext.allFiles)
        const response = await chatDirectlyWithModel(modelSettings(settings), question, localContext.context)
        setMessages((current) => [...current, {
          role: 'assistant',
          text: response.answer,
          sources: localContext.noteSources,
          fileSources: localContext.fileSources,
        }])
      }
    } catch (error) {
      setMessages((current) => [...current, {
        role: 'assistant',
        text: `模型请求失败：${error instanceof Error ? error.message : '未知错误'}`,
      }])
    } finally {
      setIsThinking(false)
    }
  }

  const requestEditorNavigation = (destination: string, action: () => void) => {
    if (!editorOpen) {
      action()
      return
    }
    setPendingEditorNavigation({ destination, action })
    setMobileMenuOpen(false)
  }

  const applyViewChange = (next: View) => {
    setSelectedNote(null)
    if (next === '知识库文件') {
      setSelectedKnowledgeFile(null)
      setDocumentPreview(null)
      void refreshKnowledgeFiles()
      if (session) void refreshDocuments(true)
    }
    if (next === '归档') {
      void refreshKnowledgeFiles(true)
      void loadArchiveFolders(activeSpaceId).then(setArchiveFolders)
      if (session) void refreshDocuments(true)
    }
    setView(next)
    setActiveCollection('全部')
    setMobileMenuOpen(false)
  }

  const changeView = (next: View) => requestEditorNavigation(next, () => applyViewChange(next))
  const requestNewNote = () => requestEditorNavigation('新建笔记', openNewNote)
  const requestCloseEditor = () => requestEditorNavigation('笔记列表', () => {
    setEditorOpen(false)
    setEditingNote(null)
  })
  const requestCollectionChange = (name: string) => requestEditorNavigation(`分类“${name}”`, () => {
    setSelectedNote(null)
    setActiveCollection(name)
    setView('全部笔记')
    setMobileMenuOpen(false)
  })
  const requestSpaceChange = (spaceId: string) => {
    const spaceName = spaces.find((space) => space.id === spaceId)?.name || '知识空间'
    requestEditorNavigation(spaceName, () => {
      setSelectedNote(null)
      setActiveSpaceId(spaceId)
      setActiveCollection('全部')
      setMobileMenuOpen(false)
    })
  }
  const requestLogout = () => requestEditorNavigation('退出登录', () => {
    if (session) void logout(session).catch(() => undefined).finally(onLogout)
    else onLogout()
  })

  const saveBeforeEditorNavigation = () => {
    const form = noteEditorFormRef.current
    if (!form) return
    if (!form.checkValidity()) {
      setPendingEditorNavigation(null)
      window.requestAnimationFrame(() => form.reportValidity())
      return
    }
    form.requestSubmit()
  }

  const discardBeforeEditorNavigation = () => {
    const navigation = pendingEditorNavigation
    setPendingEditorNavigation(null)
    setEditorOpen(false)
    setEditingNote(null)
    navigation?.action()
  }

  return (
    <div
      className={`app-shell ${assistantOpen ? '' : 'assistant-collapsed'}`}
      style={{ '--assistant-width': `${assistantWidth}px` } as CSSProperties}
    >
      <Sidebar
        view={view}
        activeCollection={activeCollection}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onViewChange={changeView}
        onCollectionChange={requestCollectionChange}
        onCreate={requestNewNote}
        onLogout={requestLogout}
        profile={profile}
        noteCount={activeSpaceNoteCount}
        knowledgeFileCount={activeKnowledgeFileCount}
        draftCount={activeDraftCount}
        favoriteCount={activeFavoriteCount}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSpaceChange={requestSpaceChange}
        onAddSpace={() => setSpaceEditorOpen(true)}
        collections={userCollections}
        onAddCollection={() => setCollectionEditorOpen(true)}
        onDeleteCollection={(collection) => void handleDeleteCollection(collection)}
        collectionCounts={Object.fromEntries(userCollections.map((collection) => [
          collection.name,
          notes.filter((note) => note.collection === collection.name && (!activeSpaceId || !note.spaceId || note.spaceId === activeSpaceId)).length,
        ]))}
        spaceCounts={Object.fromEntries(spaces.map((space) => [space.id, notes.filter((note) => note.spaceId === space.id).length]))}
        pendingCount={pendingCount}
        online={Boolean(session)}
        onEditProfile={() => changeView('个人资料')}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileMenuOpen(true)} aria-label="打开菜单">
            <Menu size={19} />
          </button>
          <label className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={view === '知识库文件' ? '搜索知识库文件' : '搜索笔记、标签或内容'}
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="清空搜索"><X size={15} /></button>
            )}
          </label>
          <div className="top-actions">
            <button
              className={`sync-action ${session ? '' : 'offline'}`}
              onClick={() => { void synchronizeNotes(); void synchronizeTodos(true) }}
              disabled={!session || syncing}
              title={session ? '立即同步本地笔记和待办' : '登录后可同步云端'}
            >
              {session ? <RefreshCw size={15} className={syncing ? 'spin' : ''} /> : <CloudOff size={15} />}
              <span>{syncing ? '同步中' : pendingCount ? `${pendingCount} 条待同步` : session ? '已同步' : '离线'}</span>
            </button>
            {settings.notificationsEnabled && <button
              className={`icon-button notification-button ${seenReleaseVersion === appVersion ? '' : 'has-update'}`}
              onClick={openReleaseNotes}
              aria-label="版本更新"
              title="查看版本更新"
            ><Bell size={18} /><i /></button>}
            {!assistantOpen && (
              <button className="ai-open-button" onClick={() => setAssistantOpen(true)}>
                <Sparkles size={16} /> AI 管家
              </button>
            )}
          </div>
        </header>

        <div className="content-scroll">
          {editorOpen ? (
            <NoteEditor
              key={`note-editor-${editingNote?.id ?? 'new'}`}
              note={editingNote}
              online={Boolean(session)}
              saving={savingNote}
              collections={userCollections}
              archiveFolders={archiveFolders}
              appearance={appearance}
              defaultCollection={activeCollection !== '全部' ? activeCollection : '草稿箱'}
              formRef={noteEditorFormRef}
              onBack={requestCloseEditor}
              onCancel={() => { setPendingEditorNavigation(null); setEditorOpen(false); setEditingNote(null) }}
              onDelete={(note) => void handleDeleteNote(note)}
              onSubmit={handleSaveNote}
            />
          ) : selectedNote ? (
            <NoteDetail
              note={selectedNote}
              archiveFolders={archiveFolders}
              onClose={() => setSelectedNote(null)}
              onFavorite={() => toggleFavorite(selectedNote.id)}
              onEdit={() => openNoteEditor(selectedNote)}
              onDelete={() => void handleDeleteNote(selectedNote)}
              onArchive={(archived) => archived
                ? setArchiveTarget({ kind: 'note', item: selectedNote })
                : void setNoteArchive(selectedNote, false, null)}
              onResolve={() => setConflictNote(selectedNote)}
            />
          ) : view === '知识库文件' ? (
            selectedKnowledgeFile ? (
              <KnowledgeFileEditor
                file={selectedKnowledgeFile}
                content={knowledgeFileContent}
                draft={knowledgeFileDraft}
                mode={knowledgeFileMode}
                loading={knowledgeFileLoading}
                saving={knowledgeFileSaving}
                onDraftChange={setKnowledgeFileDraft}
                onModeChange={setKnowledgeFileMode}
                onBack={handleCloseKnowledgeFile}
                onSave={() => void handleSaveKnowledgeFile()}
                collections={userCollections}
                archiveFolders={archiveFolders}
                cloudDocument={findCloudDocument(selectedKnowledgeFile, documents)}
                onCollectionChange={(collection) => void setKnowledgeFileCollection(selectedKnowledgeFile, collection)}
                onFavoriteChange={(favorite) => void setKnowledgeFileFavorite(selectedKnowledgeFile, favorite)}
                onArchive={(archived) => archived
                  ? setArchiveTarget({ kind: 'local-file', item: selectedKnowledgeFile })
                  : void setKnowledgeFileArchive(selectedKnowledgeFile, false, null)}
              />
            ) : documentPreview ? (
              <DocumentTextPreview
                preview={documentPreview}
                collections={userCollections}
                archiveFolders={archiveFolders}
                onClose={() => setDocumentPreview(null)}
                onCollectionChange={(collection) => void setCloudDocumentCollection(documentPreview.document, collection)}
                onFavoriteChange={(favorite) => void setCloudDocumentFavorite(documentPreview.document, favorite)}
                onArchive={(archived) => archived
                  ? setArchiveTarget({ kind: 'cloud-file', item: documentPreview.document })
                  : void setCloudDocumentArchive(documentPreview.document, false, null)}
              />
            ) : (
              <KnowledgeFilesView
                localFiles={knowledgeFiles}
                documents={documents}
                localLoading={knowledgeFilesLoading}
                cloudLoading={documentsLoading}
                uploading={uploadingDocument}
                directory={settings.sourceDirectory}
                online={Boolean(session)}
                query={query}
                onUpload={() => void handleImportDocument()}
                onUploadCloud={(file) => void handleUploadKnowledgeFile(file)}
                onDelete={(document) => void handleDeleteDocument(document)}
                onArchive={(document) => setArchiveTarget({ kind: 'cloud-file', item: document })}
                onArchiveLocal={(file) => setArchiveTarget({ kind: 'local-file', item: file })}
                onFavorite={(file, favorite) => void setKnowledgeFileFavorite(file, favorite)}
                onFavoriteDocument={(document, favorite) => void setCloudDocumentFavorite(document, favorite)}
                sourcePaths={documentSources}
                onOpenLocal={(file) => void handleOpenKnowledgeFile(file)}
                onOpenLocalSource={(file) => void handleOpenLocalSource(file)}
                onOpenSource={(document) => void handleOpenSource(document)}
                onPreview={(document) => void handlePreviewDocument(document)}
                onRefresh={() => { void refreshKnowledgeFiles(); void refreshDocuments() }}
              />
            )
          ) : view === '个人资料' ? (
            <ProfilePage profile={profile} online={Boolean(session)} saving={savingProfile} onSubmit={handleSaveProfile} />
          ) : view === '归档' ? (
            <ArchiveView
              folders={archiveFolders}
              selectedFolderId={selectedArchiveFolderId}
              notes={notes}
              localFiles={knowledgeFiles}
              documents={documents}
              query={query}
              onSelectFolder={setSelectedArchiveFolderId}
              onAddFolder={(parentId) => { setArchiveParentId(parentId); setArchiveFolderEditorOpen(true) }}
              onDeleteFolder={(folder) => void handleDeleteArchiveFolder(folder)}
              onOpenNote={setSelectedNote}
              onOpenFile={(file) => { setView('知识库文件'); void handleOpenKnowledgeFile(file) }}
              onOpenDocument={(document) => void handlePreviewDocument(document)}
              onUnarchiveNote={(note) => void setNoteArchive(note, false, null)}
              onUnarchiveFile={(file) => void setKnowledgeFileArchive(file, false, null)}
              onUnarchiveDocument={(document) => void setCloudDocumentArchive(document, false, null)}
              onMoveNote={(note) => setArchiveTarget({ kind: 'note', item: note })}
              onMoveFile={(file) => setArchiveTarget({ kind: 'local-file', item: file })}
              onMoveDocument={(document) => setArchiveTarget({ kind: 'cloud-file', item: document })}
            />
          ) : view === '首页' && !query && activeCollection === '全部' ? (
            <HomeView
              notes={notes}
              todos={todos}
              pendingCount={pendingCount}
              profile={profile}
              archiveFolders={archiveFolders}
              onOpen={setSelectedNote}
              onFavorite={toggleFavorite}
              onDeleteNote={(note) => void handleDeleteNote(note)}
              onCreate={openNewNote}
              onAddTodo={() => { setEditingTodo(null); setTodoEditorOpen(true) }}
              onToggleTodo={(todo) => void handleToggleTodo(todo)}
              onEditTodo={(todo) => { setEditingTodo(todo); setTodoEditorOpen(true) }}
              onDeleteTodo={(todo) => void handleDeleteTodo(todo)}
            />
          ) : (
            <NotesView
              title={activeCollection !== '全部' ? activeCollection : view}
              notes={filteredNotes}
              query={query}
              archiveFolders={archiveFolders}
              onOpen={setSelectedNote}
              onFavorite={toggleFavorite}
              onDelete={(note) => void handleDeleteNote(note)}
              onCreate={openNewNote}
            />
          )}
        </div>
      </main>

      {assistantOpen && (
        <AssistantPanel
          messages={messages}
          prompt={prompt}
          thinking={isThinking}
          onPromptChange={setPrompt}
          onSubmit={askAssistant}
          onClose={() => setAssistantOpen(false)}
          onSuggestion={(text) => setPrompt(text)}
          onOpenSource={setSelectedNote}
          onOpenKnowledgeSource={(file) => {
            setView('知识库文件')
            setAssistantOpen(false)
            void handleOpenKnowledgeFile(file)
          }}
          onOpenCloudSource={(source) => {
            const document = documents.find((item) => item.id === source.id) || {
              id: source.id,
              title: source.title,
              mime_type: source.mime_type || 'text/markdown',
              status: 'ready' as const,
              page_count: null,
              chunk_count: 0,
              tags: [],
              updated_at: new Date().toISOString(),
            }
            setView('知识库文件')
            setAssistantOpen(false)
            void handlePreviewDocument(document)
          }}
          configured={Boolean(settings.aiBaseUrl.trim() && settings.aiModel.trim())}
          online={Boolean(session)}
          modelName={settings.aiModel}
          panelWidth={assistantWidth}
          onPanelWidthChange={handleAssistantWidthChange}
        />
      )}

      <nav className={`mobile-nav ${editorOpen ? 'editor-hidden' : ''}`} aria-label="移动端导航">
        <button className={view === '首页' ? 'active' : ''} onClick={() => changeView('首页')}><Home /><span>首页</span></button>
        <button className={view === '全部笔记' ? 'active' : ''} onClick={() => changeView('全部笔记')}><FileText /><span>笔记</span></button>
        <button className="mobile-add" onClick={requestNewNote} aria-label="新建笔记"><Plus /></button>
        <button onClick={() => setAssistantOpen(true)}><Bot /><span>AI 管家</span></button>
        <button onClick={() => setMobileMenuOpen(true)}><Folder /><span>空间</span></button>
      </nav>

      {settingsOpen && (
        <SettingsEditor
          settings={settings}
          appVersion={appVersion}
          online={Boolean(session)}
          displayName={profile.displayName}
          cloudAccount={session?.user.username || profile.username}
          cloudSpace={spaces.find((space) => space.id === activeSpaceId)?.name || profile.spaceName}
          onChange={(nextSettings) => { setSettings(nextSettings); onAppearanceChange(nextSettings.appearance) }}
          onSelectDirectory={() => void handleSelectSourceDirectory()}
          onTestModel={() => void handleTestModel()}
          testingModel={testingModel}
          onOpenProfile={() => { setSettingsOpen(false); changeView('个人资料') }}
          onOpenReleaseNotes={() => { setSettingsOpen(false); openReleaseNotes() }}
          onClose={() => setSettingsOpen(false)}
          onSubmit={handleSaveSettings}
        />
      )}
      {releaseNotesOpen && <ReleaseNotes appVersion={appVersion} onClose={() => setReleaseNotesOpen(false)} />}
      {spaceEditorOpen && <NameEditor title="新建知识空间" description="空间会保存到云端数据库" placeholder="例如：工作知识库" submitLabel="创建空间" onClose={() => setSpaceEditorOpen(false)} onSubmit={handleCreateSpace} />}
      {collectionEditorOpen && <CollectionEditor onClose={() => setCollectionEditorOpen(false)} onSubmit={handleCreateCollection} />}
      {archiveFolderEditorOpen && <ArchiveFolderEditor parent={archiveParentId ? archiveFolders.find((folder) => folder.id === archiveParentId) || null : null} onClose={() => { setArchiveFolderEditorOpen(false); setArchiveParentId(null) }} onSubmit={handleCreateArchiveFolder} />}
      {archiveTarget && <ArchiveTargetEditor target={archiveTarget} folders={archiveFolders} onClose={() => setArchiveTarget(null)} onSubmit={submitArchiveTarget} />}
      {pendingEditorNavigation && <EditorNavigationPrompt destination={pendingEditorNavigation.destination} saving={savingNote} onContinue={() => setPendingEditorNavigation(null)} onDiscard={discardBeforeEditorNavigation} onSave={saveBeforeEditorNavigation} />}
      {todoEditorOpen && <TodoEditor todo={editingTodo} onClose={() => { setTodoEditorOpen(false); setEditingTodo(null) }} onSubmit={handleSaveTodo} />}
      {conflictNote && (
        <ConflictResolver
          note={conflictNote}
          resolving={resolvingConflict}
          onClose={() => setConflictNote(null)}
          onUseLocal={() => void handleResolveConflict(true)}
          onUseCloud={() => void handleResolveConflict(false)}
        />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}

function Sidebar({
  view,
  activeCollection,
  open,
  onClose,
  onViewChange,
  onCollectionChange,
  onCreate,
  onLogout,
  profile,
  noteCount,
  knowledgeFileCount,
  draftCount,
  favoriteCount,
  spaces,
  activeSpaceId,
  onSpaceChange,
  onAddSpace,
  collections,
  onAddCollection,
  onDeleteCollection,
  collectionCounts,
  spaceCounts,
  pendingCount,
  online,
  onEditProfile,
  onOpenSettings,
}: {
  view: View
  activeCollection: string
  open: boolean
  onClose: () => void
  onViewChange: (view: View) => void
  onCollectionChange: (name: string) => void
  onCreate: () => void
  onLogout: () => void
  profile: UserProfile
  noteCount: number
  knowledgeFileCount: number
  draftCount: number
  favoriteCount: number
  spaces: ApiSpace[]
  activeSpaceId: string
  onSpaceChange: (spaceId: string) => void
  onAddSpace: () => void
  collections: Collection[]
  onAddCollection: () => void
  onDeleteCollection: (collection: Collection) => void
  collectionCounts: Record<string, number>
  spaceCounts: Record<string, number>
  pendingCount: number
  online: boolean
  onEditProfile: () => void
  onOpenSettings: () => void
}) {
  const nav: { label: View; icon: typeof Home; count?: number }[] = [
    { label: '首页', icon: Home },
    { label: '全部笔记', icon: FileText, count: noteCount },
    { label: '知识库文件', icon: Database, count: knowledgeFileCount },
    { label: '草稿箱', icon: FilePenLine, count: draftCount },
    { label: '收藏', icon: Heart, count: favoriteCount },
    { label: '归档', icon: Archive },
  ]
  return (
    <>
      {open && <button className="sidebar-backdrop" onClick={onClose} aria-label="关闭菜单" />}
      <aside className={`sidebar ${open ? 'mobile-open' : ''}`}>
        <div className="sidebar-mobile-head"><button className="icon-button sidebar-close" onClick={onClose} aria-label="关闭菜单"><X size={18} /></button></div>
        <button className="new-note" onClick={onCreate}><Plus size={17} />新建笔记</button>
        <nav className="side-nav">
          {nav.map((item) => (
            <button
              key={item.label}
              className={view === item.label && activeCollection === '全部' ? 'active' : ''}
              onClick={() => onViewChange(item.label)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && <small>{item.count}</small>}
            </button>
          ))}
        </nav>
        <div className="section-label"><span>知识空间</span><button onClick={onAddSpace} aria-label="添加知识空间" title="添加知识空间"><Plus size={14} /></button></div>
        <div className="space-list">
          {spaces.length ? spaces.map((space) => (
            <button key={space.id} className={activeSpaceId === space.id ? 'active' : ''} onClick={() => onSpaceChange(space.id)}>
              <Cloud size={14} /><span>{space.name}</span>{spaceCounts[space.id] > 0 && <small>{spaceCounts[space.id]}</small>}
            </button>
          )) : (
            <button className="active"><HardDrive size={14} /><span>本机空间</span>{noteCount > 0 && <small>{noteCount}</small>}</button>
          )}
        </div>
        <div className="section-label collection-heading"><span>分类</span><button onClick={onAddCollection} aria-label="添加分类" title="添加分类"><Plus size={14} /></button></div>
        <div className="collection-list">
          {collections.map((collection) => (
            <div key={collection.name} className={`collection-item ${activeCollection === collection.name ? 'active' : ''}`}>
              <button className="collection-open" onClick={() => onCollectionChange(collection.name)}>
                <i style={{ backgroundColor: collection.color }} />
                <span>{collection.name}</span>
                {collectionCounts[collection.name] > 0 && <small>{collectionCounts[collection.name]}</small>}
              </button>
              <button className="collection-delete" onClick={() => onDeleteCollection(collection)} aria-label="删除分类" title={`删除分类：${collection.name}`}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className={`connection-state ${online ? 'online' : 'offline'}`}>
            {online ? <Cloud size={15} /> : <CloudOff size={15} />}
            <span>{online ? pendingCount ? `${pendingCount} 条等待同步` : '云端已连接' : '本地离线模式'}</span>
          </div>
          <button onClick={onOpenSettings}><Settings size={17} /><span>设置</span></button>
          <div className={`profile-area ${view === '个人资料' ? 'active' : ''}`}>
            <button className="profile" onClick={onEditProfile} aria-label="个人资料">
              <div className="avatar">{profile.displayName.slice(0, 1)}</div>
              <div><strong>{profile.displayName}</strong><span>{profile.spaceName}</span></div>
            </button>
            <button className="profile-logout" onClick={onLogout} aria-label="退出登录" title="退出登录"><LogOut size={15} /><span>退出登录</span></button>
          </div>
        </div>
      </aside>
    </>
  )
}

function HomeView({ notes, todos, pendingCount, profile, archiveFolders, onOpen, onFavorite, onDeleteNote, onCreate, onAddTodo, onToggleTodo, onEditTodo, onDeleteTodo }: {
  notes: Note[]
  todos: TodoItem[]
  pendingCount: number
  profile: UserProfile
  archiveFolders: ArchiveFolder[]
  onOpen: (note: Note) => void
  onFavorite: (id: Note['id']) => void
  onDeleteNote: (note: Note) => void
  onCreate: () => void
  onAddTodo: () => void
  onToggleTodo: (todo: TodoItem) => void
  onEditTodo: (todo: TodoItem) => void
  onDeleteTodo: (todo: TodoItem) => void
}) {
  const pinned = notes.filter((note) => note.pinned).slice(0, 2)
  const recent = notes.slice(0, 4)
  const reviewNote = pickDailyReview(notes)
  const remainingTodos = todos.filter((todo) => !todo.completed).length
  return (
    <div className="page home-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">{formatToday()}</p>
          <h1>你好，{profile.displayName}</h1>
          <p>你的知识库里有 <strong>{notes.length}</strong> 条笔记，<strong>{pendingCount}</strong> 条变更等待同步。</p>
        </div>
        <button className="primary-action" onClick={onCreate}><PenLine size={17} />记录想法</button>
      </section>

      <section className="focus-band">
        <div className="focus-icon"><Lightbulb size={20} /></div>
        <div className="focus-copy">
          <span>今日回顾</span>
          <strong>{reviewNote?.summary || '今天还没有可回顾的笔记。'}</strong>
        </div>
        {reviewNote && <button onClick={() => onOpen(reviewNote)}>查看笔记 <ArrowUp size={15} /></button>}
      </section>

      <section className="dashboard-section todo-section">
        <div className="section-heading">
          <div><span className="section-kicker">待处理</span><h2>今日待办</h2></div>
          <div className="todo-heading-actions"><small>{remainingTodos} 项未完成</small><button onClick={onAddTodo} aria-label="添加今日待办" title="添加今日待办"><Plus size={16} /></button></div>
        </div>
        {todos.length ? (
          <div className="todo-list">
            {todos.map((todo) => (
              <article className={`todo-item ${todo.completed ? 'completed' : ''}`} key={todo.id}>
                <span className="todo-copy"><strong>{todo.text}</strong><small>{todo.completed ? '已完成' : '待完成'}</small></span>
                <div className="todo-actions">
                  <button onClick={() => onEditTodo(todo)} aria-label={`编辑待办：${todo.text}`} title="编辑待办"><PenLine size={14} /></button>
                  <button onClick={() => onDeleteTodo(todo)} aria-label={`删除待办：${todo.text}`} title="删除待办"><Trash2 size={14} /></button>
                  <button className="todo-complete" onClick={() => onToggleTodo(todo)} aria-label={`${todo.completed ? '恢复' : '完成'}待办：${todo.text}`} title={todo.completed ? '恢复为未完成' : '标记完成'}><Check size={14} /></button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="todo-empty"><Check size={16} /><span>今天还没有待办</span></div>
        )}
      </section>

      <section className="dashboard-section">
        <div className="section-heading">
          <div><span className="section-kicker">置顶内容</span><h2>持续关注</h2></div>
          <button>查看全部</button>
        </div>
        <div className="pinned-grid">
          {pinned.map((note, index) => (
            <article className={`pinned-note accent-${index + 1}`} key={note.id} onClick={() => onOpen(note)}>
              <div className="card-topline"><span><Pin size={13} /> {note.collection}</span></div>
              <h3>{note.title}</h3>
              <p>{note.summary}</p>
              <div className="note-meta"><span className="tag">{note.tag}</span><span>{note.updated}</span></div>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-section recent-section">
        <div className="section-heading">
          <div><span className="section-kicker">最近编辑</span><h2>继续你的思路</h2></div>
          <button>全部笔记</button>
        </div>
        <div className="note-list">
          {recent.map((note) => <NoteRow key={note.id} note={note} archiveFolders={archiveFolders} onOpen={onOpen} onFavorite={onFavorite} onDelete={onDeleteNote} />)}
        </div>
      </section>
    </div>
  )
}

function NotesView({ title, notes, query, archiveFolders, onOpen, onFavorite, onDelete, onCreate }: { title: string; notes: Note[]; query: string; archiveFolders: ArchiveFolder[]; onOpen: (note: Note) => void; onFavorite: (id: Note['id']) => void; onDelete: (note: Note) => void; onCreate: () => void }) {
  return (
    <div className="page notes-page">
      <div className="notes-header">
        <div><p className="eyebrow">知识库</p><h1>{query ? `“${query}” 的搜索结果` : title}</h1><p>共 {notes.length} 条内容</p></div>
        <button className="primary-action" onClick={onCreate}><Plus size={17} />新建笔记</button>
      </div>
      {notes.length ? (
        <div className="note-list full-list">
        {notes.map((note) => <NoteRow key={note.id} note={note} archiveFolders={archiveFolders} onOpen={onOpen} onFavorite={onFavorite} onDelete={onDelete} />)}
        </div>
      ) : (
        <div className="empty-state">
          <div><Search size={22} /></div>
          <h2>没有找到相关内容</h2>
          <p>换一个关键词，或者新建一条笔记。</p>
          <button onClick={onCreate}>新建笔记</button>
        </div>
      )}
    </div>
  )
}

function KnowledgeFilesView({ localFiles, documents, localLoading, cloudLoading, uploading, directory, online, query, sourcePaths, onUpload, onUploadCloud, onDelete, onArchive, onArchiveLocal, onFavorite, onFavoriteDocument, onOpenLocal, onOpenLocalSource, onOpenSource, onPreview, onRefresh }: {
  localFiles: LocalKnowledgeFile[]
  documents: ApiDocument[]
  localLoading: boolean
  cloudLoading: boolean
  uploading: boolean
  directory: string
  online: boolean
  query: string
  sourcePaths: Record<string, string>
  onUpload: () => void
  onUploadCloud: (file: LocalKnowledgeFile) => void
  onDelete: (document: ApiDocument) => void
  onArchive: (document: ApiDocument) => void
  onArchiveLocal: (file: LocalKnowledgeFile) => void
  onFavorite: (file: LocalKnowledgeFile, favorite: boolean) => void
  onFavoriteDocument: (document: ApiDocument, favorite: boolean) => void
  onOpenLocal: (file: LocalKnowledgeFile) => void
  onOpenLocalSource: (file: LocalKnowledgeFile) => void
  onOpenSource: (document: ApiDocument) => void
  onPreview: (document: ApiDocument) => void
  onRefresh: () => void
}) {
  const normalizedQuery = query.trim().toLowerCase()
  const visibleLocalFiles = localFiles.filter((file) => !normalizedQuery || `${file.name}${file.relativePath}`.toLowerCase().includes(normalizedQuery))
  const linkedCloudIds = new Set(localFiles.map((file) => findCloudDocument(file, documents)?.id).filter(Boolean))
  const visibleDocuments = documents.filter((document) => !linkedCloudIds.has(document.id) && (!normalizedQuery || document.title.toLowerCase().includes(normalizedQuery)))
  return (
    <div className="page documents-page">
      <div className="notes-header">
        <div><p className="eyebrow">本机知识库</p><h1>知识库文件</h1><p>自动读取目录中的 Markdown 和 TXT 文件</p></div>
        <button className="primary-action" onClick={onUpload} disabled={uploading}>{uploading ? <RefreshCw size={17} className="spin" /> : <Upload size={17} />}{uploading ? '保存中…' : '保存到知识库'}</button>
      </div>
      <div className="document-summary">
        <div><HardDrive size={18} /><span><strong>{localFiles.length}</strong> 个本机文件</span></div>
        <p title={directory}>{directory}</p>
        <button onClick={onRefresh}><RefreshCw size={13} />重新扫描</button>
      </div>

      <section className="knowledge-file-section">
        <div className="file-section-heading"><div><span>本机目录</span><h2>可阅读和编辑</h2></div><small>MD / TXT</small></div>
        {localLoading ? (
          <div className="empty-state inline-empty"><div><Database size={22} /></div><h2>正在扫描知识库目录</h2></div>
        ) : visibleLocalFiles.length ? (
          <div className="document-list local-document-list">
            <div className="document-list-head"><span>文件</span><span>类型</span><span>保存状态</span><span>更新时间</span><span>操作</span></div>
            {visibleLocalFiles.map((file) => {
              const cloudDocument = findCloudDocument(file, documents)
              return <article className="document-row" key={file.id}>
                <button className="document-title" onClick={() => onOpenLocal(file)} title="在页面中查看文件"><div className="doc-icon"><FileText size={18} /></div><span><strong>{file.name}</strong><small>{file.relativePath}{!isDraftCollection(file.collection) ? ` · ${file.collection}` : ''}</small></span></button>
                <span className="document-type">{formatMimeType(file.mimeType)}</span>
                <span className="file-storage-status"><span><HardDrive size={11} />知识库已保存</span><span className={`cloud-file-state ${cloudDocument ? `status-${cloudDocument.status}` : ''}`}><i />{cloudDocument ? cloudFileStatus(cloudDocument.status) : '未上传云端'}</span></span>
                <time>{new Date(file.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                <div className="document-actions">
                  <button onClick={() => onOpenLocalSource(file)} disabled={file.storage !== 'filesystem'} title={file.storage === 'filesystem' ? '用系统默认程序打开' : '浏览器本地文件没有系统路径'}><ExternalLink size={15} /></button>
                  <button onClick={() => onOpenLocal(file)} title="查看和编辑"><FilePenLine size={15} /></button>
                  {cloudDocument
                    ? <button onClick={() => onPreview(cloudDocument)} disabled={cloudDocument.status !== 'ready'} title={cloudDocument.status === 'ready' ? '查看云端解析内容' : '云端正在处理'}><Cloud size={15} /></button>
                    : online && <button onClick={() => onUploadCloud(file)} disabled={uploading} title="上传至云端"><Upload size={15} /></button>}
                  <button className={file.favorite ? 'active' : ''} onClick={() => onFavorite(file, !file.favorite)} title={file.favorite ? '取消收藏' : '收藏文件'}><Heart size={15} fill={file.favorite ? 'currentColor' : 'none'} /></button>
                  <button onClick={() => onArchiveLocal(file)} title="移入归档"><Archive size={15} /></button>
                </div>
              </article>
            })}
          </div>
        ) : (
          <div className="empty-state inline-empty"><div><Upload size={22} /></div><h2>{query ? '没有匹配的本机文件' : '目录中还没有知识库文件'}</h2><p>{query ? '换一个关键词继续搜索。' : '保存 Markdown 或 TXT 后会自动出现在这里，并可供离线 AI 使用。'}</p>{!query && <button onClick={onUpload} disabled={uploading}>{uploading ? '保存中…' : '保存第一个文件'}</button>}</div>
        )}
      </section>

      {online && <section className="knowledge-file-section cloud-file-section">
        <div className="file-section-heading"><div><span>云端空间</span><h2>仅云端记录</h2></div><small>{visibleDocuments.length} 个记录</small></div>
        {cloudLoading ? (
          <div className="empty-state inline-empty"><div><Cloud size={22} /></div><h2>正在读取云端索引</h2></div>
        ) : visibleDocuments.length ? (
        <div className="document-list">
          <div className="document-list-head"><span>文件</span><span>类型</span><span>索引状态</span><span>更新时间</span><span>操作</span></div>
          {visibleDocuments.map((document) => (
            <article className="document-row" key={document.id}>
              <button className="document-title" onClick={() => onPreview(document)} title="查看云端解析内容"><div className="doc-icon"><FileText size={18} /></div><span><strong>{document.title}</strong><small>{!isDraftCollection(document.collection) ? `${document.collection} · ` : ''}{document.chunk_count ? `${document.chunk_count} 个切块` : '尚未生成切块'}</small></span></button>
              <span className="document-type">{formatMimeType(document.mime_type)}</span>
              <span className={`status-badge status-${document.status}`}><i />{statusLabel(document.status)}</span>
              <time>{new Date(document.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
              <div className="document-actions">
                <button onClick={() => onOpenSource(document)} disabled={!sourcePaths[document.id]} title={sourcePaths[document.id] ? '用系统默认程序打开源文件' : '当前设备没有源文件路径'}><ExternalLink size={15} /></button>
                <button onClick={() => onPreview(document)} title="查看云端解析内容"><Eye size={15} /></button>
                <button className={document.favorite ? 'active' : ''} onClick={() => onFavoriteDocument(document, !document.favorite)} title={document.favorite ? '取消收藏' : '收藏文件'}><Heart size={15} fill={document.favorite ? 'currentColor' : 'none'} /></button>
                <button onClick={() => onArchive(document)} title="移入归档"><Archive size={15} /></button>
                <button className="delete-action" onClick={() => onDelete(document)} title="删除云端记录"><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
          <div className="empty-state inline-empty"><div><Cloud size={22} /></div><h2>{query ? '没有匹配的云端记录' : '还没有云端索引记录'}</h2></div>
        )}
      </section>}
    </div>
  )
}

function ArchiveView({ folders, selectedFolderId, notes, localFiles, documents, query, onSelectFolder, onAddFolder, onDeleteFolder, onOpenNote, onOpenFile, onOpenDocument, onUnarchiveNote, onUnarchiveFile, onUnarchiveDocument, onMoveNote, onMoveFile, onMoveDocument }: {
  folders: ArchiveFolder[]
  selectedFolderId: string | null
  notes: Note[]
  localFiles: LocalKnowledgeFile[]
  documents: ApiDocument[]
  query: string
  onSelectFolder: (folderId: string | null) => void
  onAddFolder: (parentId: string | null) => void
  onDeleteFolder: (folder: ArchiveFolder) => void
  onOpenNote: (note: Note) => void
  onOpenFile: (file: LocalKnowledgeFile) => void
  onOpenDocument: (document: ApiDocument) => void
  onUnarchiveNote: (note: Note) => void
  onUnarchiveFile: (file: LocalKnowledgeFile) => void
  onUnarchiveDocument: (document: ApiDocument) => void
  onMoveNote: (note: Note) => void
  onMoveFile: (file: LocalKnowledgeFile) => void
  onMoveDocument: (document: ApiDocument) => void
}) {
  const normalizedQuery = query.trim().toLowerCase()
  const selectedPath = archiveFolderPath(folders, selectedFolderId)
  const matchesQuery = (value: string) => !normalizedQuery || value.toLowerCase().includes(normalizedQuery)
  const archivedNotes = notes.filter((note) => Boolean(note.archived))
  const linkedFiles = localFiles.map((file) => ({ file, cloudDocument: findCloudDocument(file, documents) }))
  const linkedCloudIds = new Set(linkedFiles.map(({ cloudDocument }) => cloudDocument?.id).filter(Boolean))
  const archivedFiles = linkedFiles
    .filter(({ file, cloudDocument }) => file.archived || Boolean(cloudDocument?.archived))
    .map((entry) => ({ ...entry, folderId: entry.file.archived ? entry.file.archiveFolderId : entry.cloudDocument?.archive_folder_id || null }))
  const cloudOnlyDocuments = documents.filter((document) => Boolean(document.archived) && !linkedCloudIds.has(document.id))
  const visibleNotes = archivedNotes.filter((note) => (note.archiveFolderId || null) === selectedFolderId && matchesQuery(`${note.title} ${note.content}`))
  const visibleFiles = archivedFiles.filter(({ file, folderId }) => (folderId || null) === selectedFolderId && matchesQuery(`${file.name} ${file.relativePath}`))
  const visibleDocuments = cloudOnlyDocuments.filter((document) => (document.archive_folder_id || null) === selectedFolderId && matchesQuery(document.title))
  const directCount = (folderId: string | null) => archivedNotes.filter((note) => (note.archiveFolderId || null) === folderId).length
    + archivedFiles.filter((file) => (file.folderId || null) === folderId).length
    + cloudOnlyDocuments.filter((document) => (document.archive_folder_id || null) === folderId).length

  const renderTree = (parentId: string | null, depth = 0) => folders
    .filter((folder) => folder.parentId === parentId)
    .map((folder) => (
      <div className="archive-tree-branch" key={folder.id}>
        <div className="archive-tree-row" style={{ paddingLeft: `${12 + depth * 18}px` }}>
          <button className={selectedFolderId === folder.id ? 'archive-tree-item active' : 'archive-tree-item'} onClick={() => onSelectFolder(folder.id)}><FolderOpen size={15} /><span>{folder.name}</span><small>{directCount(folder.id)}</small></button>
          <button className="archive-tree-delete" onClick={() => onDeleteFolder(folder)} aria-label={`删除归档目录：${folder.name}`} title="删除目录"><Trash2 size={13} /></button>
        </div>
        {renderTree(folder.id, depth + 1)}
      </div>
    ))

  return (
    <div className="page archive-page">
      <header className="notes-header archive-header">
        <div><p className="eyebrow">整理与回顾</p><h1>归档</h1><p>把暂时不在工作区的笔记和文件收进有层次的目录。</p></div>
        <button className="primary-action" onClick={() => onAddFolder(selectedFolderId)}><FolderPlus size={16} />新建目录</button>
      </header>
      <div className="archive-layout">
        <aside className="archive-folder-panel">
          <div className="archive-panel-heading"><span>归档目录</span><button onClick={() => onAddFolder(null)} aria-label="新建根目录" title="新建根目录"><Plus size={15} /></button></div>
          <button className={selectedFolderId === null ? 'archive-tree-item root active' : 'archive-tree-item root'} onClick={() => onSelectFolder(null)}><Archive size={15} /><span>归档根目录</span><small>{directCount(null)}</small></button>
          <div className="archive-tree">{renderTree(null)}</div>
        </aside>
        <section className="archive-items-panel">
          <div className="archive-items-heading"><div><span>当前位置</span><h2>{selectedPath}</h2></div><small>{visibleNotes.length + visibleFiles.length + visibleDocuments.length} 项内容</small></div>
          {visibleNotes.length + visibleFiles.length + visibleDocuments.length === 0 ? (
            <div className="empty-state inline-empty"><div><Archive size={22} /></div><h2>{query ? '没有匹配的归档内容' : '这个目录还没有内容'}</h2><p>在笔记或知识库文件中使用归档按钮即可收纳内容。</p></div>
          ) : (
            <div className="archive-item-list">
              {visibleNotes.length > 0 && <div className="archive-item-group"><h3>笔记</h3>{visibleNotes.map((note) => (
                <article className="archive-item-row" key={`note-${note.id}`}>
                  <button onClick={() => onOpenNote(note)}><FileText size={16} /><span><strong>{note.title}</strong><small>{note.updated}</small><span className="archive-item-status"><ContentStateBadges folders={folders} archived archiveFolderId={note.archiveFolderId} collection={note.collection} favorite={note.favorite} showCloud={false} /><SyncLabel note={note} /></span></span></button>
                  <div className="archive-row-actions"><button className="archive-action" onClick={() => onMoveNote(note)} aria-label={`更改归档目录：${note.title}`} title="更改归档目录"><FolderOpen size={15} /></button><button className="archive-action" onClick={() => onUnarchiveNote(note)} aria-label={`移出归档：${note.title}`} title="移出归档"><Archive size={15} /></button></div>
                </article>
              ))}</div>}
              {visibleFiles.length > 0 && <div className="archive-item-group"><h3>文件</h3>{visibleFiles.map(({ file, cloudDocument, folderId }) => (
                <article className="archive-item-row" key={`file-${file.id}`}>
                  <button onClick={() => onOpenFile(file)}><BookOpen size={16} /><span><strong>{file.name}</strong><small>{file.relativePath}</small><ContentStateBadges folders={folders} archived archiveFolderId={folderId} collection={file.collection} favorite={file.favorite} cloudDocument={cloudDocument} /></span></button>
                  <div className="archive-row-actions"><button className="archive-action" onClick={() => onMoveFile(file)} aria-label={`更改归档目录：${file.name}`} title="更改归档目录"><FolderOpen size={15} /></button><button className="archive-action" onClick={() => onUnarchiveFile(file)} aria-label={`移出归档：${file.name}`} title="移出归档"><Archive size={15} /></button></div>
                </article>
              ))}</div>}
              {visibleDocuments.length > 0 && <div className="archive-item-group"><h3>仅云端文件</h3>{visibleDocuments.map((document) => (
                <article className="archive-item-row" key={`document-${document.id}`}>
                  <button onClick={() => onOpenDocument(document)} disabled={document.status !== 'ready'}><Cloud size={16} /><span><strong>{document.title}</strong><small>{statusLabel(document.status)}</small><ContentStateBadges folders={folders} archived archiveFolderId={document.archive_folder_id} collection={document.collection} favorite={document.favorite} cloudDocument={document} /></span></button>
                  <div className="archive-row-actions"><button className="archive-action" onClick={() => onMoveDocument(document)} aria-label={`更改归档目录：${document.title}`} title="更改归档目录"><FolderOpen size={15} /></button><button className="archive-action" onClick={() => onUnarchiveDocument(document)} aria-label={`移出归档：${document.title}`} title="移出归档"><Archive size={15} /></button></div>
                </article>
              ))}</div>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function ContentStateBadges({ folders, archived, archiveFolderId, collection, favorite, cloudDocument, syncLabel, showCloud = true }: {
  folders: ArchiveFolder[]
  archived: boolean
  archiveFolderId?: string | null
  collection?: string | null
  favorite?: boolean
  cloudDocument?: ApiDocument | null
  syncLabel?: string
  showCloud?: boolean
}) {
  return (
    <span className="content-state-badges">
      <span className={archived ? 'content-state active' : 'content-state muted'}><Archive size={12} />{archived ? archiveFolderStatus(folders, archiveFolderId) : '未归档'}</span>
      {!isDraftCollection(collection) && <span className="content-state"><Folder size={12} />分类：{collection}</span>}
      {favorite && <span className="content-state favorite-state"><Heart size={12} fill="currentColor" />已收藏</span>}
      {showCloud !== false && (cloudDocument ? <span className={`content-state cloud-state status-${cloudDocument.status}`}><Cloud size={12} />{syncLabel || (cloudDocument.status === 'ready' ? '已同步到云端' : cloudFileStatus(cloudDocument.status))}</span> : <span className="content-state muted"><CloudOff size={12} />未同步到云端</span>)}
    </span>
  )
}

function DocumentTextPreview({ preview, collections, archiveFolders, onClose, onCollectionChange, onFavoriteChange, onArchive }: {
  preview: DocumentPreview
  collections: Collection[]
  archiveFolders: ArchiveFolder[]
  onClose: () => void
  onCollectionChange: (collection: string) => void
  onFavoriteChange: (favorite: boolean) => void
  onArchive: (archived: boolean) => void
}) {
  const document = preview.document
  return (
    <div className="page knowledge-reader-page document-preview">
      <header className="knowledge-detail-header">
        <button className="back-button" onClick={onClose}><ArrowLeft size={16} />知识库文件</button>
        <span className="status-badge status-ready"><i />云端解析内容</span>
      </header>
      <div className="knowledge-reader-content">
        <div className="detail-label"><span className="tag">只读内容</span><span>{formatMimeType(preview.mimeType)}</span></div>
        <h1>{preview.document.title}</h1>
        <ContentStateBadges folders={archiveFolders} archived={Boolean(document.archived)} archiveFolderId={document.archive_folder_id} collection={document.collection} favorite={document.favorite} cloudDocument={document} />
        <div className="content-state-controls">
          <label><Folder size={14} /><span>分类</span><select aria-label="云端文件分类" value={document.collection || '草稿箱'} onChange={(event) => onCollectionChange(event.target.value)}><option value="草稿箱">未分类（草稿箱）</option>{collections.map((collection) => <option key={collection.name} value={collection.name}>{collection.name}</option>)}</select></label>
          <button type="button" className={document.favorite ? 'state-command active' : 'state-command'} onClick={() => onFavoriteChange(!document.favorite)}><Heart size={14} fill={document.favorite ? 'currentColor' : 'none'} />{document.favorite ? '已收藏' : '收藏'}</button>
          <button type="button" className={document.archived ? 'state-command active' : 'state-command'} onClick={() => onArchive(!document.archived)}><Archive size={14} />{document.archived ? '移出归档' : '归档文件'}</button>
        </div>
        {preview.mimeType === 'text/markdown' ? <MarkdownBody content={preview.content} /> : <pre>{preview.content}</pre>}
      </div>
    </div>
  )
}

function KnowledgeFileEditor({ file, content, draft, mode, loading, saving, onDraftChange, onModeChange, onBack, onSave, collections, archiveFolders, cloudDocument, onCollectionChange, onFavoriteChange, onArchive }: {
  file: LocalKnowledgeFile
  content: string
  draft: string
  mode: 'preview' | 'edit'
  loading: boolean
  saving: boolean
  onDraftChange: (value: string) => void
  onModeChange: (mode: 'preview' | 'edit') => void
  onBack: () => void
  onSave: () => void
  collections: Collection[]
  archiveFolders: ArchiveFolder[]
  cloudDocument: ApiDocument | null | undefined
  onCollectionChange: (collection: string) => void
  onFavoriteChange: (favorite: boolean) => void
  onArchive: (archived: boolean) => void
}) {
  const dirty = draft !== content
  return (
    <div className="page knowledge-reader-page">
      <header className="knowledge-detail-header">
        <button className="back-button" onClick={onBack}><ArrowLeft size={16} />知识库文件</button>
        <div className="file-editor-actions">
          <div className="view-switch" aria-label="文件查看模式">
            <button className={mode === 'preview' ? 'active' : ''} onClick={() => onModeChange('preview')}><Eye size={15} />预览</button>
            <button className={mode === 'edit' ? 'active' : ''} onClick={() => onModeChange('edit')}><FilePenLine size={15} />编辑</button>
          </div>
          {mode === 'edit' && <button className="primary-action file-save-action" onClick={onSave} disabled={!dirty || saving}><Check size={16} />{saving ? '保存中…' : dirty ? '保存文件' : '已保存'}</button>}
        </div>
      </header>
      <div className="knowledge-file-heading">
        <div><p className="eyebrow">{file.relativePath}</p><h1>{file.name}</h1><p>{formatMimeType(file.mimeType)} · {formatFileSize(file.size)} · {new Date(file.updatedAt).toLocaleString('zh-CN')}</p></div>
      </div>
      <ContentStateBadges folders={archiveFolders} archived={file.archived} archiveFolderId={file.archiveFolderId} collection={file.collection} favorite={file.favorite} cloudDocument={cloudDocument} />
      <div className="content-state-controls">
        <label><Folder size={14} /><span>分类</span><select aria-label="文件分类" value={file.collection || '草稿箱'} onChange={(event) => onCollectionChange(event.target.value)}><option value="草稿箱">未分类（草稿箱）</option>{collections.map((collection) => <option key={collection.name} value={collection.name}>{collection.name}</option>)}</select></label>
        <button type="button" className={file.favorite ? 'state-command active' : 'state-command'} onClick={() => onFavoriteChange(!file.favorite)}><Heart size={14} fill={file.favorite ? 'currentColor' : 'none'} />{file.favorite ? '已收藏' : '收藏'}</button>
        <button type="button" className={file.archived ? 'state-command active' : 'state-command'} onClick={() => onArchive(!file.archived)}><Archive size={14} />{file.archived ? '移出归档' : '归档文件'}</button>
      </div>
      {loading ? (
        <div className="empty-state inline-empty"><div><FileText size={22} /></div><h2>正在读取文件</h2></div>
      ) : mode === 'edit' ? (
        <textarea
          className="knowledge-file-editor"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              if (dirty && !saving) onSave()
            }
          }}
          spellCheck={false}
          aria-label={`编辑文件：${file.name}`}
        />
      ) : (
        <div className="knowledge-reader-content local-file-content">
          {file.mimeType === 'text/markdown'
            ? <MarkdownBody content={draft} sourcePath={file.storage === 'filesystem' ? file.path : undefined} />
            : <pre>{draft}</pre>}
        </div>
      )}
    </div>
  )
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function findCloudDocument(file: LocalKnowledgeFile, documents: ApiDocument[]) {
  const normalizedPath = file.path.replaceAll('\\', '/').toLowerCase()
  const baseName = file.name.replace(/\.(?:md|markdown|txt)$/i, '').toLowerCase()
  return documents.find((document) => {
    const cloudPath = document.local_path?.replaceAll('\\', '/').toLowerCase()
    return Boolean(cloudPath && (cloudPath === normalizedPath || cloudPath.endsWith(`/${file.name.toLowerCase()}`)))
      || document.title.trim().toLowerCase() === baseName
  })
}

function cloudFileStatus(status: ApiDocument['status']) {
  if (status === 'ready') return '云端可检索'
  if (status === 'failed') return '云端处理失败'
  if (status === 'archived') return '云端已移除'
  return '云端处理中'
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: '等待处理',
    parsing: '解析中',
    indexing: '建立索引',
    ready: '可供检索',
    failed: '处理失败',
    archived: '已移除',
  }
  return labels[status] || status
}

function formatMimeType(mimeType: string) {
  if (mimeType === 'text/markdown') return 'Markdown'
  if (mimeType === 'text/plain') return 'TXT'
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType.includes('wordprocessingml')) return 'DOCX'
  return mimeType
}

function NoteRow({ note, archiveFolders, onOpen, onFavorite, onDelete }: { note: Note; archiveFolders: ArchiveFolder[]; onOpen: (note: Note) => void; onFavorite: (id: Note['id']) => void; onDelete: (note: Note) => void }) {
  return (
    <article className="note-row" onClick={() => onOpen(note)}>
      <div className="doc-icon"><FileText size={18} /></div>
      <div className="note-copy"><h3>{note.title}</h3><p>{note.summary}</p><div className="note-meta"><span>{note.collection}</span><i /> <span>{note.updated}</span><i /><span>{note.readTime} 分钟阅读</span>{note.archived && <span className="content-state note-archive-state"><Archive size={12} />{archiveFolderStatus(archiveFolders, note.archiveFolderId)}</span>}<SyncLabel note={note} /></div></div>
      <span className="tag">{note.tag}</span>
      <div className="note-row-actions">
        <button
          className={note.favorite ? 'favorite active' : 'favorite'}
          onClick={(event) => { event.stopPropagation(); onFavorite(note.id) }}
          aria-label={note.favorite ? `取消收藏：${note.title}` : `收藏：${note.title}`}
          title={note.favorite ? '取消收藏' : '收藏'}
        ><Heart size={17} fill={note.favorite ? 'currentColor' : 'none'} /></button>
        <button className="note-delete" onClick={(event) => { event.stopPropagation(); onDelete(note) }} aria-label={`删除笔记：${note.title}`} title="删除笔记"><Trash2 size={16} /></button>
      </div>
    </article>
  )
}

function SyncLabel({ note }: { note: Note }) {
  const status = note.syncStatus || (note.revision ? 'synced' : 'pending')
  const label = status === 'synced'
    ? '已同步到云端'
    : status === 'syncing'
      ? '正在同步到云端'
      : status === 'conflict'
        ? '云端同步冲突'
        : status === 'failed'
          ? '同步到云端失败'
          : '未同步到云端'
  const Icon = status === 'synced' ? Cloud : status === 'syncing' ? RefreshCw : status === 'conflict' || status === 'failed' ? AlertTriangle : CloudOff
  return (
    <span className={`content-state note-sync-state sync-${status}`} title={note.syncError || label}>
      <Icon size={12} className={status === 'syncing' ? 'spin' : ''} />{label}
    </span>
  )
}

function ArchiveFolderPicker({ folders, value, onChange, name, disabled = false, compact = false, ariaLabel = '归档目录' }: {
  folders: ArchiveFolder[]
  value: string | null
  onChange: (folderId: string | null) => void
  name?: string
  disabled?: boolean
  compact?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const options = useMemo(() => flattenArchiveFolders(folders), [folders])
  const selectedFolder = folders.find((folder) => folder.id === value) || null
  const selectedLabel = selectedFolder ? archiveFolderPath(folders, selectedFolder.id) : '归档根目录'

  useEffect(() => {
    if (!open) return
    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    })
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const chooseFolder = (folderId: string | null) => {
    onChange(folderId)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className={`archive-folder-picker ${compact ? 'compact' : ''} ${open ? 'open' : ''}`} ref={pickerRef}>
      {name && <input type="hidden" name={name} value={value || ''} />}
      <button
        ref={triggerRef}
        className="archive-folder-trigger"
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selectedLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        {selectedFolder ? <FolderOpen size={15} /> : <Archive size={15} />}
        <span>{selectedLabel}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="archive-folder-menu" ref={menuRef} role="listbox" aria-label={`${ariaLabel}列表`}>
          <button type="button" role="option" aria-selected={!value} className={!value ? 'archive-folder-option root selected' : 'archive-folder-option root'} onClick={() => chooseFolder(null)}>
            <Archive size={15} />
            <span><strong>归档根目录</strong><small>不放入下级目录</small></span>
            {!value && <Check size={15} />}
          </button>
          {options.length > 0 && <div className="archive-folder-menu-divider" />}
          {options.map(({ folder, depth }) => {
            const selected = folder.id === value
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? 'archive-folder-option selected' : 'archive-folder-option'}
                style={{ paddingLeft: `${12 + depth * 18}px` }}
                key={folder.id}
                onClick={() => chooseFolder(folder.id)}
              >
                {selected ? <FolderOpen size={15} /> : <Folder size={15} />}
                <span><strong>{folder.name}</strong>{depth > 0 && <small>{archiveFolderPath(folders, folder.id)}</small>}</span>
                {selected && <Check size={15} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AssistantPanel({ messages, prompt, thinking, configured, online, modelName, panelWidth, onPromptChange, onSubmit, onClose, onSuggestion, onOpenSource, onOpenKnowledgeSource, onOpenCloudSource, onPanelWidthChange }: { messages: Message[]; prompt: string; thinking: boolean; configured: boolean; online: boolean; modelName: string; panelWidth: number; onPromptChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onClose: () => void; onSuggestion: (value: string) => void; onOpenSource: (note: Note) => void; onOpenKnowledgeSource: (file: LocalKnowledgeFile) => void; onOpenCloudSource: (source: ModelReference) => void; onPanelWidthChange: (width: number, persist?: boolean) => void }) {
  const status = !configured ? '未配置模型' : online ? modelName : '本地上下文'
  const resizeOrigin = useRef<{ clientX: number; width: number } | null>(null)
  const resizedWidth = useRef(panelWidth)
  const [resizing, setResizing] = useState(false)
  const widthBounds = assistantWidthBounds(window.innerWidth)

  useEffect(() => () => document.body.classList.remove('assistant-resizing'), [])

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 960) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeOrigin.current = { clientX: event.clientX, width: panelWidth }
    resizedWidth.current = panelWidth
    setResizing(true)
    document.body.classList.add('assistant-resizing')
  }

  const resizePanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = resizeOrigin.current
    if (!origin) return
    const nextWidth = clampAssistantWidth(origin.width + origin.clientX - event.clientX, window.innerWidth)
    resizedWidth.current = nextWidth
    onPanelWidthChange(nextWidth)
  }

  const finishResize = () => {
    if (!resizeOrigin.current) return
    resizeOrigin.current = null
    setResizing(false)
    document.body.classList.remove('assistant-resizing')
    onPanelWidthChange(resizedWidth.current, true)
  }

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth = panelWidth
    if (event.key === 'ArrowLeft') nextWidth += 24
    else if (event.key === 'ArrowRight') nextWidth -= 24
    else if (event.key === 'Home') nextWidth = widthBounds.min
    else if (event.key === 'End') nextWidth = widthBounds.max
    else return
    event.preventDefault()
    onPanelWidthChange(nextWidth, true)
  }

  return (
    <aside className="assistant-panel">
      <div
        className={`assistant-resize-handle ${resizing ? 'resizing' : ''}`}
        role="separator"
        aria-label="调整 AI 窗口宽度"
        aria-orientation="vertical"
        aria-valuemin={widthBounds.min}
        aria-valuemax={widthBounds.max}
        aria-valuenow={panelWidth}
        tabIndex={0}
        title="左右拖动调整 AI 窗口宽度"
        onPointerDown={beginResize}
        onPointerMove={resizePanel}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
        onKeyDown={resizeWithKeyboard}
      />
      <header className="assistant-header">
        <div className="assistant-identity"><div><Sparkles size={17} /></div><span><strong>知序 AI</strong><small><i className={configured ? 'ready' : ''} /> {status}</small></span></div>
        <div className="assistant-actions"><button className="icon-button" onClick={onClose} aria-label="关闭 AI 管家"><PanelRightClose size={18} /></button></div>
      </header>
      <div className="assistant-body">
        <div className="day-divider"><span>今天</span></div>
        {!online && (
          <div className="assistant-mode-notice">
            <HardDrive size={15} />
            <p><strong>本地上下文模式</strong><span>读取本机 SQLite 笔记与配置目录中的 Markdown/TXT，不使用云端 RAG 或 MCP。</span></p>
          </div>
        )}
        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
            {message.role === 'assistant' && <div className="bot-avatar"><Sparkles size={14} /></div>}
            <div className="message-content">
              <p>{message.text}</p>
              {((message.sources?.length || 0) + (message.fileSources?.length || 0) + (message.cloudSources?.length || 0) > 0) && (
                <div className="sources">
                  <span>参考了 {(message.sources?.length || 0) + (message.fileSources?.length || 0) + (message.cloudSources?.length || 0)} 项资料</span>
                  {message.sources?.map((source) => (
                    <button key={source.id} onClick={() => onOpenSource(source)}><FileText size={13} />本机笔记 · {source.title}</button>
                  ))}
                  {message.fileSources?.map((source) => (
                    <button key={source.id} onClick={() => onOpenKnowledgeSource(source)}><BookOpen size={13} />本地文件 · {source.relativePath}</button>
                  ))}
                  {message.cloudSources?.map((source) => (
                    <button key={source.id} onClick={() => onOpenCloudSource(source)}><Cloud size={13} />云端文件 · {source.title}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {messages.length === 1 && (
          <div className="suggestions">
            <span>你可以这样问</span>
            {['总结我的知识管理方法', '我最近关注了什么？', '给我一份本周行动建议'].map((text) => (
              <button key={text} onClick={() => onSuggestion(text)}>{text}<ArrowUp size={14} /></button>
            ))}
          </div>
        )}
        {thinking && <div className="thinking"><i /><i /><i /></div>}
      </div>
      <form className="assistant-input" onSubmit={onSubmit}>
        <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="问问你的知识库…" rows={2} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
        <div><button type="button" aria-label="选择知识范围"><Folder size={15} />{online ? '全部知识' : '本地知识'} <ChevronDown size={13} /></button><button className="send-button" type="submit" disabled={!prompt.trim() || thinking} aria-label="发送"><ArrowUp size={17} /></button></div>
      </form>
      <p className="assistant-footnote">{!configured ? '请先在设置中配置模型服务' : online ? '回答由已配置模型生成，请核对来源' : '本机资料片段会发送到已配置模型；不使用云端 RAG/MCP'}</p>
    </aside>
  )
}

function NoteEditor({ note, online, saving, collections, archiveFolders, appearance, defaultCollection, formRef, onBack, onCancel, onDelete, onSubmit }: { note: Note | null; online: boolean; saving: boolean; collections: Collection[]; archiveFolders: ArchiveFolder[]; appearance: ResolvedAppearance; defaultCollection: string; formRef: RefObject<HTMLFormElement | null>; onBack: () => void; onCancel: () => void; onDelete: (note: Note) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const selectedCollection = note?.collection || defaultCollection
  const [content, setContent] = useState(note?.content || '')
  const [archived, setArchived] = useState(Boolean(note?.archived))
  const [archiveFolderId, setArchiveFolderId] = useState<string | null>(note?.archiveFolderId || null)
  return (
    <form ref={formRef} className="page note-editor-page" onSubmit={onSubmit}>
      <div className="note-editor-toolbar">
        <button type="button" className="editor-back" onClick={onBack}><ArrowLeft size={16} />返回</button>
        <span className={`status-badge ${online ? 'status-ready' : ''}`}><i />{online ? '本机保存后同步' : '本地离线'}</span>
      </div>
      <div className="note-editor-heading">
        <p className="eyebrow">{note ? '继续整理' : '记录想法'}</p>
        <h1>{note ? '编辑笔记' : '新建笔记'}</h1>
      </div>
      <div className="note-editor-fields">
        <label className="note-title-field"><span>标题</span><input name="title" className="title-input" placeholder="输入标题" defaultValue={note?.title} autoFocus required /></label>
        <div className="note-content-field">
          <div className="note-content-heading">
            <span>正文</span>
            <span className="note-markdown-indicator">Markdown · 实时渲染</span>
          </div>
          <Suspense fallback={<div className="note-markdown-loading">正在打开编辑器…</div>}>
            <MarkdownEditor key={`note-markdown-editor-${note?.id ?? 'new'}-${appearance}`} markdown={content} theme={appearance} onChange={setContent} />
          </Suspense>
        </div>
      </div>
      <footer className="note-editor-footer">
        <label className="collection-field">
          <span>分类</span>
          <div className="collection-select">
            <Folder size={15} />
            <select name="collection" aria-label="笔记分类" defaultValue={selectedCollection === '收件箱' ? '草稿箱' : selectedCollection}>
              <option>草稿箱</option>
              {!collections.some((item) => item.name === selectedCollection) && selectedCollection !== '草稿箱' && selectedCollection !== '收件箱' && <option>{selectedCollection}</option>}
              {collections.map((item) => <option key={item.name}>{item.name}</option>)}
            </select>
            <ChevronDown size={15} />
          </div>
        </label>
        <div className="note-archive-fields">
          <label className="note-archive-toggle"><input name="archived" type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /><Archive size={15} /><span>归档笔记</span></label>
          <div className="archive-folder-field"><span>归档目录</span><ArchiveFolderPicker key={archived ? 'archive-picker-enabled' : 'archive-picker-disabled'} folders={archiveFolders} value={archiveFolderId} onChange={setArchiveFolderId} name="archiveFolderId" disabled={!archived} compact /></div>
        </div>
        <div className="note-editor-actions">{note && <button type="button" className="danger-button" onClick={() => onDelete(note)} disabled={saving}><Trash2 size={15} />删除</button>}<button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>取消</button><button type="submit" className="primary-action" disabled={saving}><Check size={16} />{saving ? '保存中…' : '保存笔记'}</button></div>
      </footer>
    </form>
  )
}

function ProfilePage({ profile, online, saving, onSubmit }: { profile: UserProfile; online: boolean; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="page profile-page">
      <div className="notes-header">
        <div><p className="eyebrow">账户与空间</p><h1>个人资料</h1><p>{online ? '修改后同步云端账户与当前知识空间' : '当前资料只保存在这台设备'}</p></div>
      </div>
      <div className="profile-overview">
        <div className="profile-page-avatar">{profile.displayName.slice(0, 1)}</div>
        <div><strong>{profile.displayName}</strong><span>@{profile.username} · {profile.spaceName}</span></div>
        <span className={`status-badge ${online ? 'status-ready' : ''}`}><i />{online ? '已连接云端' : '本地离线'}</span>
      </div>
      <form className="profile-page-form" key={`${profile.username}:${profile.displayName}:${profile.bio}:${profile.spaceName}`} onSubmit={onSubmit} noValidate>
        <div className="profile-form">
          <label><span>用户名</span><input name="username" defaultValue={profile.username} maxLength={30} required disabled={online} /></label>
          <label><span>显示名称</span><input name="displayName" defaultValue={profile.displayName} maxLength={30} required /></label>
          <label><span>知识空间名称</span><input name="spaceName" defaultValue={profile.spaceName} maxLength={40} required /></label>
          <label className="profile-bio"><span>个人签名</span><textarea name="bio" defaultValue={profile.bio} maxLength={120} rows={5} /></label>
        </div>
        <footer><button type="submit" className="primary-action" disabled={saving}><Check size={16} />{saving ? '保存中…' : '保存资料'}</button></footer>
      </form>
    </div>
  )
}

function ReleaseNotes({ appVersion, onClose }: { appVersion: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="release-modal" role="dialog" aria-modal="true" aria-labelledby="release-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span id="release-title">版本更新</span><small>知序桌面端更新内容</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="release-body">
          <div className="release-version"><span>当前版本</span><strong>v{appVersion}</strong><time dateTime={releaseDate}>{releaseDate}</time></div>
          <div className="release-list">
            {releaseHighlights.map((item) => <div key={item.title}><Check size={16} /><p><strong>{item.title}</strong><span>{item.detail}</span></p></div>)}
          </div>
        </div>
        <footer><button type="button" className="primary-action" onClick={onClose}>知道了</button></footer>
      </section>
    </div>
  )
}

function SettingsEditor({ settings, appVersion, testingModel, online, displayName, cloudAccount, cloudSpace, onChange, onSelectDirectory, onTestModel, onOpenProfile, onOpenReleaseNotes, onClose, onSubmit }: { settings: AppSettings; appVersion: string; testingModel: boolean; online: boolean; displayName: string; cloudAccount: string; cloudSpace: string; onChange: (settings: AppSettings) => void; onSelectDirectory: () => void; onTestModel: () => void; onOpenProfile: () => void; onOpenReleaseNotes: () => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [activeTab, setActiveTab] = useState<'account' | 'general' | 'ai' | 'notifications' | 'about'>('account')
  const tabs = [
    { id: 'account', label: '账号', detail: '账户与知识空间', Icon: User },
    { id: 'general', label: '通用', detail: '外观、文件与同步', Icon: Settings },
    { id: 'ai', label: 'AI 模型', detail: '模型服务参数', Icon: Sparkles },
    { id: 'notifications', label: '通知', detail: '提醒方式', Icon: Bell },
    { id: 'about', label: '关于', detail: '版本与信息', Icon: Info },
  ] as const
  const appearances = [
    { id: 'system', label: '跟随系统', Icon: Monitor },
    { id: 'light', label: '浅色', Icon: Sun },
    { id: 'dark', label: '深色', Icon: Moon },
  ] as const
  const active = tabs.find((tab) => tab.id === activeTab) || tabs[0]
  const hasEditableSettings = activeTab === 'general' || activeTab === 'ai' || activeTab === 'notifications'

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="settings-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>设置</span><small>管理知序在当前设备上的偏好</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="settings-workspace">
          <nav className="settings-tabs" role="tablist" aria-label="设置分类" aria-orientation="vertical">
            {tabs.map(({ id, label, Icon }) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} aria-controls={`settings-panel-${id}`} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}><Icon size={16} /><span>{label}</span></button>)}
          </nav>
          <section className="settings-content">
            <div className="settings-page-heading"><h2>{active.label}</h2><p>{active.detail}</p></div>
            <div className="settings-form" id={`settings-panel-${activeTab}`} role="tabpanel">
              {activeTab === 'account' && <>
                <section className="account-settings-summary">
                  <div className="account-settings-avatar">{online ? <Cloud size={22} /> : <CloudOff size={22} />}</div>
                  <div><strong>{displayName || cloudAccount || '本地用户'}</strong><span>{online ? '知序云端账户' : '当前使用本地离线模式'}</span></div>
                  <b className={`status-badge ${online ? 'status-ready' : ''}`}><i />{online ? '已连接' : '未登录'}</b>
                </section>
                <section className="account-setting-rows">
                  <div><span>账号</span><strong>{cloudAccount || '未登录'}</strong></div>
                  <div><span>当前知识空间</span><strong>{cloudSpace || '未选择'}</strong></div>
                  <div><span>数据模式</span><strong>{online ? '本机优先并同步云端' : '仅保存在当前设备'}</strong></div>
                </section>
                <button className="settings-command" type="button" onClick={onOpenProfile}><User size={15} />编辑个人资料</button>
              </>}

              {activeTab === 'general' && <>
                <section className="appearance-setting">
                  <div className="setting-title"><Monitor size={17} /><span><strong>外观</strong><small>界面颜色会立即应用到整个应用。</small></span></div>
                  <div className="appearance-options" role="radiogroup" aria-label="外观模式">
                    {appearances.map(({ id, label, Icon }) => <button key={id} type="button" role="radio" aria-checked={settings.appearance === id} className={settings.appearance === id ? 'active' : ''} onClick={() => onChange({ ...settings, appearance: id })}><Icon size={15} /><span>{label}</span>{settings.appearance === id && <Check size={13} />}</button>)}
                  </div>
                </section>
                <section>
                  <div className="setting-title"><HardDrive size={17} /><span><strong>知识库文件目录</strong><small>Markdown 和 TXT 文件会保存到这里，并在打开知识库文件时扫描。</small></span></div>
                  <div className="path-picker"><input aria-label="知识库文件目录" value={settings.sourceDirectory} onChange={(event) => onChange({ ...settings, sourceDirectory: event.target.value })} placeholder="knowledge-files" /><button type="button" onClick={onSelectDirectory}><Folder size={15} />选择目录</button></div>
                </section>
                <label className="toggle-row"><span><strong>保存知识文件后上传云端</strong><small>登录且存在知识空间时，上传一份用于解析和检索；本机文件始终保留。</small></span><input type="checkbox" aria-label="保存知识文件后上传云端" checked={settings.uploadAfterImport} onChange={(event) => onChange({ ...settings, uploadAfterImport: event.target.checked })} /></label>
                <div className="storage-model"><Database size={17} /><p><strong>本地优先</strong><span>笔记、待办、资料和设置先保存在本机；离线变更会等待下次连接后同步。</span></p></div>
              </>}

              {activeTab === 'ai' && <>
                <section className="model-settings">
                  <div className="setting-title"><Server size={17} /><span><strong>OpenAI 兼容服务</strong><small>模型 URL、Key 和参数只保存在当前设备，不会写入云端数据库。</small></span></div>
                  <div className="model-fields">
                    <label><span>服务 URL</span><input type="url" value={settings.aiBaseUrl} onChange={(event) => onChange({ ...settings, aiBaseUrl: event.target.value })} placeholder="https://api.openai.com/v1" /></label>
                    <label><span>API Key</span><div className="secret-field"><KeyRound size={15} /><input type="password" value={settings.aiApiKey} onChange={(event) => onChange({ ...settings, aiApiKey: event.target.value })} placeholder="本地模型可留空" autoComplete="off" /></div></label>
                    <label><span>模型</span><input value={settings.aiModel} onChange={(event) => onChange({ ...settings, aiModel: event.target.value })} placeholder="gpt-4o-mini" /></label>
                    <div className="model-number-row">
                      <label><span>温度</span><input type="number" min="0" max="2" step="0.1" value={settings.aiTemperature} onChange={(event) => onChange({ ...settings, aiTemperature: Number(event.target.value) })} /></label>
                      <label><span>最大输出</span><input type="number" min="64" max="8192" step="1" value={settings.aiMaxTokens} onChange={(event) => onChange({ ...settings, aiMaxTokens: Number(event.target.value) })} /></label>
                    </div>
                  </div>
                  <button className="model-test" type="button" onClick={onTestModel} disabled={testingModel}><Sparkles size={15} />{testingModel ? '正在测试…' : '测试连接'}</button>
                </section>
              </>}

              {activeTab === 'notifications' && <>
                <label className="toggle-row notification-setting"><span><strong>版本更新提醒</strong><small>有尚未查看的版本说明时，在顶部显示通知入口。</small></span><input type="checkbox" aria-label="版本更新提醒" checked={settings.notificationsEnabled} onChange={(event) => onChange({ ...settings, notificationsEnabled: event.target.checked })} /></label>
                <div className="storage-model"><Bell size={17} /><p><strong>应用内通知</strong><span>提醒只显示在知序界面中，不会调用 Windows 系统通知。</span></p></div>
              </>}

              {activeTab === 'about' && <>
                <section className="about-settings">
                  <div className="about-brand-mark"><BookOpen size={24} /></div>
                  <div><strong>知序</strong><span>个人知识库与 AI 管家</span></div>
                </section>
                <section className="account-setting-rows about-rows">
                  <div><span>当前版本</span><strong>v{appVersion}</strong></div>
                  <div><span>发布日期</span><strong>{releaseDate}</strong></div>
                  <div><span>数据原则</span><strong>本地优先，云端可选</strong></div>
                </section>
                <button className="settings-command" type="button" onClick={onOpenReleaseNotes}><Bell size={15} />查看版本更新</button>
              </>}
            </div>
          </section>
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>关闭</button>{hasEditableSettings && <button type="submit" className="primary-action"><Check size={16} />保存设置</button>}</footer>
      </form>
    </div>
  )
}

function ArchiveTargetEditor({ target, folders, onClose, onSubmit }: { target: ArchiveTarget; folders: ArchiveFolder[]; onClose: () => void; onSubmit: (folderId: string | null) => void }) {
  const currentFolderId = target.kind === 'note'
    ? target.item.archiveFolderId
    : target.kind === 'local-file'
      ? target.item.archiveFolderId
      : target.item.archive_folder_id
  const title = target.kind === 'note' ? target.item.title : target.kind === 'local-file' ? target.item.name : target.item.title
  const [folderId, setFolderId] = useState<string | null>(currentFolderId || null)
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="name-modal archive-target-modal" onSubmit={(event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get('folderId') || ''); onSubmit(value || null) }} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>选择归档目录</span><small>{title}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="name-form"><div className="archive-target-field"><span>归档至</span><ArchiveFolderPicker folders={folders} value={folderId} onChange={setFolderId} name="folderId" ariaLabel="归档至" /></div></div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-action"><Archive size={16} />确认归档</button></footer>
      </form>
    </div>
  )
}

function EditorNavigationPrompt({ destination, saving, onContinue, onDiscard, onSave }: { destination: string; saving: boolean; onContinue: () => void; onDiscard: () => void; onSave: () => void }) {
  return (
    <div className="modal-backdrop editor-navigation-backdrop" onMouseDown={onContinue}>
      <section className="name-modal editor-navigation-modal" role="alertdialog" aria-modal="true" aria-labelledby="editor-navigation-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span id="editor-navigation-title">笔记尚未保存</span><small>保存后再前往“{destination}”？</small></div>
          <button type="button" className="icon-button" onClick={onContinue} aria-label="关闭提示"><X size={18} /></button>
        </header>
        <div className="editor-navigation-body"><FilePenLine size={20} /><p>当前标题和正文仍在编辑中。</p></div>
        <footer>
          <button type="button" className="secondary-button" onClick={onContinue} disabled={saving}>继续编辑</button>
          <button type="button" className="discard-button" onClick={onDiscard} disabled={saving}>不保存</button>
          <button type="button" className="primary-action" onClick={onSave} disabled={saving}><Check size={16} />{saving ? '保存中…' : '保存并前往'}</button>
        </footer>
      </section>
    </div>
  )
}

function NameEditor({ title, description, placeholder, submitLabel, onClose, onSubmit }: { title: string; description: string; placeholder: string; submitLabel: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="name-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{title}</span><small>{description}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="name-form"><label><span>名称</span><input name="name" placeholder={placeholder} maxLength={80} required autoFocus /></label></div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-action"><Plus size={16} />{submitLabel}</button></footer>
      </form>
    </div>
  )
}

function TodoEditor({ todo, onClose, onSubmit }: { todo: TodoItem | null; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="name-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{todo ? '编辑今日待办' : '新建今日待办'}</span><small>先保存到本机，再同步到当前知识空间</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="name-form"><label><span>待办内容</span><input name="text" defaultValue={todo?.text} placeholder="输入今天要完成的事项" maxLength={500} required autoFocus /></label></div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-action">{todo ? <Check size={16} /> : <Plus size={16} />}{todo ? '保存修改' : '添加待办'}</button></footer>
      </form>
    </div>
  )
}

function CollectionEditor({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const colors = ['#407a62', '#4f6fa8', '#b06c42', '#8b6a9e', '#9c5547', '#6f776f']
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="name-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>新建分类</span><small>分类用于整理同一知识空间内的笔记</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="name-form">
          <label><span>分类名称</span><input name="name" placeholder="例如：项目备忘" maxLength={40} required autoFocus /></label>
          <fieldset><legend>标识颜色</legend><div className="color-swatches">{colors.map((color, index) => <label key={color} className="color-swatch" title={color}><input type="radio" name="color" value={color} defaultChecked={index === 0} /><span style={{ backgroundColor: color }} /></label>)}</div></fieldset>
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-action"><Plus size={16} />创建分类</button></footer>
      </form>
    </div>
  )
}

function ArchiveFolderEditor({ parent, onClose, onSubmit }: { parent: ArchiveFolder | null; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="name-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>新建归档目录</span><small>{parent ? `创建在“${parent.name}”下` : '创建在归档根目录'}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="name-form"><label><span>目录名称</span><input name="name" placeholder="例如：已完成项目" maxLength={80} pattern="[^/\\]+" required autoFocus /></label></div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-action"><FolderPlus size={16} />创建目录</button></footer>
      </form>
    </div>
  )
}

function NoteDetail({ note, archiveFolders, onClose, onFavorite, onEdit, onDelete, onArchive, onResolve }: { note: Note; archiveFolders: ArchiveFolder[]; onClose: () => void; onFavorite: () => void; onEdit: () => void; onDelete: () => void; onArchive: (archived: boolean) => void; onResolve: () => void }) {
  return (
    <article className="page note-detail">
      <header className="note-detail-toolbar">
        <button className="editor-back" onClick={onClose}><ArrowLeft size={16} />返回笔记列表</button>
        <div className="detail-actions">{note.syncStatus === 'conflict' && <button className="icon-button conflict-action" onClick={onResolve} aria-label="解决同步冲突" title="解决同步冲突"><AlertTriangle size={18} /></button>}<button className="icon-button" onClick={onFavorite} aria-label="收藏"><Heart size={18} fill={note.favorite ? 'currentColor' : 'none'} /></button><button className={`icon-button ${note.archived ? 'active' : ''}`} onClick={() => onArchive(!note.archived)} aria-label={note.archived ? '移出归档' : '归档笔记'} title={note.archived ? '移出归档' : '归档笔记'}><Archive size={18} /></button><button className="icon-button" onClick={onEdit} aria-label="编辑"><PenLine size={18} /></button><button className="icon-button delete-detail" onClick={onDelete} aria-label={`删除笔记：${note.title}`} title="删除笔记"><Trash2 size={18} /></button></div>
      </header>
      <div className="detail-content"><div className="detail-label"><span className="tag">{note.tag}</span><ContentStateBadges folders={archiveFolders} archived={Boolean(note.archived)} archiveFolderId={note.archiveFolderId} collection={note.collection} favorite={note.favorite} showCloud={false} /><SyncLabel note={note} /></div><h1>{note.title}</h1><div className="detail-meta"><Clock3 size={15} />{note.updated}<i />预计阅读 {note.readTime} 分钟</div><p className="detail-lead">{note.summary}</p><MarkdownBody content={note.content} /></div>
    </article>
  )
}

function MarkdownBody({ content, sourcePath }: { content: string; sourcePath?: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={sourcePath ? {
          img: ({ src, ...props }) => <img {...props} src={resolveMarkdownAsset(sourcePath, src)} />,
        } : undefined}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function resolveMarkdownAsset(sourcePath: string, source?: string) {
  if (!source || !isTauri() || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) return source
  const pathParts = sourcePath.replaceAll('\\', '/').split('/')
  pathParts.pop()
  for (const part of source.split(/[\\/]/)) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (pathParts.length > 1) pathParts.pop()
      continue
    }
    try {
      pathParts.push(decodeURIComponent(part))
    } catch {
      pathParts.push(part)
    }
  }
  return convertFileSrc(pathParts.join('/'))
}

function ConflictResolver({ note, resolving, onClose, onUseLocal, onUseCloud }: { note: Note; resolving: boolean; onClose: () => void; onUseLocal: () => void; onUseCloud: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="conflict-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header><div className="conflict-heading"><AlertTriangle size={18} /><span><strong>解决同步冲突</strong><small>{note.title}</small></span></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="conflict-body">
          <p>这条笔记在本机和云端都被修改过。请选择保留哪个版本，另一版本将被替换。</p>
          {note.syncError && <div className="conflict-error">{note.syncError}</div>}
        </div>
        <footer>
          <button className="secondary-button" onClick={onUseCloud} disabled={resolving}><Cloud size={16} />采用云端版本</button>
          <button className="primary-action" onClick={onUseLocal} disabled={resolving}><HardDrive size={16} />{resolving ? '处理中…' : '保留本机版本'}</button>
        </footer>
      </section>
    </div>
  )
}

function assistantWidthBounds(viewportWidth: number) {
  if (viewportWidth <= 960) return { min: assistantMinWidth, max: assistantMaxWidth }
  const sidebarWidth = viewportWidth <= 1080 ? 210 : 236
  const mainContentWidth = viewportWidth <= 1080 ? 430 : 480
  return {
    min: assistantMinWidth,
    max: Math.max(assistantMinWidth, Math.min(assistantMaxWidth, viewportWidth - sidebarWidth - mainContentWidth)),
  }
}

function clampAssistantWidth(width: number, viewportWidth: number) {
  const bounds = assistantWidthBounds(viewportWidth)
  const value = Number.isFinite(width) ? width : assistantDefaultWidth
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)))
}

function readAssistantWidth() {
  const saved = Number(window.localStorage.getItem(assistantWidthStorageKey))
  return clampAssistantWidth(saved > 0 ? saved : assistantDefaultWidth, window.innerWidth)
}

function formatToday() {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
}

function pickDailyReview(notes: Note[]) {
  const reviewable = notes.filter((note) => note.summary || note.content)
  if (!reviewable.length) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return reviewable[Math.floor(today.getTime() / 86_400_000) % reviewable.length]
}

function formatLocalDayKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sortTodoItems(todos: TodoItem[]) {
  return [...todos].sort((left, right) => Number(left.completed) - Number(right.completed) || left.createdAt.localeCompare(right.createdAt))
}

function mergeCollections(current: Collection[], notes: Note[]) {
  const palette = ['#407a62', '#4f6fa8', '#b06c42', '#8b6a9e', '#9c5547', '#6f776f']
  const result = [...current]
  const names = new Set(result.map((item) => item.name))
  for (const note of notes) {
    const name = note.collection?.trim()
    if (!name || name === '草稿箱' || name === '收件箱' || names.has(name)) continue
    result.push({ name, color: palette[result.length % palette.length] })
    names.add(name)
  }
  return result
}

function rankNoteSources(question: string, notes: Note[], useFallback = true) {
  const normalized = question.toLowerCase().replace(/\s+/g, '')
  const terms = new Set(question.toLowerCase().split(/\s+/).filter(Boolean))
  for (let index = 0; index < normalized.length - 1; index += 1) terms.add(normalized.slice(index, index + 2))
  const ranked = notes.map((note) => {
    const text = `${note.title}${note.summary}${note.content}${note.tag}`.toLowerCase()
    const score = [...terms].reduce((total, term) => total + (term.length > 1 && text.includes(term) ? 1 : 0), 0)
    return { note, score }
  }).sort((left, right) => right.score - left.score)
  const matched = ranked.filter((item) => item.score > 0).slice(0, 4).map((item) => item.note)
  if (matched.length || !useFallback) return matched
  return notes.filter((note) => note.pinned).concat(notes).filter((note, index, all) => all.findIndex((item) => item.id === note.id) === index).slice(0, 3)
}

async function buildLocalModelContext(question: string, notes: Note[], directory: string) {
  const noteSources = rankNoteSources(question, notes).slice(0, 4)
  const allFiles = await listKnowledgeFiles(directory)
  const fileCandidates = allFiles
    .map((file) => ({ file, score: localTextScore(question, file.relativePath) }))
    .sort((left, right) => right.score - left.score || right.file.updatedAt.localeCompare(left.file.updatedAt))
    .slice(0, 60)
  const readableFiles = (await Promise.all(fileCandidates.map(async ({ file }) => {
    try {
      return { file, content: await readKnowledgeFile(file) }
    } catch (error) {
      console.error(`读取本地知识文件失败：${file.path}`, error)
      return null
    }
  }))).filter((item): item is { file: LocalKnowledgeFile; content: string } => Boolean(item))
  const rankedFiles = readableFiles
    .map((item) => ({ ...item, score: localTextScore(question, `${item.file.relativePath}\n${item.content}`) }))
    .sort((left, right) => right.score - left.score || right.file.updatedAt.localeCompare(left.file.updatedAt))
  const matchedFiles = rankedFiles.filter((item) => item.score > 0).slice(0, 4)
  const selectedFiles = matchedFiles.length ? matchedFiles : rankedFiles.slice(0, 2)

  const sections: string[] = []
  const includedNotes: Note[] = []
  const includedFiles: LocalKnowledgeFile[] = []
  let usedCharacters = 0
  const append = (heading: string, content: string) => {
    const separatorLength = sections.length ? 7 : 0
    const remaining = 18_000 - usedCharacters - separatorLength
    if (remaining < 160) return false
    const section = `${heading}\n${content.trim() || '（空内容）'}`.slice(0, Math.min(3_400, remaining))
    sections.push(section)
    usedCharacters += section.length + separatorLength
    return true
  }

  for (const note of noteSources) {
    if (append(`[本机 SQLite 笔记]《${note.title}》`, note.content || note.summary)) includedNotes.push(note)
  }
  for (const item of selectedFiles) {
    if (append(`[本机知识文件]《${item.file.relativePath}》`, item.content)) includedFiles.push(item.file)
  }

  return {
    context: sections.join('\n\n---\n\n'),
    noteSources: includedNotes,
    fileSources: includedFiles,
    allFiles,
  }
}

function localTextScore(question: string, content: string) {
  const normalizedQuestion = question.toLowerCase().replace(/\s+/g, '')
  const terms = new Set(question.toLowerCase().split(/\s+/).filter((term) => term.length > 1))
  for (let index = 0; index < normalizedQuestion.length - 1; index += 1) terms.add(normalizedQuestion.slice(index, index + 2))
  const normalizedContent = content.toLowerCase()
  return [...terms].reduce((total, term) => total + (normalizedContent.includes(term) ? 1 : 0), 0)
}

function modelSettings(settings: AppSettings) {
  return {
    baseUrl: settings.aiBaseUrl.trim(),
    apiKey: settings.aiApiKey.trim(),
    model: settings.aiModel.trim(),
    temperature: settings.aiTemperature,
    maxTokens: settings.aiMaxTokens,
  }
}

export default App
