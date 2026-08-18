import { isTauri } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export type ApiUser = { id: string; username: string; display_name: string; bio: string }
export type ApiSpace = { id: string; name: string; role: string }
export type AuthSession = {
  user: ApiUser
  accessToken: string
  refreshToken: string
  expiresIn: number
  spaces: ApiSpace[]
}

export type ApiNote = {
  id: string
  space_id: string
  title: string
  content: string
  collection: string
  favorite: boolean
  archived?: boolean
  archive_folder_id?: string | null
  revision: number
  created_at: string
  updated_at: string
}

export type ApiDocument = {
  id: string
  title: string
  mime_type: string
  status: 'queued' | 'parsing' | 'indexing' | 'ready' | 'failed' | 'archived'
  page_count: number | null
  chunk_count: number
  tags: string[]
  space_id?: string
  collection?: string
  favorite?: boolean
  archived?: boolean
  archive_folder_id?: string | null
  local_path?: string | null
  updated_at: string
}

export type ApiTodo = {
  id: string
  space_id: string
  text: string
  day: string
  completed: boolean
  revision: number
  created_at: string
  updated_at: string
}

export type ApiArchiveFolder = {
  id: string
  space_id: string
  parent_id: string | null
  name: string
  created_at: string
  updated_at: string
}

export type ApiArchiveItem = {
  entity_type: 'note' | 'document'
  entity_id: string
  folder_id: string | null
  title: string
  collection?: string
  favorite?: boolean
  updated_at: string
}

