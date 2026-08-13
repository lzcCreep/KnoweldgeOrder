import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArrowUp,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Database,
  Eye,
  ExternalLink,
  FileText,
  Folder,
  HardDrive,
  Heart,
  Home,
  Inbox,
  Lightbulb,
  Menu,
  MoreHorizontal,
  PanelRightClose,
  PenLine,
  Pin,
  Plus,
  Search,
  Settings,
  Sparkles,
  LogOut,
  LockKeyhole,
  Upload,
  User,
  Trash2,
  X,
} from 'lucide-react'
import { collections, type Note } from './data'
import { createNote as createCloudNote, deleteDocument, getDocumentContent, listDocuments, listNotes, login, logout, updateNote, uploadDocument, type ApiDocument, type ApiNote, type AuthSession } from './api'
import { defaultProfile, defaultSettings, exportMarkdown, loadDocumentSources, loadProfile, loadSettings, openSourceFile, persistProfile, persistSettings, preserveSourceFile, saveDocumentSource, selectKnowledgeDocument, selectSourceDirectory, type AppSettings, type UserProfile } from './storage'

type View = '首页' | '全部笔记' | '知识文件' | '收件箱' | '收藏' | '归档'
type Message = { role: 'assistant' | 'user'; text: string; sources?: Note[] }
type DocumentPreview = { document: ApiDocument; content: string; mimeType: string }

const starterMessages: Message[] = [
  {
    role: 'assistant',
    text: '早上好。我已经整理了你的知识库。你可以让我查找信息、总结主题，或者把零散想法整理成行动。',
  },
]

