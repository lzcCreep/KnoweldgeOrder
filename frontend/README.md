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
```

详细文档已统一迁移到根目录：

- [整体架构](../docs/整体架构.md)
- [Rust 与 Tauri 指南](../docs/Rust与Tauri指南.md)
- [前后端接口契约](../docs/前后端接口契约.md)
- [数据与文件策略](../docs/数据与文件策略.md)
- [项目进度](../docs/项目进度.md)

当前浏览器模式主要用于 UI 调试；正式本地优先数据模型以 Tauri + SQLite 为目标。真实云同步尚未完成，详情以进度文档为准。
