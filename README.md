# 知序（Zhixu）个人知识库与 AI 管家

本地优先的个人知识库项目，用于学习和实践 Tauri、SQLite、Spring Boot、LangChain4j、RAG、pgvector 与 MCP。

## 项目结构

```text
D:\KnoweldgeOrder
├─ docs/                 # 全项目公共中文文档
├─ frontend/             # React + TypeScript + Tauri 桌面端
├─ backend/              # Spring Boot + LangChain4j 后端
├─ mcp-server/           # 独立 MCP 工具服务
├─ database/             # 预留数据库迁移/运维脚本
└─ README.md
```

目标数据分层：

```text
SQLite      -> 本地笔记、设置、文件元数据和同步队列
PostgreSQL  -> 云端业务数据
pgvector    -> AI 可检索的派生向量索引
源文件目录   -> PDF、DOCX、图片等原始文件
```

## 公共文档

- [文档索引](docs/README.md)
- [整体架构](docs/整体架构.md)
- [数据与文件策略](docs/数据与文件策略.md)
- [项目进度](docs/项目进度.md)
- [后端实施清单](docs/后端实施清单.md)
- [前端任务说明](docs/前端任务说明.md)
- [后端任务说明](docs/后端任务说明.md)
- [参数台账](docs/参数台账.md)
- [学习路线](docs/学习路线.md)

## 默认端口

| 服务 | 端口 |
| --- | ---: |
| Vite 前端 | `5173` |
| Spring Boot 后端 | `8080` |
| BGE-M3 Embedding | `8100` |
| PostgreSQL + pgvector | `5432` |
| MCP Server | stdio，不监听端口 |

各项目启动方式见 [frontend/README.md](frontend/README.md)、[mcp-server/README.md](mcp-server/README.md) 和公共参数文档。