export type AiChatSettings = {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export type ModelReference = {
  type: 'local_notes' | 'cloud_document'
  id: string
  title: string
  mime_type?: string
}

export type ModelChatResult = {
  answer: string
  model: string
  reference_count: number
  references?: ModelReference[]
}

type Envelope<T> = { data: T; request_id: string }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const apiBase = import.meta.env.VITE_API_BASE_URL || (isTauri() ? 'http://localhost:8080' : '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init)
  const payload = await response.json().catch(() => null) as (Envelope<T> & { error?: { code?: string; message?: string } }) | null
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || `请求失败（${response.status}）`,
      response.status,
      payload?.error?.code || 'request_failed',
      payload?.request_id || null,
    )
  }
  if (!payload) throw new Error('后端返回了无法识别的响应')
  return payload.data
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` })

export async function login(username: string, password: string): Promise<AuthSession> {
  return authenticate('/api/v1/auth/login', { username, password })
}

export async function register(username: string, password: string, displayName: string): Promise<AuthSession> {
  return authenticate('/api/v1/auth/register', { username, password, display_name: displayName })
}

async function authenticate(path: string, credentials: Record<string, string>): Promise<AuthSession> {
  const result = await request<{ user: ApiUser; access_token: string; refresh_token: string; expires_in: number }>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const me = await request<{ user: ApiUser; spaces: ApiSpace[] }>('/api/v1/auth/me', {
    headers: authHeaders(result.access_token),
  })
  return {
    user: me.user,
    spaces: me.spaces,
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresIn: result.expires_in,
  }
}

export async function logout(session: AuthSession) {
  await request<{ logged_out: boolean }>('/api/v1/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  })
}

export async function listNotes(session: AuthSession, query = '', spaceId?: string) {
  const space = requireSpace(session, spaceId)
  const params = new URLSearchParams({ limit: '100' })
  if (query) params.set('q', query)
  return request<{ items: ApiNote[]; next_cursor: string | null }>(`/api/v1/spaces/${space.id}/notes?${params}`, {
    headers: authHeaders(session.accessToken),
  })
}

export async function createNote(session: AuthSession, title: string, content: string, collection: string, id?: string, spaceId?: string,
  archived = false, archiveFolderId: string | null = null) {
  const space = requireSpace(session, spaceId)
  return request<ApiNote>(`/api/v1/spaces/${space.id}/notes`, {
    method: 'POST',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, title, content, collection, archived, archive_folder_id: archiveFolderId }),
  })
}

export async function getNote(session: AuthSession, noteId: string) {
  return request<ApiNote>(`/api/v1/notes/${noteId}`, {
    headers: authHeaders(session.accessToken),
  })
}

export async function updateNote(session: AuthSession, note: ApiNote, patch: { title?: string; content?: string; collection?: string; favorite?: boolean; archived?: boolean; archive_folder_id?: string | null }) {
  return request<ApiNote>(`/api/v1/notes/${note.id}`, {
    method: 'PUT',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...patch, revision: note.revision }),
  })
}

export async function deleteNote(session: AuthSession, noteId: string) {
  return request<{ deleted: boolean }>(`/api/v1/notes/${noteId}`, {
    method: 'DELETE',
    headers: authHeaders(session.accessToken),
  })
}

export async function listTodos(session: AuthSession, day: string, spaceId?: string) {
  const space = requireSpace(session, spaceId)
  const params = new URLSearchParams({ day })
  return request<{ items: ApiTodo[] }>(`/api/v1/spaces/${space.id}/todos?${params}`, {
    headers: authHeaders(session.accessToken),
  })
}

export async function createTodo(session: AuthSession, todo: { id: string; text: string; day: string; completed: boolean }, spaceId?: string) {
  const space = requireSpace(session, spaceId)
  return request<ApiTodo>(`/api/v1/spaces/${space.id}/todos`, {
    method: 'POST',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(todo),
  })
}

export async function updateTodo(session: AuthSession, todo: ApiTodo, patch: { text?: string; day?: string; completed?: boolean }) {
  return request<ApiTodo>(`/api/v1/todos/${todo.id}`, {
    method: 'PUT',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...patch, revision: todo.revision }),
  })
}

export async function deleteTodo(session: AuthSession, todoId: string) {
  return request<{ deleted: boolean }>(`/api/v1/todos/${todoId}`, {
    method: 'DELETE',
    headers: authHeaders(session.accessToken),
  })
}

export async function uploadDocument(session: AuthSession, fileName: string, bytes: Uint8Array, mimeType: string, localDirectory: string, spaceId?: string) {
  const space = requireSpace(session, spaceId)
  const body = new FormData()
  body.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName)
  body.append('tags', '[]')
  body.append('local_directory', localDirectory)
  return request<{ document: { id: string; title: string; status: ApiDocument['status']; local_path: string | null }; job: { id: string; status: ApiDocument['status'] } }>(
    `/api/v1/spaces/${space.id}/documents`,
    { method: 'POST', headers: authHeaders(session.accessToken), body },
  )
}

export async function listDocuments(session: AuthSession, query = '', spaceId?: string) {
  const space = requireSpace(session, spaceId)
  const params = new URLSearchParams({ limit: '100' })
  if (query) params.set('q', query)
  return request<{ items: ApiDocument[]; next_cursor: string | null }>(
    `/api/v1/spaces/${space.id}/documents?${params}`,
    { headers: authHeaders(session.accessToken) },
  )
}

export async function deleteDocument(session: AuthSession, documentId: string) {
  return request<{ deleted: boolean }>(`/api/v1/documents/${documentId}`, {
    method: 'DELETE',
    headers: authHeaders(session.accessToken),
  })
}

export async function getDocumentContent(session: AuthSession, documentId: string) {
  return request<{ content: string; mime_type: string; updated_at: string }>(
    `/api/v1/documents/${documentId}/content`,
    { headers: authHeaders(session.accessToken) },
  )
}

export async function updateDocumentMetadata(session: AuthSession, document: ApiDocument, patch: { collection?: string; favorite?: boolean; archived?: boolean; archive_folder_id?: string | null }) {
  return request<ApiDocument>(`/api/v1/documents/${document.id}`, {
    method: 'PUT',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export async function listArchive(session: AuthSession, spaceId?: string) {
  const space = requireSpace(session, spaceId)
  return request<{ folders: ApiArchiveFolder[]; items: ApiArchiveItem[] }>(`/api/v1/spaces/${space.id}/archive`, {
    headers: authHeaders(session.accessToken),
  })
}

export async function createArchiveFolder(session: AuthSession, name: string, parentId: string | null, id?: string, spaceId?: string) {
  const space = requireSpace(session, spaceId)
  return request<ApiArchiveFolder>(`/api/v1/spaces/${space.id}/archive/folders`, {
    method: 'POST',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, parent_id: parentId }),
  })
}

export async function deleteArchiveFolder(session: AuthSession, folderId: string) {
  return request<{ deleted: boolean }>(`/api/v1/archive/folders/${folderId}`, {
    method: 'DELETE',
    headers: authHeaders(session.accessToken),
  })
}

export async function createSpace(session: AuthSession, name: string) {
  return request<ApiSpace>('/api/v1/spaces', {
    method: 'POST',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function renameSpace(session: AuthSession, spaceId: string, name: string) {
  return request<ApiSpace>(`/api/v1/spaces/${spaceId}`, {
    method: 'PUT',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function updateProfile(session: AuthSession, displayName: string, bio: string) {
  return request<ApiUser>('/api/v1/auth/profile', {
    method: 'PUT',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName, bio }),
  })
}

export async function chatWithModel(session: AuthSession, settings: AiChatSettings, prompt: string, context: string, spaceId = '') {
  return request<ModelChatResult>('/api/v1/ai/chat', {
    method: 'POST',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_url: settings.baseUrl,
      api_key: settings.apiKey,
      model: settings.model,
      prompt,
      context,
      space_id: spaceId,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
    }),
  })
}

export async function chatDirectlyWithModel(settings: AiChatSettings, prompt: string, context: string) {
  const endpoint = modelChatEndpoint(settings.baseUrl)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`

  const systemMessage = [
    '你是知序个人知识库助手，当前运行在本地上下文模式。',
    '优先依据参考资料回答，引用事实时指明资料标题；资料不足时要明确说明，不要编造。',
    '当前模式不使用云端 RAG 或 MCP。默认使用简体中文，回答简洁且可执行。',
  ].join('')
  const userMessage = context.trim()
    ? `本机参考资料：\n\n${context.trim()}\n\n用户问题：\n${prompt.trim()}`
    : prompt.trim()
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 90_000)

  try {
    const modelFetch = isTauri() ? tauriFetch : globalThis.fetch
    const response = await modelFetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model.trim(),
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
        ],
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: false,
      }),
    })
    const payload = await response.json().catch(() => null) as ModelChatPayload | null
    if (!response.ok) {
      throw new Error(payload?.error?.message?.trim() || `模型服务返回错误（${response.status}）`)
    }
    const answer = modelAnswer(payload)
    if (!answer) throw new Error('模型服务未返回可识别的文本')
    return {
      answer,
      model: payload?.model?.trim() || settings.model.trim(),
      reference_count: context.trim() ? context.split('\n\n---\n\n').length : 0,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('模型请求超时，请检查服务地址或网络', { cause: error })
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

type ModelChatPayload = {
  model?: string
  error?: { message?: string }
  choices?: Array<{
    text?: string
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}

function modelAnswer(payload: ModelChatPayload | null) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((part) => part.text || '').join('').trim()
  return payload?.choices?.[0]?.text?.trim() || ''
}

function modelChatEndpoint(baseUrl: string) {
  try {
    const endpoint = new URL(baseUrl.trim())
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error()
    endpoint.hash = ''
    endpoint.search = ''
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, '')
    if (!endpoint.pathname.endsWith('/chat/completions')) endpoint.pathname += '/chat/completions'
    return endpoint.toString()
  } catch {
    throw new Error('模型服务 URL 不合法，请填写 http:// 或 https:// 地址')
  }
}

function requireSpace(session: AuthSession, spaceId?: string) {
  const space = spaceId
    ? session.spaces.find((item) => item.id === spaceId) || { id: spaceId, name: '', role: 'owner' }
    : session.spaces[0]
  if (!space) throw new Error('当前账号没有可用的知识空间')
  return space
}
