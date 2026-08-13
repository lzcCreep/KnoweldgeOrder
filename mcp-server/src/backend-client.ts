export type NoteSummary = {
  id: number
  title: string
  summary?: string
  collection?: string
  tags?: string[]
  updatedAt?: string
}

export type NoteDetail = NoteSummary & {
  content: string
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export class ZhixuBackendClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async health(): Promise<unknown> {
    return this.request('/api/health')
  }

  async searchNotes(query: string, limit: number): Promise<NoteSummary[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const result = await this.request<unknown>(`/api/notes/search?${params}`)
    if (Array.isArray(result)) return result as NoteSummary[]
    if (isRecord(result) && Array.isArray(result.items)) return result.items as NoteSummary[]
    throw new BackendError('后端搜索接口返回了无法识别的数据结构')
  }

  async getNote(id: number): Promise<NoteDetail> {
    return this.request<NoteDetail>(`/api/notes/${id}`)
  }

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(new URL(path, this.baseUrl), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.text()
        throw new BackendError(
          `知序后端请求失败：HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ''}`,
          response.status,
        )
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof BackendError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BackendError(`知序后端请求超过 ${this.timeoutMs}ms`)
      }
      throw new BackendError(`无法连接知序后端 ${this.baseUrl}：${String(error)}`)
    } finally {
      clearTimeout(timeout)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
