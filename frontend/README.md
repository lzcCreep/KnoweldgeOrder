# 知序桌面端

React + TypeScript + Vite + Tauri 2 的本地优先桌面应用。

## 环境与启动

- Node.js `20.19.6`
- Rust stable（Tauri 桌面开发需要）

```powershell
npm install
npm run dev       # 浏览器模式
npm run app:dev   # Tauri 桌面模式
npm run build
npm run app:build
npm run test:e2e  # 桌面和手机宽度的离线 CRUD 回归测试
```

## 手机使用

当前版本支持手机浏览器，不等同于已经生成 Android/iOS 原生安装包。电脑与手机连接同一局域网后：

1. 确认 `5173` 未被占用，在电脑运行 `npm run dev`，Vite 会监听固定端口和局域网地址。
2. 在手机打开终端输出中的 `Network` 地址，例如 `http://192.168.2.28:5173`。
3. 可以离线进入、新建/编辑/收藏/删除笔记，并在“知识库文件”中导入、查看和编辑 Markdown/TXT。
4. 登录、同步和云端索引通过 Vite `/api` 代理访问电脑上的 `localhost:8080` 后端。

浏览器模式使用浏览器本地存储，并把导入的 Markdown/TXT 保存在浏览器本地文件仓库；受浏览器权限限制，它不能扫描任意 Windows 目录。Tauri 桌面模式使用 SQLite，并会真实扫描设置中的知识库目录、复制导入文件和写回编辑内容。两者目前不会自动共享各自尚未同步的本地数据。Android/iOS 原生工程尚未执行 `tauri android init` / `tauri ios init`。

手机上的“离线编辑”指后端不可用时仍可操作已打开的页面；首次打开或刷新仍需连接电脑上的 Vite 服务。要在完全断网后重新启动，还需要增加 PWA Service Worker 和离线静态资源缓存。

局域网地址仅用于本地开发，不要暴露到公网。生产移动端登录和同步必须使用 HTTPS。

详细文档已统一迁移到根目录：

- [整体架构](../docs/整体架构.md)
- [Rust 与 Tauri 指南](../docs/Rust与Tauri指南.md)
- [前后端接口契约](../docs/前后端接口契约.md)
- [数据与文件策略](../docs/数据与文件策略.md)
- [项目进度](../docs/项目进度.md)

笔记现在始终先写本地存储，再通过同步队列重放到云端；冲突不会静默覆盖。后端批量 push/pull、跨设备游标拉取和原生移动安装包仍未完成，详情以进度文档为准。

“设置”中可以配置 OpenAI 兼容模型的服务 URL、API Key、模型名、温度和最大输出。配置只保存在当前设备；登录模式由 Spring Boot `/api/v1/ai/chat` 完成 pgvector 检索并通过 LangChain4j 调用模型，未配置时界面不会生成模拟回答。知识库文件目录默认为 `knowledge-files`，导入时始终先写入本机；登录且开启云端同步时，再创建云端文档和索引记录。

设置页面采用左侧分类、右侧内容的双栏布局，分为账号、通用、AI 模型、通知和关于；版本更新提醒可以在“通知”中关闭，版本说明入口位于“关于”。
