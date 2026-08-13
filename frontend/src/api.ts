import { isTauri } from '@tauri-apps/api/core'

export type ApiUser = { id: string; username: string; display_name: string }
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
  favorite: boolean
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
  updated_at: string
}

type Envelope<T> = { data: T; request_id: string }

const apiBase = import.meta.env.VITE_API_BASE_URL || (isTauri() ? 'http://localhost:8080' : '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init)
  const payload = await response.json().catch(() => null) as (Envelope<T> & { error?: { message?: string } }) | null
  if (!response.ok) throw new Error(payload?.error?.message || `请求失败（${response.status}）`)
  if (!payload) throw new Error('后端返回了无法识别的响应')
  return payload.data
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` })

export async function login(username: string, password: string): Promise<AuthSession> {
  const result = await request<{ user: ApiUser; access_token: string; refresh_token: string; expires_in: number }>('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
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

export async function listNotes(session: AuthSession, query = '') {
  const space = requireSpace(session)
  const params = new URLSearchParams({ limit: '100' })
  if (query) params.set('q', query)
  return request<{ items: ApiNote[]; next_cursor: string | null }>(`/api/v1/spaces/${space.id}/notes?${params}`, {
    headers: authHeaders(session.accessToken),
  })
}

export async function createNote(session: AuthSession, title: string, content: string) {
  const space = requireSpace(session)
  return request<ApiNote>(`/api/v1/spaces/${space.id}/notes`, {
    method: 'POST',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  })
}

export async function updateNote(session: AuthSession, note: ApiNote, patch: { title?: string; content?: string; favorite?: boolean }) {
  return request<ApiNote>(`/api/v1/notes/${note.id}`, {
    method: 'PUT',
    headers: { ...authHeaders(session.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...patch, revision: note.revision }),
  })
}

export async function uploadDocument(session: AuthSession, fileName: string, bytes: Uint8Array, mimeType: string) {
  const space = requireSpace(session)
  const body = new FormData()
  body.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName)
  body.append('tags', '[]')
  return request<{ document: { id: string; title: string; status: string }; job: { id: string; status: string } }>(
    `/api/v1/spaces/${space.id}/documents`,
    { method: 'POST', headers: authHeaders(session.accessToken), body },
  )
}

export async function listDocuments(session: AuthSession, query = '') {
  const space = requireSpace(session)
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

function requireSpace(session: AuthSession) {
  const space = session.spaces[0]
  if (!space) throw new Error('当前账号没有可用的知识空间')
  return space
}
