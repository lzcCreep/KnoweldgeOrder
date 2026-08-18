# 从 React 到 Windows EXE：知序的 Rust 与 Tauri 学习手册

本文以“知序”项目为例，解释 Rust、Tauri 2、React、SQLite 和 Windows 安装包如何协同工作。

> 正确名称是 **Tauri**，不是 Truai。Tauri 是桌面应用框架，Rust 是它的原生端语言。

## 1. 先建立整体认识

知序不是把 React “转换成 Rust”，而是把两部分组合成一个桌面应用：

```text
┌─────────────────────────────────────────────┐
│ Windows 桌面窗口（Tauri 创建）              │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ 系统 WebView2                         │  │
│  │ React + TypeScript + CSS              │  │
│  │ 页面、按钮、搜索、笔记编辑器          │  │
│  └───────────────────────────────────────┘  │
│                    │                        │
│          Tauri IPC / plugin API             │
│                    │                        │
│  ┌───────────────────────────────────────┐  │
│  │ Rust / Tauri 原生端                   │  │
│  │ 窗口、权限、SQLite、文件对话框        │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

各部分的职责：

| 部分 | 当前技术 | 负责什么 |
| --- | --- | --- |
| 页面 | React + TypeScript | 界面、状态、交互 |
| 前端构建 | Vite | 开发服务器和静态资源打包 |
| 桌面外壳 | Tauri 2 | 创建窗口、连接 WebView 与原生端 |
| 原生端 | Rust | 注册原生插件、启动桌面应用 |
| 本地数据 | SQLite | 持久化笔记 |
| Windows 安装 | NSIS | 生成安装程序 `.exe` |

Electron 通常会把 Chromium 和 Node.js 一起打包。Tauri 在 Windows 上复用系统 WebView2，所以安装包更小。代价是系统能力主要通过 Tauri 插件或 Rust 代码接入，不能直接在 React 页面中随意调用 Node.js 的 `fs`。

## 2. Rust 是什么

Rust 是一门编译型语言。TypeScript 通常先转换为 JavaScript，再由浏览器或 Node.js 执行；Rust 会被编译为机器可以直接运行的本地程序。

```text
TypeScript -> JavaScript -> WebView2 执行
Rust       -> 机器码     -> Windows 直接执行
```

Rust 的主要特点：

- 性能接近 C/C++。
- 不需要垃圾回收器。
- 编译器会检查内存生命周期、并发和类型安全。
- 编译阶段比较严格，首次编译依赖也比较慢。
- 编译完成后的程序启动快，运行开销低。

### 2.1 Rust 工具链

本机安装了以下工具：

```powershell
rustup --version
rustc --version
cargo --version
```

- `rustup`：安装和切换 Rust 工具链。
- `rustc`：Rust 编译器。
- `cargo`：依赖管理、编译、测试和运行工具，可类比 npm 加构建器。

常用命令：

```powershell
cargo check                        # 快速检查类型和编译问题
cargo build                        # 构建开发版
cargo build --release              # 构建优化后的发布版
cargo fmt                          # 格式化 Rust 代码
cargo clippy                       # 更深入的代码质量检查
```

### 2.2 用前端概念理解 Rust

变量默认不可修改：

```rust
let name = "知序";
let mut count = 1;
count += 1;
```

函数需要明确参数和返回类型：

```rust
fn add(left: i32, right: i32) -> i32 {
    left + right
}
```

`Result` 用来表达成功或失败，类似一个强类型版本的“返回值或抛出错误”：

```rust
fn load_note() -> Result<String, String> {
    Ok("笔记内容".to_string())
}
```

Rust 没有 `null` 作为普通值，可能不存在的值一般使用 `Option<T>`：

```rust
let title: Option<String> = Some("标题".to_string());
let missing: Option<String> = None;
```

`?` 会在出错时提前返回错误：

```rust
fn do_work() -> Result<(), SomeError> {
    first_step()?;
    second_step()?;
    Ok(())
}
```

现阶段不需要先学完 Rust 才能开发知序。先理解变量、结构体、`Option`、`Result`、`match`、所有权和异步函数，就足以编写多数 Tauri command。

## 3. 项目目录如何分工

```text
frontend/
├─ src/                         React 前端
│  ├─ App.tsx                   页面与交互
│  ├─ data.ts                   Note 类型和示例数据
│  └─ storage.ts                浏览器/桌面存储适配层
├─ src-tauri/                   Tauri 与 Rust 工程
│  ├─ Cargo.toml                Rust 包和依赖
│  ├─ Cargo.lock                Rust 依赖的精确版本锁定
│  ├─ tauri.conf.json           应用、窗口和打包配置
│  ├─ capabilities/default.json 权限配置
│  ├─ src/main.rs               Windows 程序入口
│  ├─ src/lib.rs                Tauri Builder 和插件注册
│  └─ icons/                    桌面应用图标
├─ package.json                 npm 依赖和命令
├─ vite.config.ts               Vite 配置
└─ dist/                        React 生产构建结果
```

简单记忆：

- `src` 是用户看见的应用。
- `src-tauri` 是把网页变成桌面程序并提供系统能力的部分。
- `package.json` 管 JavaScript 依赖。
- `Cargo.toml` 管 Rust 依赖。

## 4. Tauri 如何启动应用

### 4.1 Windows 入口 `main.rs`

当前入口很短：

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    zhixu_lib::run();
}
```

