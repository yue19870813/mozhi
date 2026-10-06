# MoZhi（墨知）

**本地优先的 Markdown 笔记应用，让记录沉淀为相互连接的知识。**

墨知将笔记保存在本地文件夹中，以 Markdown 书写，通过标签、双向链接和知识图谱整理内容，并可使用自己的 Git 仓库同步。适合个人知识管理、学习记录和项目资料整理。

基于 **Tauri 2 · Rust · React 19 · TypeScript · CodeMirror 6 · SQLite · Cytoscape.js** 构建。

> 当前版本为 `0.1.0`，处于桌面 MVP / Windows 适配候选阶段。核心功能已有实现与自动化测试，真实远程服务认证、系统中文输入法、Windows 真机及正式发布验收仍待完成，详见 [P1](doc/p1/实施与验收.md) 与 [P2](doc/p2/实施与验收.md) 记录。

## 功能亮点

| 功能 | 说明 |
| --- | --- |
| 本地笔记库 | 打开本地文件夹，创建、重命名、移动和删除笔记与目录；启动时恢复最近打开的笔记库 |
| Markdown 编辑 | 源码、分栏、预览三种模式；750 ms 自动保存、手动保存、草稿恢复与深浅主题 |
| 搜索与筛选 | 组合搜索正文、文件名、标签和目录，支持 `tag:` / `path:` 语法及中文一字、二字检索 |
| 双向链接 | 解析 Markdown 链接与 `[[Wiki 链接]]`，展示反向链接、出站链接、目标缺失及同名歧义 |
| 知识图谱 | 全局图谱与局部一跳 / 两跳关系，按标签、目录和关键词筛选，双击打开笔记，导出 PNG |
| 图片附件 | 导入 PNG、JPEG、GIF、WebP 并在库内预览；重命名附件时更新引用 |
| Git 同步 | HTTPS 或 SSH 克隆，固定分支提交、获取、合并与推送；文本冲突对照和手动合并，附件冲突可保留双方 |
| 恢复与导出 | 删除、移动及引用改写前保留恢复副本；查看 Git 版本历史，将笔记库导出为 ZIP |

## 平台与安装

| 平台 | 当前状态 |
| --- | --- |
| macOS Apple Silicon / Intel | 桌面实现与构建流程已配置；已有 Apple Silicon 本地验证记录，完整发布验收待完成 |
| Windows 10 / 11 x64 | 原生凭据、文件通知、NSIS 安装与 CI 流程已实现，Windows 真机验收待完成 |
| 浏览器 | 提供内存演示；本地文件读写、Git 同步和恢复管理需在 Tauri 桌面应用中使用 |
| Linux / Android / iOS | 当前未提供经过验收的发布包 |

仓库的 Release 工作流可生成 macOS `.dmg`、Windows `.exe` 和 `SHA256SUMS.txt`。已发布版本可在仓库的 **Releases** 页面查看，发布流程见 [CI 与 Release 指南](doc/release.md)。

当前默认构建产物未签名、未公证，安装时可能出现 Gatekeeper 或 SmartScreen 提示。升级采用退出应用后下载新安装包、覆盖安装的方式，尚未启用自动更新。

## 使用入门

### 1. 打开笔记库

首次启动会创建示例笔记。点击侧栏的「打开笔记库」，选择本地文件夹，即可使用自己的 Markdown 文件；也可以在「设置 → 笔记库」中切换或导出笔记库。

在「我的笔记」中新建笔记和目录。笔记采用 UTF-8 Markdown，逻辑路径使用 `/`；建议使用普通本地目录，Windows 云占位目录和网络盘暂不属于当前支持范围。

### 2. 书写并连接笔记

在编辑区切换「源码」「分栏」「预览」。输入停止后自动保存；遇到磁盘外部修改或保存失败时，按界面提示协调版本与草稿。

标签在文件开头的 YAML front matter 中使用数组定义，正文可通过 Wiki 或 Markdown 链接引用其他笔记：

```markdown
---
tags: [学习, 知识管理]
---

# 我的知识库

今天阅读了 [[读书笔记]]，整理了几个值得继续探索的问题。

相关资料：[项目计划](项目计划.md)
```

新建笔记会自动生成 UUID；编辑已有笔记的 front matter 时保留其中的 `id` 字段。创建链接目标后，可在关联信息中查看反向链接，也可进入「知识图谱」探索笔记关系。

常用笔记可点击工具栏的「置顶笔记」，或通过笔记列表右键菜单置顶。置顶笔记显示在首页和笔记侧栏，可随时「取消置顶」。置顶设置按笔记库保存在本机，重启后保留，不参与 Git 同步；在应用内重命名或移动笔记时会保留置顶状态。

### 3. 搜索与定位

在搜索框输入关键词，或组合标签和目录条件：

```text
知识图谱
tag:工作
path:项目 预算
tag:工作 path:项目 预算
```

也可以使用侧栏的标签、目录及「仅文件名」筛选。

| 操作 | macOS | Windows |
| --- | --- | --- |
| 搜索笔记 | `⌘ K` | `Ctrl K` |
| 新建笔记 | `⌘ N` | `Ctrl N` |
| 保存当前笔记 | `⌘ S` | `Ctrl S` |

### 4. 配置 Git 同步

进入「设置 → 同步」，填写仓库地址、用户名和固定分支。

