import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { BackendError, ZhixuBackendClient } from './backend-client.js'

const backendUrl = process.env.ZHIXU_BACKEND_URL ?? 'http://localhost:8080'
const timeoutMs = Number(process.env.ZHIXU_BACKEND_TIMEOUT_MS ?? '5000')
const client = new ZhixuBackendClient(backendUrl, timeoutMs)

const server = new McpServer({
  name: 'zhixu-knowledge-tools',
  version: '0.1.0',
})

server.registerTool(
  'health_check',
  {
    title: '检查知序后端',
    description: '检查知序 Spring Boot 后端是否可以访问。',
    inputSchema: {},
  },
  async () => {
    try {
      const result = await client.health()
      return textResult(JSON.stringify(result, null, 2))
    } catch (error) {
      return errorResult(error)
    }
  },
)

server.registerTool(
  'search_notes',
  {
    title: '搜索知识库笔记',
    description: '按关键词搜索用户有权访问的知序笔记，返回简要信息和笔记 ID。',
    inputSchema: {
      query: z.string().trim().min(1).max(200).describe('搜索关键词'),
      limit: z.number().int().min(1).max(20).default(5).describe('最多返回多少条'),
    },
  },
  async ({ query, limit }) => {
    try {
      const notes = await client.searchNotes(query, limit)
      return textResult(JSON.stringify({ query, count: notes.length, notes }, null, 2))
    } catch (error) {
      return errorResult(error)
    }
  },
)

server.registerTool(
  'get_note',
  {
    title: '读取知识库笔记',
    description: '根据笔记 ID 读取用户有权访问的完整笔记。通常先使用 search_notes 获取 ID。',
    inputSchema: {
      noteId: z.number().int().positive().describe('笔记 ID'),
    },
  },
  async ({ noteId }) => {
    try {
      const note = await client.getNote(noteId)
      return textResult(JSON.stringify(note, null, 2))
    } catch (error) {
      return errorResult(error)
    }
  },
)

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function errorResult(error: unknown) {
  const message = error instanceof BackendError ? error.message : `MCP 工具执行失败：${String(error)}`
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  }
}

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdout is reserved for MCP protocol messages.
  console.error(`Zhixu MCP Server 已启动，后端地址：${backendUrl}`)
}

main().catch((error) => {
  console.error('Zhixu MCP Server 启动失败', error)
  process.exit(1)
})