它完成两件事：

1. 发布版不额外显示命令行黑窗口。
2. 调用库中的 `run()` 启动 Tauri。

开发版保留控制台和日志有利于排错；发布版使用 Windows GUI 子系统，只展示应用窗口。

### 4.2 Tauri Builder `lib.rs`

核心启动代码位于 `src-tauri/src/lib.rs`：

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

可把 Builder 理解为桌面应用的装配器：

1. 创建默认 Tauri 应用。
2. 注册文件对话框插件。
3. 注册文件系统插件。
4. 注册 SQL 插件。
5. 读取 `tauri.conf.json`。
6. 创建窗口和 WebView。
7. 启动事件循环，等待点击、关闭、文件选择等事件。

Rust 程序不会像脚本一样执行完就退出。`.run(...)` 会持续运行窗口事件循环，直到应用关闭。

## 5. 开发模式是怎么工作的

运行：

```powershell
npm run app:dev
```

实际调用链：

```text
npm run app:dev
  -> tauri dev
     -> 执行 beforeDevCommand: npm run dev
        -> Vite 启动 http://localhost:5173
     -> Cargo 编译 Rust 开发版
     -> Tauri 创建桌面窗口
     -> WebView2 加载 http://localhost:5173
```

配置来自 `src-tauri/tauri.conf.json`：

```json
{
  "build": {
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev"
  }
}
```

开发时有两类热更新：

- 修改 React/CSS：Vite 通常立即刷新，不重新编译 Rust。
- 修改 Rust：Tauri 需要重新编译原生端并重启窗口。

因此日常 UI 开发仍然很接近普通 React 项目。

## 6. 发布版和 EXE 是怎么生成的

运行：

```powershell
npm run app:build
```

完整流程：

```text
1. tauri build
2. 执行 beforeBuildCommand: npm run build
3. TypeScript 类型检查
4. Vite 生成 dist/index.html、CSS 和 JavaScript
5. Cargo 以 release 模式编译 Rust
6. Tauri 将 dist 资源嵌入/关联到桌面程序
7. 生成 zhixu.exe
8. NSIS 把程序、资源和卸载逻辑封装成安装程序
```

当前输出：

```text
src-tauri/target/release/zhixu.exe
src-tauri/target/release/bundle/nsis/知序_0.1.0_x64-setup.exe
```

两者区别：

- `zhixu.exe` 是应用本体，可以直接运行，但不负责创建开始菜单和卸载信息。
- `知序_0.1.0_x64-setup.exe` 是安装程序，会按 Windows 应用的方式安装。

`target` 是 Rust 构建缓存目录，体积可能很大，可以删除后重新生成，不应提交到 Git。

## 7. React 如何调用桌面能力

