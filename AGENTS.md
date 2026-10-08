# Repository Guidelines

## 项目结构与模块组织

- `apps/desktop-mobile/src/` 包含 React、TypeScript、CodeMirror 和 Cytoscape 前端。测试与源码放在一起，命名为 `*.test.ts` 或 `*.test.tsx`。
- `apps/desktop-mobile/src-tauri/` 是 Tauri 桌面壳。Rust 适配代码位于 `src/`，打包配置位于该目录的 Tauri 配置文件中。
- `crates/core/` 包含跨平台的笔记库、Markdown、搜索、图谱、恢复和 Git 逻辑；集成测试位于 `crates/core/tests/`。
- `crates/platform-windows/` 隔离 Windows 凭据和文件系统通知实现。
- `doc/` 保存技术方案与验收记录，`scripts/windows/` 保存 Windows 打包脚本。

## 构建、测试与开发命令

从仓库根目录运行：

```sh
npm ci                                      # 按锁文件安装前端依赖
npm run dev                                 # 启动浏览器前端
npm run tauri -- dev                        # 启动原生桌面应用
npm run build && npm test                   # 类型检查、打包并运行 Vitest
cargo test --workspace --locked             # 运行全部 Rust 测试
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all --check                     # 检查 Rust 格式
npm run tauri -- build --bundles app        # 构建 macOS 应用
npm run tauri -- build --bundles nsis       # 在 Windows 上构建安装包
```

使用 `npm run check` 快速检查前端和核心 Rust。macOS 上的交叉检查不能作为 Windows 运行验收结果。

Windows 上任何涉及 Rust 的命令都必须先在**当前 shell** 加载 MSVC 环境，否则 `INCLUDE` / `LIB` 为空，
编译 libgit2、sqlite 等 C 依赖时会报 `C1083: 无法打开包括文件 "time.h"`（并行构建下还可能把其他
crate 连带成 `STATUS_ACCESS_VIOLATION`，属于次生现象）：

```sh
source scripts/dev/msvc-env.sh      # Git Bash
```

```powershell
. .\scripts\dev\msvc-env.ps1        # PowerShell，注意开头的点和空格（dot-sourcing）
```

每个 shell 都要重新加载。首次运行会把结果缓存到 `scripts/dev/.vcenv`（已忽略）；升级 Build Tools
或 Windows SDK 后需删除该缓存重新生成。

## 编码风格与命名

Rust 使用 `rustfmt` 默认格式，并处理全部 Clippy 警告。Rust 模块和函数使用 `snake_case`，类型使用 `PascalCase`。TypeScript 组件使用 `PascalCase`，辅助函数使用 `camelCase`，采用两个空格缩进。共享逻辑放在 `mozhi-core`，系统 API 放在平台模块。逻辑路径始终使用 `/`。

## 测试规范

前端行为使用 Vitest；文件系统、同步、搜索和平台约束使用 Rust 测试。测试名应描述可观察行为，例如 `locked_and_readonly_files_preserve_disk_and_draft`。涉及数据丢失、路径穿越、凭据或同步的改动必须添加回归测试。平台测试使用 `#[cfg(...)]`，并在对应平台 CI 中执行。

## 提交与拉取请求规范

提交标题使用祈使语气的 Conventional Commits，例如 `feat: add Windows file watcher` 或 `fix: preserve CRLF on save`。每个提交聚焦单一目的。拉取请求应说明实际效果、影响平台、验证方式和剩余限制；关联相关 issue，界面改动附截图。禁止提交 Token、证书、安装产物、`node_modules/` 或 `target/`。

## 安全与配置

凭据必须保存在操作系统原生凭据库中，不得进入 WebView IPC、日志、Git URL 或配置文件。修改文件操作时，必须保留路径边界检查、链接拒绝、原子写入、草稿和冲突检测。签名密钥只能存放在受保护的 CI 环境中。