- **HTTPS**：使用 `https://host/user/notes.git` 形式的地址，通过原生密码框设置 Token。凭据存入 macOS Keychain 或 Windows 凭据管理器。
- **SSH**：使用 `ssh://git@host/user/notes.git` 形式的地址。macOS 可点击「选择 SSH 密钥」，选择已有私钥加载到系统 Agent；加密私钥通过系统密码对话框输入密码。「检查 SSH Agent」显示已加载的密钥数量，不验证仓库权限。其他平台需通过系统 `ssh-add` 加载密钥。墨知不保存私钥、密码或所选路径；密钥应具备仓库访问权限。

推荐从「克隆已有仓库」开始：填写配置后，选择父目录和新笔记库名称，完成克隆。使用已有本地库同步时，该目录需要已经是 Git 仓库，且配置的分支已存在；应用不会自动合并无关历史。

点击「保存设置」后，使用「立即同步」提交本地内容、获取远程修改、合并并推送。同步期间编辑器暂时只读；发生冲突时，可对照共同祖先、本地和远程版本，选择一方或手动合并，再保存决议。

当前同步由用户手动触发，尚未提供定时自动同步。

### 5. 恢复与备份

「设置 → 恢复记录」可查看文件操作前的副本，并将其恢复到新目录，避免覆盖后续修改。默认保留策略为 **30 天、1 GiB、1,000 条**，可按笔记库调整；最近 24 小时、未完成或异常记录受保护，因此可能暂时超出限制。

保留策略仅用于操作恢复副本，自动保存草稿和 Git 历史不属于清理范围。具体规则见 [恢复副本保留策略](doc/acceptance/recovery-retention.md)。

笔记库 ZIP 导出不包含 `.git` 或隐藏私有文件。Git 同步与操作恢复副本不能替代独立备份，建议定期导出并保存到其他位置。

## 本地开发

### 环境要求

- Node.js **22.12+** 与 npm。
- Rust **stable** 工具链。
- macOS：Xcode Command Line Tools。
- Windows：Visual Studio 2022 Build Tools（Desktop development with C++、Windows SDK）、Rust MSVC 工具链及 WebView2 Evergreen Runtime。

以下命令均在仓库根目录执行。

### 启动

```sh
# 安装锁定版本的前端依赖
npm ci

# 启动原生桌面应用
npm run tauri -- dev
```

仅调试前端时可运行：

```sh
npm run dev
```

浏览器演示使用内存数据，刷新后不会保留编辑内容；完整功能需通过桌面应用体验。

### 构建与检查

```sh
# 快速检查：前端构建、Vitest、核心 Rust 测试
npm run check

# 完整检查
npm run build
npm test
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all --check

# 一万篇笔记性能探针
npm run probe -- 10000
```

前端测试与源码放在一起，命名为 `*.test.ts` / `*.test.tsx`；Rust 集成测试位于 `crates/core/tests/`。平台行为需在对应操作系统验证，macOS 上的交叉检查不能代替 Windows 运行验收。

### 打包

在目标操作系统上执行：

```sh
# macOS
npm run tauri -- build --bundles app

# Windows
npm run tauri -- build --bundles nsis
```

macOS 应用包位于 `target/release/bundle/macos/墨知.app`；Windows 安装包位于 `target/release/bundle/nsis/`。Windows 首次安装如需下载 WebView2，则需要网络；离线安装前应预装 WebView2。

## 项目结构

```text
mozhi/
├── apps/desktop-mobile/
│   ├── src/                  # React 界面、编辑器、预览与图谱
│   └── src-tauri/            # Tauri 桌面壳、原生命令与打包配置
├── crates/
│   ├── core/                 # 笔记库、Markdown、搜索、关系、恢复与 Git
│   └── platform-windows/     # Windows 凭据与文件系统通知
├── tests/fixtures/           # 中文笔记与验证样本
├── scripts/                  # 发布脚本与 Windows 打包辅助脚本
├── .github/workflows/        # CI 与 Release 工作流
└── doc/                      # 技术方案、实施与验收记录
```

## 数据保护与当前边界

文件操作保留路径边界检查、链接拒绝、原子写入、内容哈希核对与草稿恢复；移动或删除前记录恢复副本，索引损坏时可隔离重建。Token 不进入 WebView IPC、普通配置、日志或 Git URL；SSH 通过系统 Agent 使用密钥，应用不读取或保存私钥。

当前容量与功能边界：

- 单篇笔记上限 **2 MiB**，单库上限 **10,000 篇**。
- 单张导入图片上限 **10 MiB**。
- 全局图谱最多 **1,000 个节点 / 3,000 条边**，局部图谱最多 **200 个节点**。
- 长耗时建库及网络同步暂未提供用户取消入口。
- 系统中文输入法、真实远程 Git 服务、Windows 真机、图谱性能及签名发布仍需补充人工验收。

## 文档与贡献

- [技术方案](doc/Markdown笔记软件技术方案.md)
- [P0 实施与验收](doc/p0/实施与验收.md)
- [P1 macOS MVP 实施与验收](doc/p1/实施与验收.md)
- [P2 Windows 适配实施与验收](doc/p2/实施与验收.md)
- [恢复副本保留策略](doc/acceptance/recovery-retention.md)
- [CI 与 Release 指南](doc/release.md)
- [仓库协作规范](AGENTS.md)

欢迎提交问题和改进建议。提交改动前请执行相关检查，提交标题遵循 Conventional Commits；PR 请说明实际效果、影响平台、验证方式与剩余限制，界面改动附截图。涉及文件操作、同步、凭据或数据恢复的修改应包含回归测试。