当前项目使用 Tauri 官方插件，而不是自己编写 command。除 dialog、fs、sql 外，还使用 opener 插件通过系统默认程序打开知识源文件。

例如打开文件选择框：

```ts
import { open } from '@tauri-apps/plugin-dialog'

const selected = await open({
  multiple: false,
  filters: [{ name: 'Markdown', extensions: ['md'] }],
})
```

这里看起来是普通 TypeScript 函数，但它不是浏览器原生 API。大致过程为：

```text
React 调用 open()
  -> Tauri JavaScript binding
  -> IPC 消息
  -> Rust dialog 插件
  -> Windows 文件选择窗口
  -> 选择结果通过 IPC 返回 React
```

IPC 是 inter-process communication，即进程或运行环境之间传递消息的机制。

这也是安全边界：页面不能随意控制整个电脑，只能调用已经注册并授权的功能。

## 8. 权限为什么要单独配置

注册插件不等于允许前端使用插件。知序还在 `capabilities/default.json` 中声明了权限：

```json
{
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "sql:default"
  ]
}
```

需要同时满足三层条件：

```text
安装插件 -> Rust 注册插件 -> capability 授权 -> 前端才能调用
```

权限应遵循最小授权原则。例如只需要读取文本，就不应开放删除整个目录的权限。

当前配置中的 `csp` 是 `null`，方便第一版开发，但正式发布和加载外部内容前应配置 Content Security Policy，限制脚本、连接和资源来源。

## 9. SQLite 数据是怎么保存的

SQLite 不是一个需要单独启动的数据库服务。它把数据库保存在一个文件中：

```text
D:\KnowledgeOrder\database\zhixu.db
```

当前连接代码先由 Rust 解析开发目录或安装目录，再传给 SQL 插件：

```ts
const path = await invoke<string>('resolve_database_path')
const database = await Database.load(`sqlite:${path}`)
```

开发环境固定到项目根目录的 `database`，安装版优先使用程序旁边的 `database`。安装目录不可写时自动回退到 Tauri 应用数据目录。

首次打开数据库后创建表：

```sql
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  tag TEXT NOT NULL,
  collection TEXT NOT NULL,
  updated TEXT NOT NULL,
  read_time INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0
);
```

字段类型转换也需要留意：

```text
TypeScript boolean <-> SQLite INTEGER 0/1
TypeScript readTime <-> SQLite read_time
```

SQL 参数使用 `$1`、`$2` 等占位符：

```ts
await database.execute(
  'INSERT INTO notes (id, title) VALUES ($1, $2)',
  [note.id, note.title],
)
```

不要把值直接拼进 SQL 字符串。参数绑定能正确处理引号，并降低 SQL 注入风险。

### 当前实现的取舍

第一版保存时会删除全部行，再逐条插入当前笔记：

```text
DELETE FROM notes
INSERT note 1
INSERT note 2
...
```

这对少量本地笔记简单可用，但不是长期方案。数据量增长后应升级为：

- 新建笔记只执行 `INSERT`。
- 编辑只执行对应行的 `UPDATE`。
- 删除只执行对应行的 `DELETE`。
- 多步操作使用事务，避免中途失败留下不完整数据。
- 使用正式 migration 管理表结构版本。

## 10. 为什么浏览器模式还能运行

`src/storage.ts` 使用 `isTauri()` 判断当前环境：

```ts
if (!isTauri()) {
  localStorage.setItem('zhixu-notes', JSON.stringify(notes))
  return
}

await saveToDatabase(await getDatabase(), notes)
```

因此存在两条存储路径：

```text
npm run dev     -> 浏览器 -> localStorage
npm run app:dev -> Tauri  -> SQLite
```

好处是开发 UI 时可以只启动 Vite。要注意，两种模式的数据目前互不自动同步。

这层抽象也为云同步留出了位置。未来可以在本地写入成功后，将变更写入同步队列，再由云服务上传。

## 11. Markdown 导入导出流程

### 导入

