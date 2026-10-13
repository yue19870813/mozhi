# MoZhi（墨知）

**本地优先的 Markdown 笔记应用，通过 Git 同步，用链接与 AI 整理知识。**

笔记保存在自己的本地文件夹中，以 UTF-8 Markdown 书写。墨知提供编辑、搜索、标签、双向链接、知识图谱和恢复记录，可连接自己的 SSH Git 仓库，也可配置 OpenAI 兼容模型进行问答、总结、生成及优化笔记。

基于 **Tauri 2 · Rust · React 19 · TypeScript · CodeMirror 6 · SQLite · Cytoscape.js** 构建。本地语义检索使用 **FastEmbed / ONNX Runtime**，不需要另行部署模型服务。

仓库当前版本：**0.5.0**。源码版本不代表安装包已经发布，下载请查看 [GitHub Releases](https://github.com/yue19870813/mozhi/releases)。平台构建和人工验收范围见下文及对应文档。

## 功能

| 功能 | 说明 |
| --- | --- |
| 本地笔记库 | 打开已有目录；创建、重命名、移动、删除笔记和目录；最近打开记录与固定演示库入口 |
| Markdown 编辑 | 源码、分栏、预览；750 ms 自动保存、手动保存、草稿恢复、外部修改冲突检测 |
| 首页与置顶 | 最近笔记、置顶笔记；演示库展示「欢迎使用.md」使用指南 |
| 搜索与筛选 | 正文、文件名、标签和目录组合检索，支持 `tag:` / `path:` 及中文短词 |
| 双向链接 | Markdown 链接和 `[[Wiki 链接]]`，输入 `[[` 可按标题或路径补全并区分同名笔记；反向链接、出站链接及缺失目标提示 |
| 知识图谱 | 全局与局部一跳 / 两跳图谱，筛选、双击打开笔记、导出 PNG |
| 图片附件 | 导入 PNG、JPEG、GIF、WebP，库内预览及重命名引用更新 |
| Git 同步 | 当前界面仅提供 SSH；克隆、提交、获取、合并、推送，支持手动与自动同步、冲突处理 |
| AI 助理 | 笔记库问答、总结笔记、生成笔记、笔记优化；发送预览、来源引用、流式输出 |
| 应用内 MCP | 默认关闭；授权单个笔记库供 Codex、Claude Code 读取、查询、新建及云端问答，退出应用后停止 |
| 本地语义检索 | 可选下载多语言 INT8 模型，Markdown 全库增量向量索引，与关键词检索组合 |
| 恢复与导出 | 文件操作恢复副本、Git 版本历史、ZIP 导出 |
| 外观与语言 | 深浅主题，简体中文、繁體中文、English、日本語；设置底部提供「关于」 |

外部 AI 工具接入见 [MCP 服务指南](doc/mcp.md)，包括授权、访问令牌环境变量、客户端配置与常见错误。

## 平台与安装

| 平台 | 发布流程与要求 |
| --- | --- |
| macOS Apple Silicon | Release 工作流生成 ARM64 `.dmg`；已有本地默认运行库构建与合成文本推理验证 |
| macOS Intel | Release 工作流生成 x64 `.dmg`；ONNX Runtime 从源码构建并随应用打包，实际构建结果以 Intel CI 为准 |
| Windows x64 | NSIS `.exe`；依赖 WebView2，SSH 同步还需系统 OpenSSH Client 和 Agent |
| 浏览器 | 内存演示；不访问真实本地笔记库、系统凭据或本地模型，刷新后演示编辑不保留 |
| Linux / Android / iOS |  暂未发布|

Release 工作流收齐三个平台的安装包后才发布，并提供 `SHA256SUMS.txt`。macOS 默认对完整应用执行 **ad-hoc 签名**，不包含 Developer ID 签名或 Apple 公证；Windows 默认无 Authenticode 签名。系统可能提示无法验证开发者。尚未启用自动更新，升级时先退出应用，再安装新版。

Windows 安装器支持当前用户与所有用户两种范围：用户安装通常位于 `%LOCALAPPDATA%\Programs\MoZhi`；所有用户安装位于 `%ProgramFiles%\MoZhi`，需要管理员授权。安装时若需要下载 WebView2，须有网络；离线安装前应预装 WebView2。

## 使用入门

### 打开与切换笔记库

首次启动进入演示笔记库，首页的「欢迎使用.md」介绍基本操作和首次同步。切换到自己的库后，不再展示这个演示指南入口。

侧栏「打开笔记库」可选择自己的目录；「设置 → 笔记库」保留最近打开的记录和默认演示库，方便切换。移除打开记录不会删除文件。在「我的笔记」中创建笔记和目录。

建议使用普通本地目录；Windows 云占位目录和网络盘不属于当前支持范围。笔记正文与附件在笔记目录中，索引、置顶、恢复数据等应用私有状态保存在本机。

### 编辑、链接与搜索

编辑器支持「源码」「分栏」「预览」。停止输入约 750 ms 后自动保存，也可手动保存；外部修改、未恢复草稿或写入失败按提示处理。

笔记工具栏的「大纲」显示当前正文中的 Markdown 标题，点击可跳转到源码与预览的对应位置；同一侧栏也可切换到「关联信息」。

编辑器顶部的「查找与替换」可查找当前笔记、跳转匹配、逐个或全部替换，支持区分大小写、全词匹配和正则表达式。替换可撤销，并沿用自动保存；只读时仅允许查找。Markdown 预览中的 HTTP/HTTPS 网页链接通过系统默认浏览器打开，库内笔记链接仍在墨知中打开。

```markdown
---
tags: [学习, 知识管理]
---

# 我的知识库

今天阅读了 [[读书笔记]]。

相关资料：[项目计划](项目计划.md)
```

新建笔记自动生成 UUID。已有笔记的 `id` 用于身份识别，建议保留，避免重复或随意修改。常用笔记可在工具栏或笔记列表右键菜单置顶；置顶按库保存在本机，不进入 Git，在应用内移动或重命名时跟随更新。

搜索支持关键词与标签、目录组合，也可使用「仅文件名」筛选：

```text
知识图谱
tag:工作
path:项目 预算
tag:工作 path:项目 预算
```

| 操作 | macOS | Windows |
| --- | --- | --- |
| 搜索笔记 | `⌘ K` | `Ctrl K` |
| 新建笔记 | `⌘ N` | `Ctrl N` |
| 保存当前笔记 | `⌘ S` | `Ctrl S` |
| 当前笔记查找 | `⌘ F` | `Ctrl F` |
| 当前笔记替换 | `⌘ ⌥ F` | `Ctrl H` |
| 下一个 / 上一个匹配 | `⌘ G` / `⌘ ⇧ G` | `F3` / `Shift F3` |

「设置 → 外观 → 语言」可随时切换四种语言。首次启动按系统语言选择：繁体中文（台湾、香港、澳门或 zh-Hant）使用繁体中文，其他中文使用简体中文，日文使用日文，其余使用英文；已有选择优先。切换界面语言不会翻译或改写笔记内容。

### 首次配置 SSH 同步

**使用墨知不需要安装 Git 命令行工具**：Git 操作由内置 libgit2 实现。SSH 密钥加载使用系统 OpenSSH。HTTPS 同步暂时在界面中隐藏，旧 HTTPS 配置需改为 SSH 地址；无需为 Git 同步配置 Token。

1. 在 GitHub 等服务创建仓库。建议先添加 README，确保仓库已有提交和默认分支，避免直接克隆完全空的仓库。
2. 准备 SSH 密钥，将 `.pub` 公钥添加到远端账户的 SSH Authentication Keys；私钥和密码留在本机，不放入笔记库。
3. 在「设置 → 同步」填写 SSH 地址和实际分支名，例如 `main`：
   ```text
   git@github.com:YOUR_NAME/my-notes.git
   ssh://git@github.com/YOUR_NAME/my-notes.git
   ```
4. 点击「选择 SSH 密钥」，选择私钥文件，**不是 `.pub`**。加密私钥通过原生安全输入框输入密码；随后「检查 SSH Agent」确认已加载密钥。Agent 检查不等于远端仓库权限验证。
5. 保存设置，在「克隆已有仓库」中选择父目录和新笔记库名称，点击「选择位置并克隆」。如使用已有本地库，该目录须已经是 Git 仓库且分支存在；应用不会自动合并无关历史。
6. 点击主界面右上角同步按钮或设置中的「立即同步」，完成本地提交、获取、合并与推送。

**macOS**：可在终端生成密钥并复制公钥；已有密钥时不要覆盖。

```sh
ssh-keygen -t ed25519 -C "your-email@example.com"
pbcopy < ~/.ssh/id_ed25519.pub
# 如果墨知提示私钥权限不正确：
chmod 600 ~/.ssh/id_ed25519
```

选择私钥时，可在文件选择器按 `⌘ ⇧ G` 输入 `~/.ssh/`，选择 `id_ed25519`（自定义文件名时替换路径）。

**Windows**：在「可选功能」确认已安装 OpenSSH Client。首次使用，在管理员 PowerShell 启用 Agent：

```powershell
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service -Name ssh-agent
```

再回到普通 PowerShell，用日常账户生成密钥并复制公钥：

```powershell
ssh-keygen -t ed25519 -C "your-email@example.com"
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | Set-Clipboard
```

将公钥添加到远端账户后，在墨知选择 `%USERPROFILE%\.ssh\id_ed25519`。只安装 Git for Windows 不代表系统 OpenSSH Agent 已准备好。完整分平台教程也在应用「帮助 → 使用入门」中。

### 手动、自动同步与冲突

同步期间可以切换模块、浏览、搜索及预览笔记，笔记暂时只读；文件修改、重复同步和切库被禁止。保存前置阶段与最终刷新可能短暂进入忙碌状态。冲突发生后，对照共同祖先、本地和远端内容，选择版本或手动合并；附件冲突支持保留双方。

「设置 → 同步 → 自动同步」按库启用，**默认关闭**。支持打开库时同步、保存后空闲同步（默认 30 秒）和周期同步（默认 5 分钟）。周期同步也会合并、推送，并非只检查更新。仅在应用前台、无编辑/组合输入或阻塞弹窗时执行；失败或冲突后暂停，处理问题并手动同步成功后恢复。设置只保存在本机。

## AI 助理

### 配置云端回答模型

「设置 → AI 模型」配置 Base URL 和模型名称，保存后点击「设置 API Key」，在原生安全输入框输入。模型需支持 OpenAI 兼容的流式 **`/chat/completions`** 接口；用户填写的路径前缀会保留，例如 `https://example.com/api/v1`。

云端地址必须为 HTTPS；本机回环 HTTP 服务允许不填 Key。「测试连接」仅发送固定测试文本，不发送笔记。

| 模式 | 使用方式 |
| --- | --- |
| 笔记库问答 | 输入问题，自动检索相关片段，可调整关键词、手动补选笔记；回答附实际来源链接 |
| 总结笔记 | 选择当前或多篇笔记；也可从笔记工具栏「AI 总结」进入 |
| 生成笔记 | 输入要求并选择参考笔记，编辑结果后选目录和文件名保存为新笔记 |
| 笔记优化 | 单选目标笔记并填写要求，对照原文与结果，编辑后确认应用到原笔记或另存 |

默认逐次预览实际发送内容并确认，也可授权当前笔记库自动发送，随时撤销；服务地址变化后需重新授权。普通上下文最多 10 篇、合计 24,000 个字符；关键词上下文每篇最多开头 6,000 字符，语义命中优先使用相关正文范围。问答不会一次性将整库发送给云端，也不发送附件。

「笔记优化」只发送目标笔记完整正文及本次要求，不携带其他笔记或聊天记录；正文超过 24,000 个 Unicode 字符会拒绝请求，提示拆分。仅成功完成的非空结果可应用或保存；应用到原笔记须确认，保留原 front matter，并检查生成后原文是否变化以及恢复草稿冲突。AI 不会自动改写文件。

对话仅保留当前应用会话，按笔记库隔离；优化结果与其他模式隔离。支持清空、停止生成和手动重试。新笔记使用独立 UUID，拒绝覆盖，并进入正常索引及 Git 同步流程。

API Key 保存在独立系统凭据条目（macOS Keychain / Windows 凭据管理器），不进入 WebView IPC、日志、普通配置或笔记库。Rust 发起请求并校验 TLS、拒绝重定向，连接超时 10 秒、总超时 120 秒。钥匙串拒绝访问时显示安全的系统错误码；开发版重新编译可能需要重新授权访问。

### 可选：Markdown 全库本地语义检索

在「设置 → AI 模型 → 本地语义检索」：

1. 下载多语言 MiniLM INT8 模型和分词器，首次约 **129 MiB**；可选 Hugging Face 或 hf-mirror.com。
2. 为当前笔记库启用语义检索，点击「更新索引」。
3. 在「笔记库问答」中提问，自动组合语义与关键词结果，再按现有授权规则请求回答模型。

向量计算在本机 CPU 上完成，无需 Ollama、Python 或独立服务。模型首次另行下载，不随安装包携带；推理运行库随应用提供。模型和每库 SQLite 索引保存在应用私有目录，不进入 Git。启用后每 20 秒后台检查新增、修改、删除及同步后的变化，支持停止、继续和重建。

建立索引不发送笔记；**问答时选出的片段仍会发送给配置的云端模型**。本地向量化不等于云端模型能自动读取整个笔记库。首版仅索引 Markdown 正文，不处理 PDF、Word 或附件，采用精确余弦检索，适合个人库。详见 [本地语义检索说明](doc/local-semantic-search.md)。

## 恢复、备份与边界

「设置 → 恢复记录」可查看文件操作前副本，并恢复到新目录，避免覆盖后续修改。默认保留 **30 天、1 GiB、1,000 条**，按库可调；最近 24 小时、未完成或异常记录受保护，可能暂时超限。清理不影响自动保存草稿或 Git 历史。

ZIP 导出不包含 `.git` 和隐藏私有文件。同步与恢复记录不能替代独立备份，建议定期导出到其他位置。

文件操作使用路径边界检查、链接拒绝、原子写入、内容哈希核对和草稿保护；索引损坏可隔离重建。SSH 密钥由系统 Agent 使用，应用不保存私钥内容、密码或所选路径。

当前限制：单篇笔记 **2 MiB**、单库 **10,000 篇**、导入图片 **10 MiB**；全局图谱最多 **1,000 节点 / 3,000 边**，局部图谱最多 **200 节点**。长耗时建库和 Git 网络同步尚无用户取消入口；AI 生成、模型下载和语义索引提供停止入口。

## 本地开发与验证

### 开发环境

- Node.js **22.12+**、npm、Rust stable（建议与 CI 保持一致）。
- macOS：Xcode Command Line Tools。
- Windows：Visual Studio 2022 Build Tools（C++ 桌面开发与 Windows SDK）、Rust MSVC 工具链、WebView2。vendored OpenSSL 编译还需原生 Perl（如 Strawberry Perl），可通过 `OPENSSL_SRC_PERL` 指定；Git 自带的 Cygwin Perl 不适用。
- 首次 Rust 构建会下载 ONNX Runtime。CDN 不可达可能让 `ort-sys` 长时间等待，这与首次在界面下载 Embedding 模型是两件事。

以下命令在仓库根目录执行：

```sh
npm ci
npm run tauri -- dev       # 原生桌面应用
npm run dev               # 仅浏览器演示
```

Windows 执行任何 Rust 命令前，都需在**当前 shell**加载 MSVC 环境：

```sh
# Git Bash
source scripts/dev/msvc-env.sh
```

```powershell
# PowerShell，注意开头的点和空格
. .\scripts\dev\msvc-env.ps1
```

升级 Build Tools / SDK 后删除 `scripts/dev/.vcenv` 缓存，再重新加载。

```sh
npm run check             # 前端构建、Vitest、核心 Rust 测试
npm run build
npm test
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all --check
npm run probe -- 10000     # 一万篇笔记性能探针
```

前端测试与源码同目录，Rust 集成测试位于 `crates/core/tests/`。真实远端认证、原生凭据、输入法和安装行为需在对应平台验收；本地测试或跨编译不能代替 Windows / Intel CI 和真机运行。AI 测试使用合成数据，不应自动发送用户笔记。

### 打包

Apple Silicon macOS 和 Windows 分别执行：

```sh
npm run tauri -- build --bundles app -- --locked
npm run tauri -- build --bundles nsis -- --locked
```

macOS 应用在 `target/release/bundle/macos/墨知.app`，Windows 安装包在 `target/release/bundle/nsis/`。Release 使用 [DMG 脚本](scripts/macos/build-dmg.sh)制作 macOS 镜像并验证完整应用签名。

**Intel macOS 需要额外构建 ONNX Runtime**，普通 Cargo 构建无法下载该平台的预编译库。Release 已集成 [Intel 构建脚本](scripts/macos/build-onnx-intel.sh)。本地 Intel Mac 可按以下方式复用（需 Python 3.12 和 Git，Git 在这里用于拉取运行库源码，不是应用使用要求）：

```sh
bash scripts/macos/build-onnx-intel.sh
mozhi_runtime_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mozhi-onnx-intel"
export ORT_LIB_PATH="$mozhi_runtime_root/lib"
export ORT_PREFER_DYNAMIC_LINK=1
export DYLD_LIBRARY_PATH="$mozhi_runtime_root/lib"
npm run tauri -- build --bundles app \
  --config "$mozhi_runtime_root/tauri-onnx-intel.json" -- --locked
```

脚本的 `GITHUB_ENV` 导出只在 CI 生效，本地需自行设置上述环境变量；使用已编译运行库启动开发版时也需这些变量。首次源码构建耗时较长，实际 Intel 发布验收以 CI 为准。

## 项目结构与文档

```text
mozhi/
├── apps/desktop-mobile/
│   ├── src/                  # React、编辑器、图谱、AI 与设置
│   └── src-tauri/            # 原生接口、凭据、模型推理、打包
├── crates/
│   ├── core/                 # 笔记库、搜索、向量索引、恢复与 Git
│   └── platform-windows/     # Windows 凭据、SSH Agent 与文件通知
├── tests/fixtures/           # 验证样本
├── scripts/                  # 开发环境、Release 与平台打包脚本
├── .github/workflows/        # CI 与 Release
└── doc/                      # 方案及阶段验收记录
```

- [GitHub CI 与 Release](doc/release.md)
- [本地语义检索](doc/local-semantic-search.md)
- [同步交互](doc/acceptance/background-sync.md)
- [AI 首版验收](doc/acceptance/ai-assistant.md)
- [界面语言](doc/acceptance/languages.md)
- [恢复副本保留策略](doc/acceptance/recovery-retention.md)
- [技术方案](doc/Markdown笔记软件技术方案.md)
- [P0](doc/p0/实施与验收.md)、[P1](doc/p1/实施与验收.md)、[P2](doc/p2/实施与验收.md) 历史实施记录
- [仓库协作规范](AGENTS.md)

阶段验收文档记录当时的范围与测试数量，不代表当前全部功能的最新状态。欢迎提交问题与改进建议；提交遵循 Conventional Commits，PR 说明行为、平台、验证与限制，界面改动附截图。文件操作、同步、凭据和数据恢复改动须包含回归测试。