const fromApiNote = (note: ApiNote): Note => ({
  id: note.id,
  title: note.title,
  summary: note.content.slice(0, 72) || '暂无摘要。',
  content: note.content || '暂无正文。',
  tag: '云端笔记',
  collection: '个人空间',
  updated: new Date(note.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  readTime: Math.max(1, Math.ceil(note.content.length / 300)),
  favorite: note.favorite,
  revision: note.revision,
  createdAt: note.created_at,
})

function App() {
  const [session, setSession] = useState<AuthSession | null>(null)

  return session ? (
    <KnowledgeBaseApp session={session} onLogout={() => setSession(null)} />
  ) : (
    <LoginScreen onLogin={setSession} />
  )
}

function LoginScreen({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const username = String(form.get('username') || '')
    const password = String(form.get('password') || '')

    setSubmitting(true)
    try {
      const session = await login(username, password)
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
        <h1>登录知识空间</h1>
        <p className="login-subtitle">访问你的本地笔记、文档与知识问答。</p>
        <form onSubmit={handleLogin}>
          <label>
            <span>用户名</span>
            <div className="login-field"><User size={17} /><input name="username" autoComplete="username" required autoFocus /></div>
          </label>
          <label>
            <span>密码</span>
            <div className="login-field"><LockKeyhole size={17} /><input name="password" type="password" autoComplete="current-password" required /></div>
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? '正在连接…' : '登录'}</button>
        </form>
        <p className="login-footnote">通过本机 Spring Boot 服务验证账号并访问 PostgreSQL。</p>
      </section>
    </main>
  )
}

function KnowledgeBaseApp({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [apiNotes, setApiNotes] = useState<Map<string, ApiNote>>(new Map())
  const [view, setView] = useState<View>('首页')
  const [activeCollection, setActiveCollection] = useState('全部')
  const [query, setQuery] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [messages, setMessages] = useState<Message[]>(starterMessages)
  const [prompt, setPrompt] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [notice, setNotice] = useState('')
  const [profile, setProfile] = useState<UserProfile>(defaultProfile)
  const [profileOpen, setProfileOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [documents, setDocuments] = useState<ApiDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(true)
  const [documentSources, setDocumentSources] = useState<Record<string, string>>({})
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null)

  const refreshDocuments = useCallback(async () => {
    setDocumentsLoading(true)
    try {
      const result = await listDocuments(session)
      setDocuments(result.items)
    } catch (error) {
      console.error('加载知识文件失败', error)
    } finally {
      setDocumentsLoading(false)
    }
  }, [session])

  useEffect(() => {
    void listNotes(session)
      .then(({ items }) => {
        setApiNotes(new Map(items.map((note) => [note.id, note])))
        setNotes(items.map(fromApiNote))
      })
      .catch((error) => window.alert(`加载云端笔记失败：${error instanceof Error ? error.message : '未知错误'}`))
    void loadProfile().then(setProfile).catch((error) => console.error('加载个人资料失败', error))
    void loadSettings().then(setSettings).catch((error) => console.error('加载应用设置失败', error))
    void loadDocumentSources().then(setDocumentSources).catch((error) => console.error('加载源文件映射失败', error))
    void listDocuments(session)
      .then((result) => setDocuments(result.items))
      .catch((error) => console.error('加载知识文件失败', error))
      .finally(() => setDocumentsLoading(false))
  }, [session])

  const filteredNotes = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return notes.filter((note) => {
      const matchesView =
        view === '收藏' ? note.favorite : view === '归档' ? false : true
      const matchesCollection =
        activeCollection === '全部' || note.collection === activeCollection
      const matchesQuery =
        !normalized ||
        `${note.title}${note.summary}${note.content}${note.tag}`
          .toLowerCase()
          .includes(normalized)
      return matchesView && matchesCollection && matchesQuery
    })
  }, [activeCollection, notes, query, view])

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2400)
  }

  const handleImportDocument = async () => {
    try {
      const selected = await selectKnowledgeDocument()
      if (!selected) return
      let localPath = selected.sourcePath
      if (settings.keepSourceCopy && settings.sourceDirectory) {
        localPath = await preserveSourceFile(selected, settings.sourceDirectory) || selected.sourcePath
      }
      if (!selected.supportedForIndexing) {
        window.alert(`${selected.fileName} 已选取${settings.sourceDirectory ? '并保留源文件副本' : ''}，但后端目前只支持 Markdown/TXT。PDF、DOCX、HTML、EPUB、CSV 解析器尚未接入。`)
        return
      }
      if (!settings.uploadAfterImport) {
        showNotice('源文件已保留，未上传到云端知识库')
        return
      }
      const result = await uploadDocument(session, selected.fileName, selected.bytes, selected.mimeType)
      await saveDocumentSource(result.document.id, selected.fileName, localPath)
      setDocumentSources((current) => ({ ...current, [result.document.id]: localPath }))
      showNotice(`文档已上传，索引任务：${statusLabel(result.job.status)}`)
      setView('知识文件')
      await refreshDocuments()
    } catch (error) {
      console.error('导入文档失败', error)
      window.alert(`导入失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleOpenSource = async (document: ApiDocument) => {
    const path = documentSources[document.id]
    if (!path) return
    try {
      await openSourceFile(path)
    } catch (error) {
      window.alert(`无法打开源文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handlePreviewDocument = async (document: ApiDocument) => {
    try {
      const result = await getDocumentContent(session, document.id)
      setDocumentPreview({ document, content: result.content, mimeType: result.mime_type })
    } catch (error) {
      window.alert(`无法读取提取文本：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleDeleteDocument = async (document: ApiDocument) => {
    if (!window.confirm(`删除“${document.title}”的云端记录？后端接通向量索引后，此操作也必须清理对应向量。`)) return
    try {
      await deleteDocument(session, document.id)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
      showNotice('知识文件记录已删除')
    } catch (error) {
      window.alert(`删除失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleExportMarkdown = async () => {
    try {
      await exportMarkdown(notes)
    } catch (error) {
      console.error('导出 Markdown 失败', error)
      window.alert('导出失败，请重新选择保存位置。')
    }
  }

  const toggleFavorite = (id: Note['id']) => {
    const cloudNote = apiNotes.get(String(id))
    if (!cloudNote) return
    void updateNote(session, cloudNote, { favorite: !cloudNote.favorite })
      .then((updated) => {
        setApiNotes((current) => new Map(current).set(updated.id, updated))
        setNotes((current) => current.map((note) => note.id === id ? fromApiNote(updated) : note))
        setSelectedNote((current) => current?.id === id ? fromApiNote(updated) : current)
      })
      .catch((error) => window.alert(`收藏状态保存失败：${error instanceof Error ? error.message : '未知错误'}`))
  }

  const handleCreateNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') || '').trim()
    const content = String(form.get('content') || '').trim()
    if (!title) return
    void createCloudNote(session, title, content)
      .then((created) => {
        setApiNotes((current) => new Map(current).set(created.id, created))
        setNotes((current) => [fromApiNote(created), ...current])
        showNotice('笔记已保存到 PostgreSQL')
        setEditorOpen(false)
      })
      .catch((error) => {
        console.error('保存笔记失败', error)
        window.alert('保存失败，请重试。')
      })
  }

  const handleSaveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const nextProfile: UserProfile = {
      username: profile.username,
      displayName: String(form.get('displayName') || '').trim(),
      bio: String(form.get('bio') || '').trim(),
      spaceName: String(form.get('spaceName') || '').trim(),
    }
    if (!nextProfile.displayName || !nextProfile.spaceName) return
    void persistProfile(nextProfile)
      .then(() => {
        setProfile(nextProfile)
        setProfileOpen(false)
        showNotice('个人资料已保存')
      })
      .catch((error) => {
        console.error('保存个人资料失败', error)
        window.alert('个人资料保存失败，请重试。')
      })
  }

  const handleSaveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void persistSettings(settings)
      .then(() => {
        setSettingsOpen(false)
        showNotice('文件与同步设置已保存')
      })
      .catch((error) => window.alert(`设置保存失败：${error instanceof Error ? error.message : '未知错误'}`))
  }

  const handleSelectSourceDirectory = async () => {
    const directory = await selectSourceDirectory()
    if (directory) setSettings((current) => ({ ...current, sourceDirectory: directory }))
  }

  const askAssistant = (event: FormEvent) => {
    event.preventDefault()
    const question = prompt.trim()
    if (!question || isThinking) return

    setMessages((current) => [...current, { role: 'user', text: question }])
    setPrompt('')
    setIsThinking(true)

    window.setTimeout(() => {
      const terms = question.toLowerCase().split(/\s+/)
      const ranked = notes
        .map((note) => ({
          note,
          score: terms.reduce(
            (score, term) =>
              score +
              (`${note.title}${note.summary}${note.content}${note.tag}`
                .toLowerCase()
                .includes(term)
                ? 1
                : 0),
            0,
          ),
        }))
        .sort((a, b) => b.score - a.score)
      const sources = ranked.filter((item) => item.score > 0).slice(0, 2).map((item) => item.note)
      const fallback = notes.filter((note) => note.pinned).slice(0, 2)
      const usedSources = sources.length ? sources : fallback
      const response = usedSources.length
        ? `结合你的笔记，我建议先抓住一个原则：${usedSources[0].content.slice(0, 76)}${usedSources.length > 1 ? ` 另外，${usedSources[1].summary}` : ''}`
        : '目前知识库里还没有足够的相关内容。你可以先记录几个关键词，我会帮你继续整理。'
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: response, sources: usedSources },
      ])
      setIsThinking(false)
    }, 650)
  }

  const changeView = (next: View) => {
    setView(next)
    setActiveCollection('全部')
    setMobileMenuOpen(false)
  }

  return (
    <div className={`app-shell ${assistantOpen ? '' : 'assistant-collapsed'}`}>
      <Sidebar
        view={view}
        activeCollection={activeCollection}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onViewChange={changeView}
        onCollectionChange={(name) => {
          setActiveCollection(name)
          setView('全部笔记')
          setMobileMenuOpen(false)
        }}
        onCreate={() => setEditorOpen(true)}
        onLogout={() => void logout(session).catch(() => undefined).finally(onLogout)}
        profile={profile}
        onEditProfile={() => setProfileOpen(true)}
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
              placeholder="搜索笔记、标签或内容"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="清空搜索"><X size={15} /></button>
            )}
          </label>
          <div className="top-actions">
            <button className="file-action" onClick={() => void handleImportDocument()} title="上传知识文件">
              <Upload size={16} /><span>上传</span>
            </button>
            <button className="file-action" onClick={() => void handleExportMarkdown()} title="导出全部笔记为 Markdown">
              <Download size={16} /><span>导出</span>
            </button>
            <button className="icon-button" aria-label="通知"><Bell size={18} /></button>
            {!assistantOpen && (
              <button className="ai-open-button" onClick={() => setAssistantOpen(true)}>
                <Sparkles size={16} /> AI 管家
              </button>
            )}
          </div>
        </header>

        <div className="content-scroll">
          {view === '知识文件' ? (
            <KnowledgeFilesView
              documents={documents}
              loading={documentsLoading}
              onUpload={() => void handleImportDocument()}
              onDelete={(document) => void handleDeleteDocument(document)}
              sourcePaths={documentSources}
              onOpenSource={(document) => void handleOpenSource(document)}
              onPreview={(document) => void handlePreviewDocument(document)}
              onRefresh={() => void refreshDocuments()}
            />
          ) : view === '首页' && !query && activeCollection === '全部' ? (
            <HomeView notes={notes} onOpen={setSelectedNote} onFavorite={toggleFavorite} onCreate={() => setEditorOpen(true)} />
          ) : (
            <NotesView
              title={activeCollection !== '全部' ? activeCollection : view}
              notes={filteredNotes}
              query={query}
              onOpen={setSelectedNote}
              onFavorite={toggleFavorite}
              onCreate={() => setEditorOpen(true)}
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
        />
      )}

      <nav className="mobile-nav" aria-label="移动端导航">
        <button className={view === '首页' ? 'active' : ''} onClick={() => changeView('首页')}><Home /><span>首页</span></button>
        <button className={view === '全部笔记' ? 'active' : ''} onClick={() => changeView('全部笔记')}><FileText /><span>笔记</span></button>
        <button className="mobile-add" onClick={() => setEditorOpen(true)} aria-label="新建笔记"><Plus /></button>
        <button onClick={() => setAssistantOpen(true)}><Bot /><span>AI 管家</span></button>
        <button onClick={() => setMobileMenuOpen(true)}><Folder /><span>空间</span></button>
      </nav>

      {editorOpen && <NoteEditor onClose={() => setEditorOpen(false)} onSubmit={handleCreateNote} />}
      {selectedNote && (
        <NoteDetail
          note={selectedNote}
          onClose={() => setSelectedNote(null)}
          onFavorite={() => {
            toggleFavorite(selectedNote.id)
          }}
        />
      )}
      {profileOpen && <ProfileEditor profile={profile} onClose={() => setProfileOpen(false)} onSubmit={handleSaveProfile} />}
      {settingsOpen && (
        <SettingsEditor
          settings={settings}
          onChange={setSettings}
          onSelectDirectory={() => void handleSelectSourceDirectory()}
          onClose={() => setSettingsOpen(false)}
          onSubmit={handleSaveSettings}
        />
      )}
      {documentPreview && <DocumentTextPreview preview={documentPreview} onClose={() => setDocumentPreview(null)} />}
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
  onEditProfile: () => void
  onOpenSettings: () => void
}) {
  const nav: { label: View; icon: typeof Home; count?: number }[] = [
    { label: '首页', icon: Home },
    { label: '全部笔记', icon: FileText, count: 67 },
    { label: '知识文件', icon: Database },
    { label: '收件箱', icon: Inbox, count: 5 },
    { label: '收藏', icon: Heart },
    { label: '归档', icon: Archive },
  ]
  return (
    <>
      {open && <button className="sidebar-backdrop" onClick={onClose} aria-label="关闭菜单" />}
      <aside className={`sidebar ${open ? 'mobile-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><BookOpen size={19} /></div>
          <div><strong>知序</strong><span>我的知识空间</span></div>
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="关闭菜单"><X size={18} /></button>
        </div>
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
              {item.count && <small>{item.count}</small>}
            </button>
          ))}
        </nav>
        <div className="section-label"><span>知识空间</span><button aria-label="添加知识空间"><Plus size={14} /></button></div>
        <div className="collection-list">
          {collections.map((collection) => (
            <button
              key={collection.name}
              className={activeCollection === collection.name ? 'active' : ''}
              onClick={() => onCollectionChange(collection.name)}
            >
              <i style={{ backgroundColor: collection.color }} />
              <span>{collection.name}</span>
              <small>{collection.count}</small>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button onClick={onOpenSettings}><Settings size={17} /><span>设置</span></button>
          <button onClick={onLogout}><LogOut size={17} /><span>退出登录</span></button>
          <button className="profile" onClick={onEditProfile} aria-label="编辑个人资料">
            <div className="avatar">{profile.displayName.slice(0, 1)}</div>
            <div><strong>{profile.displayName}</strong><span>{profile.spaceName}</span></div>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>
    </>
  )
}

function HomeView({ notes, onOpen, onFavorite, onCreate }: { notes: Note[]; onOpen: (note: Note) => void; onFavorite: (id: Note['id']) => void; onCreate: () => void }) {
  const pinned = notes.filter((note) => note.pinned).slice(0, 2)
  const recent = notes.slice(0, 4)
  return (
    <div className="page home-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">8 月 13 日 · 星期四</p>
          <h1>早上好，知远</h1>
          <p>你的知识库里有 <strong>{notes.length + 61}</strong> 条笔记，<strong>5</strong> 条内容等待整理。</p>
        </div>
        <button className="primary-action" onClick={onCreate}><PenLine size={17} />记录想法</button>
      </section>

      <section className="focus-band">
        <div className="focus-icon"><Lightbulb size={20} /></div>
        <div className="focus-copy">
          <span>今日回顾</span>
          <strong>真正有价值的知识，不在于收藏，而在于连接和使用。</strong>
        </div>
        <button onClick={() => pinned[0] && onOpen(pinned[0])}>查看笔记 <ArrowUp size={15} /></button>
      </section>

      <section className="dashboard-section">
        <div className="section-heading">
          <div><span className="section-kicker">置顶内容</span><h2>持续关注</h2></div>
          <button>查看全部</button>
        </div>
        <div className="pinned-grid">
          {pinned.map((note, index) => (
            <article className={`pinned-note accent-${index + 1}`} key={note.id} onClick={() => onOpen(note)}>
              <div className="card-topline"><span><Pin size={13} /> {note.collection}</span><button aria-label="更多操作"><MoreHorizontal size={17} /></button></div>
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
          {recent.map((note) => <NoteRow key={note.id} note={note} onOpen={onOpen} onFavorite={onFavorite} />)}
        </div>
      </section>
    </div>
  )
}

function NotesView({ title, notes, query, onOpen, onFavorite, onCreate }: { title: string; notes: Note[]; query: string; onOpen: (note: Note) => void; onFavorite: (id: Note['id']) => void; onCreate: () => void }) {
  return (
    <div className="page notes-page">
      <div className="notes-header">
        <div><p className="eyebrow">知识库</p><h1>{query ? `“${query}” 的搜索结果` : title}</h1><p>共 {notes.length} 条内容</p></div>
        <button className="primary-action" onClick={onCreate}><Plus size={17} />新建笔记</button>
      </div>
      {notes.length ? (
        <div className="note-list full-list">
          {notes.map((note) => <NoteRow key={note.id} note={note} onOpen={onOpen} onFavorite={onFavorite} />)}
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

function KnowledgeFilesView({ documents, loading, sourcePaths, onUpload, onDelete, onOpenSource, onPreview, onRefresh }: { documents: ApiDocument[]; loading: boolean; sourcePaths: Record<string, string>; onUpload: () => void; onDelete: (document: ApiDocument) => void; onOpenSource: (document: ApiDocument) => void; onPreview: (document: ApiDocument) => void; onRefresh: () => void }) {
  return (
    <div className="page documents-page">
      <div className="notes-header">
        <div><p className="eyebrow">AI 知识来源</p><h1>知识文件</h1><p>源文件、解析任务和向量索引状态</p></div>
        <button className="primary-action" onClick={onUpload}><Upload size={17} />上传文件</button>
      </div>
      <div className="document-summary">
        <div><HardDrive size={18} /><span><strong>{documents.length}</strong> 个云端文件</span></div>
        <p>目前可解析 Markdown/TXT；PDF、DOCX 等格式正在等待解析器接入。</p>
        <button onClick={onRefresh}>刷新状态</button>
      </div>
      {loading ? (
        <div className="empty-state"><div><Database size={22} /></div><h2>正在读取文件状态</h2></div>
      ) : documents.length ? (
        <div className="document-list">
          <div className="document-list-head"><span>文件</span><span>类型</span><span>索引状态</span><span>更新时间</span><span>操作</span></div>
          {documents.map((document) => (
            <article className="document-row" key={document.id}>
              <div className="document-title"><div className="doc-icon"><FileText size={18} /></div><span><strong>{document.title}</strong><small>{document.chunk_count ? `${document.chunk_count} 个切块` : '尚未生成切块'}</small></span></div>
              <span className="document-type">{formatMimeType(document.mime_type)}</span>
              <span className={`status-badge status-${document.status}`}><i />{statusLabel(document.status)}</span>
              <time>{new Date(document.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
              <div className="document-actions">
                <button onClick={() => onOpenSource(document)} disabled={!sourcePaths[document.id]} title={sourcePaths[document.id] ? '用系统默认程序打开源文件' : '当前设备没有源文件路径'}><ExternalLink size={15} /></button>
                <button onClick={() => onPreview(document)} title="查看后端提取文本"><Eye size={15} /></button>
                <button className="delete-action" onClick={() => onDelete(document)} title="删除云端记录"><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><div><Upload size={22} /></div><h2>还没有知识文件</h2><p>上传文档后，可以在这里查看解析与索引状态。</p><button onClick={onUpload}>上传第一个文件</button></div>
      )}
    </div>
  )
}

function DocumentTextPreview({ preview, onClose }: { preview: DocumentPreview; onClose: () => void }) {
  return (
    <div className="modal-backdrop detail-backdrop" onMouseDown={onClose}>
      <article className="note-detail document-preview" onMouseDown={(event) => event.stopPropagation()}>
        <header><div className="detail-actions"><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div></header>
        <div className="detail-content">
          <div className="detail-label"><span className="tag">提取文本</span><span>{formatMimeType(preview.mimeType)}</span></div>
          <h1>{preview.document.title}</h1>
          <p className="preview-notice">这里显示的是供搜索和向量化使用的解析文本，不保留 PDF/DOCX 的原始版面。</p>
          <pre>{preview.content}</pre>
        </div>
      </article>
    </div>
  )
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

function NoteRow({ note, onOpen, onFavorite }: { note: Note; onOpen: (note: Note) => void; onFavorite: (id: Note['id']) => void }) {
  return (
    <article className="note-row" onClick={() => onOpen(note)}>
      <div className="doc-icon"><FileText size={18} /></div>
      <div className="note-copy"><h3>{note.title}</h3><p>{note.summary}</p><div className="note-meta"><span>{note.collection}</span><i /> <span>{note.updated}</span><i /><span>{note.readTime} 分钟阅读</span></div></div>
      <span className="tag">{note.tag}</span>
      <button
        className={note.favorite ? 'favorite active' : 'favorite'}
        onClick={(event) => { event.stopPropagation(); onFavorite(note.id) }}
        aria-label={note.favorite ? '取消收藏' : '收藏'}
      ><Heart size={17} fill={note.favorite ? 'currentColor' : 'none'} /></button>
    </article>
  )
}

function AssistantPanel({ messages, prompt, thinking, onPromptChange, onSubmit, onClose, onSuggestion, onOpenSource }: { messages: Message[]; prompt: string; thinking: boolean; onPromptChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onClose: () => void; onSuggestion: (value: string) => void; onOpenSource: (note: Note) => void }) {
  return (
    <aside className="assistant-panel">
      <header className="assistant-header">
        <div className="assistant-identity"><div><Sparkles size={17} /></div><span><strong>知序 AI</strong><small><i /> 已连接知识库</small></span></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭 AI 管家"><PanelRightClose size={18} /></button>
      </header>
      <div className="assistant-body">
        <div className="day-divider"><span>今天</span></div>
        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
            {message.role === 'assistant' && <div className="bot-avatar"><Sparkles size={14} /></div>}
            <div className="message-content">
              <p>{message.text}</p>
              {message.sources && message.sources.length > 0 && (
                <div className="sources">
                  <span>参考了 {message.sources.length} 条笔记</span>
                  {message.sources.map((source) => (
                    <button key={source.id} onClick={() => onOpenSource(source)}><FileText size={13} />{source.title}</button>
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
        <div><button type="button" aria-label="选择知识范围"><Folder size={15} />全部知识 <ChevronDown size={13} /></button><button className="send-button" type="submit" disabled={!prompt.trim() || thinking} aria-label="发送"><ArrowUp size={17} /></button></div>
      </form>
      <p className="assistant-footnote">回答可能存在偏差，请核对引用来源</p>
    </aside>
  )
}

function NoteEditor({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="editor-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>新建笔记</span><small>内容将保存到 PostgreSQL</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <input name="title" className="title-input" placeholder="输入标题" autoFocus required />
        <textarea name="content" className="content-input" placeholder="记下此刻的想法…" />
        <footer>
          <label><Folder size={15} /><select name="collection">{collections.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
          <div><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-action"><Check size={16} />保存笔记</button></div>
        </footer>
      </form>
    </div>
  )
}

function ProfileEditor({ profile, onClose, onSubmit }: { profile: UserProfile; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="profile-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>个人资料</span><small>管理本机展示信息</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="profile-form">
          <label><span>用户名</span><input value={profile.username} disabled /></label>
          <label><span>显示名称</span><input name="displayName" defaultValue={profile.displayName} maxLength={30} required autoFocus /></label>
          <label><span>知识空间名称</span><input name="spaceName" defaultValue={profile.spaceName} maxLength={40} required /></label>
          <label><span>个人签名</span><textarea name="bio" defaultValue={profile.bio} maxLength={120} rows={3} /></label>
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-action"><Check size={16} />保存资料</button></footer>
      </form>
    </div>
  )
}

function SettingsEditor({ settings, onChange, onSelectDirectory, onClose, onSubmit }: { settings: AppSettings; onChange: (settings: AppSettings) => void; onSelectDirectory: () => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="settings-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>文件与同步设置</span><small>控制源文件保存位置和默认上传行为</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="settings-form">
          <section>
            <div className="setting-title"><HardDrive size={17} /><span><strong>源文件目录</strong><small>PDF、Word 等原始文件保留在此目录，向量库不替代源文件。</small></span></div>
            <div className="path-picker"><input value={settings.sourceDirectory} readOnly placeholder="尚未选择目录" /><button type="button" onClick={onSelectDirectory}><Folder size={15} />选择目录</button></div>
          </section>
          <label className="toggle-row"><span><strong>保留源文件副本</strong><small>导入时复制一份到上面的目录</small></span><input type="checkbox" checked={settings.keepSourceCopy} onChange={(event) => onChange({ ...settings, keepSourceCopy: event.target.checked })} /></label>
          <label className="toggle-row"><span><strong>导入后上传云端</strong><small>上传业务元数据与可解析内容到 PostgreSQL</small></span><input type="checkbox" checked={settings.uploadAfterImport} onChange={(event) => onChange({ ...settings, uploadAfterImport: event.target.checked })} /></label>
          <div className="storage-model"><Database size={17} /><p><strong>数据分层</strong><span>SQLite 保存本地数据；PostgreSQL 保存云端副本；pgvector 只保存 AI 检索索引。</span></p></div>
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-action"><Check size={16} />保存设置</button></footer>
      </form>
    </div>
  )
}

function NoteDetail({ note, onClose, onFavorite }: { note: Note; onClose: () => void; onFavorite: () => void }) {
  return (
    <div className="modal-backdrop detail-backdrop" onMouseDown={onClose}>
      <article className="note-detail" onMouseDown={(event) => event.stopPropagation()}>
        <header><div className="detail-actions"><button className="icon-button" onClick={onFavorite} aria-label="收藏"><Heart size={18} fill={note.favorite ? 'currentColor' : 'none'} /></button><button className="icon-button" aria-label="更多操作"><MoreHorizontal size={18} /></button><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div></header>
        <div className="detail-content"><div className="detail-label"><span className="tag">{note.tag}</span><span>{note.collection}</span></div><h1>{note.title}</h1><div className="detail-meta"><Clock3 size={15} />{note.updated}<i />预计阅读 {note.readTime} 分钟</div><p className="detail-lead">{note.summary}</p><p>{note.content}</p></div>
      </article>
    </div>
  )
}

export default App