```text
点击导入
  -> dialog.open 选择 .md
  -> fs.readTextFile 读取 UTF-8 文本
  -> 找到第一个一级标题作为笔记标题
  -> 其余文本作为正文
  -> 生成 Note
  -> 保存到 SQLite
```

### 导出

```text
点击导出
  -> 把当前笔记转换为 Markdown
  -> dialog.save 选择目标位置
  -> fs.writeTextFile 写入文件
```

当前导出是“所有笔记合并到一个 Markdown 文件”。未来可扩展为选择目录后每篇笔记生成一个文件，并复制附件。

## 12. 什么时候需要自己写 Rust command

官方插件已经覆盖当前需求，所以 Rust 代码很少。当出现以下需求时，适合写自定义 command：

- 复杂事务或批量数据库操作。
- 全文索引和本地搜索引擎。
- 附件哈希、去重和目录管理。
- 调用操作系统接口或现有 Rust 库。
- 敏感逻辑不希望放在页面代码中。

示例：Rust command 接收名字并返回文本。

```rust
#[tauri::command]
fn greet(name: String) -> String {
    format!("你好，{name}")
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("failed to run app");
}
```

React 调用：

```ts
import { invoke } from '@tauri-apps/api/core'

const message = await invoke<string>('greet', { name: '知远' })
```

参数名和类型必须对应。复杂对象通常用 Rust 的 `serde` 序列化：

```rust
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct CreateNoteInput {
    title: String,
    content: String,
}

#[derive(Serialize)]
struct CreateNoteResult {
    id: i64,
}
```

## 13. Windows 为什么需要 MSVC 和 WebView2

Tauri 在 Windows 上有两类外部基础设施：

- **MSVC + Windows SDK**：把 Rust 和 Windows 原生依赖链接成 `.exe`。
- **WebView2 Runtime**：显示 React 页面。

环境检查：

```powershell
npx tauri info
```

常见缺失信息：

```text
rustc: not installed
Cargo: not installed
Couldn't detect Visual Studio Build Tools
WebView2: not installed
```

这些是系统构建环境问题，不是 React 代码错误。

## 14. 本次接入实际经历了什么

本项目从普通 Vite React 项目接入 Tauri 的步骤如下：

1. 确认 Node 版本和现有前端构建错误。
2. 安装 Tauri JavaScript API、CLI 和三个插件。
3. 使用 `tauri init` 创建 `src-tauri`。
4. 安装 Rust stable 工具链。
5. 安装 Visual Studio Build Tools 的 C++ 工作负载和 Windows SDK。
6. 在 Rust Builder 中注册 dialog、fs、sql 插件。
7. 在 capability 中授予最小必需权限。
8. 编写 `storage.ts`，区分浏览器和桌面存储。
9. 创建 SQLite 表并实现笔记读写。
10. 接入 Markdown 打开、读取、保存和写入。
11. 运行前端构建、ESLint 和 `cargo check`。
12. 运行 Tauri release 构建。
13. 使用 NSIS 生成 Windows 安装程序。
14. 启动发布版，确认进程运行并创建 SQLite 文件。

打包期间曾遇到 NSIS 工具从 GitHub 下载超时。解决方式是手动下载官方 `nsis-3.11.zip`，放入 Tauri 本地工具缓存后重试。这个问题属于构建工具下载链路，不是应用代码问题。

## 15. 常用命令速查

```powershell
# 只开发 React 页面
npm run dev

# 开发完整桌面应用
npm run app:dev

# 检查前端
npm run lint
npm run build

# 检查 Rust
cargo check --manifest-path src-tauri/Cargo.toml

# 格式化 Rust
cargo fmt --manifest-path src-tauri/Cargo.toml

# 打包 Windows 安装程序
npm run app:build

# 查看完整 Tauri 环境
npx tauri info
```

## 16. 常见问题与定位方法

### `vite is not recognized`

项目依赖没有安装：

```powershell
npm install
```

### `cargo` 或 `rustc` 找不到

关闭并重新打开终端，让 PATH 生效，然后运行：

```powershell
rustup default stable
```

### 修改 React 后桌面没有变化

