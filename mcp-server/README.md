# Zhixu MCP Server

独立的知序 MCP 工具服务。它通过受控 HTTP API 调用 `zhixu-backend`，不直接连接 PostgreSQL。

整体架构、后端任务和当前进度见 [`../docs/整体架构.md`](../docs/整体架构.md)、[`../docs/后端实施清单.md`](../docs/后端实施清单.md) 和 [`../docs/项目进度.md`](../docs/项目进度.md)。

## 技术与传输

- Node.js `20.19.6`
- TypeScript
- 官方 `@modelcontextprotocol/sdk`
- MCP `stdio` transport，不占用额外端口

## 当前工具

| 工具 | 状态 | 作用 |
| --- | --- | --- |
| `health_check` | 可用 | 调用后端 `/api/health` |
| `search_notes` | 等待后端 API | 调用 `/api/notes/search` |
| `get_note` | 等待后端 API | 调用 `/api/notes/{id}` |

## 启动

```powershell
cd D:\KnoweldgeOrder\mcp-server
npm install --cache .npm-cache
npm run build
npm start
```

stdio 服务启动后会等待 MCP Client 消息，直接运行时没有交互界面。调试使用：

```powershell
npm run inspect
```

## 配置

```text
ZHIXU_BACKEND_URL=http://localhost:8080
ZHIXU_BACKEND_TIMEOUT_MS=5000
```

MCP Client 配置示例：

```json
{
  "mcpServers": {
    "zhixu": {
      "command": "node",
      "args": ["D:/KnoweldgeOrder/mcp-server/dist/index.js"],
      "env": {
        "ZHIXU_BACKEND_URL": "http://localhost:8080"
      }
    }
  }
}
```

不同客户端的配置文件位置不同，但 Server 定义内容相同。必须先执行 `npm run build` 生成 `dist/index.js`。

## 安全边界

- MCP Server 不接收数据库密码，也不直接执行 SQL。
- 权限、审计、输入校验和业务规则由 Spring Boot 后端执行。
- 当前只提供只读工具。
- 后续写入工具必须带用户确认、幂等键和审计记录。
- stdout 专用于 MCP 协议，运行日志只能写 stderr。