确认 `npm run app:dev` 中的 Vite 服务仍在运行，并检查端口 `5173` 是否被其他进程占用。

### 权限拒绝

按顺序检查：

1. npm 插件是否安装。
2. Cargo 插件依赖是否存在。
3. `lib.rs` 是否注册插件。
4. capability 是否授予对应权限。

### 数据库在哪里

Windows 开发环境当前路径：

```text
D:\KnowledgeOrder\database\zhixu.db
```

安装版优先位于 `<安装目录>\database\zhixu.db`，目录不可写时回退到 `C:\Users\你的用户名\AppData\Roaming\com.zhixu.desktop\zhixu.db`。不要在应用运行时随意覆盖数据库。做结构调整前先备份。

### 安装包提示未知发布者

当前安装包没有代码签名。正式对外发布时需要购买或申请 Windows 代码签名证书，并在构建流程中签名。

## 17. 推荐学习顺序

不要一开始钻研 Rust 所有权的全部细节。按项目需要逐步学习：

### 第一阶段：看懂当前项目

1. 运行浏览器版和桌面版。
2. 阅读 `tauri.conf.json`。
3. 阅读 `lib.rs` 的插件注册。
4. 从 `App.tsx` 的按钮追踪到 `storage.ts`。
5. 找到实际生成的 SQLite 文件。

### 第二阶段：掌握 Rust 基础

1. 变量、函数和模块。
2. `struct`、`enum`、`Option`、`Result`。
3. 借用 `&T` 与可变借用 `&mut T`。
4. `String` 和 `&str` 的区别。
5. `serde` 序列化。

### 第三阶段：写第一个 command

建议从“获取应用数据目录”或“统计笔记字数”开始，不要先迁移整个数据库层。

### 第四阶段：升级数据层

1. 把全量覆盖改成增删改查。
2. 加数据库 migration。
3. 加事务。
4. 为导入和同步设计稳定 UUID。
5. 增加备份与恢复。

## 18. 可操作练习

### 练习一：修改窗口

在 `tauri.conf.json` 中修改窗口宽高和最小尺寸，然后运行：

```powershell
npm run app:dev
```

观察哪些配置必须重启桌面端才生效。

### 练习二：新增 Rust command

实现 `count_characters(content: String) -> usize`，在 React 中调用并显示正文字符数。这个练习会覆盖 command、IPC、类型和返回值。

### 练习三：查看 SQLite

使用 SQLite 查看工具打开 `zhixu.db`，执行：

```sql
SELECT id, title, favorite FROM notes ORDER BY id DESC;
```

先只读查看，不直接修改生产数据。

### 练习四：改进 Markdown 导入

解析以下 front matter：

```markdown
---
tags: [Rust, Tauri]
collection: 产品与技术
---

# 标题

正文
```

可以使用成熟 Markdown/front matter 解析库，不建议长期使用正则手写完整解析器。

## 19. 当前项目下一步最值得做什么

从工程质量看，推荐顺序是：

1. 为笔记生成 UUID，避免跨设备同步时 `Date.now()` 冲突。
2. 将 SQLite 全量覆盖改成真正的 CRUD 和事务。
3. 增加数据库 migration 与自动备份。
4. 支持单篇 Markdown 导出和附件目录。
5. 配置 CSP。
6. 再设计云同步协议，而不是直接把数据库文件上传云端。

云同步应同步“变更记录或业务对象”，不应让多台设备直接覆盖同一个 SQLite 文件。每条数据至少需要稳定 ID、更新时间、版本号和删除标记，才能处理冲突。

## 20. 最后总结

理解知序桌面端，只需要抓住五条主线：

```text
React 负责界面
Vite 负责前端构建
Tauri 负责桌面窗口和安全桥梁
Rust 负责原生端与系统能力
SQLite 负责本地持久化
```

当前 Rust 代码很少不是缺点，而是因为已有官方 Tauri 插件覆盖了需求。等业务需要复杂事务、全文搜索、附件管理或云同步时，再把适合的逻辑逐步下沉到 Rust，学习成本和工程收益才匹配。
