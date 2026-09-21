# 墨知 Mozhi

本地优先的 Markdown 笔记应用。当前为 **P2 Windows 适配候选版**，已实现本地笔记、搜索关系、Git 同步与冲突恢复。真实远程服务认证、中文输入法及发布验收仍需完成，Windows 适配代码、NSIS 配置和 CI 已落地，真机验收待完成，详见 [P2 实施与验收记录](doc/p2/实施与验收.md)。

## 启动与验证

要求 Rust stable、Node.js 22.12+。macOS 需 Xcode Command Line Tools；Windows x64 需 Visual Studio C++ Build Tools、Windows SDK 和 WebView2。

```sh
npm ci
npm run tauri -- dev
```

首次启动创建示例笔记；以后恢复最近打开的笔记库。侧栏「＋」选择目录。Git 同步推荐从「同步与恢复」克隆已有 HTTPS 仓库：填 URL、用户名、固定分支，通过原生密码框将 Token 存入 macOS Keychain 或 Windows 凭据管理器，再选择克隆位置。

```sh
npm run dev                 # 浏览器仅提供内存编辑演示，真实库操作需 Tauri
npm run build
npm test
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all --check
npm run tauri -- build --bundles app
cargo run --release -p mozhi-core --bin p0-probe -- 10000
```

Windows 打包运行 `npm run tauri -- build --bundles nsis`，产物位于 `target/release/bundle/nsis/`；当前采用手动安装包升级。

macOS 应用包位于 `target/release/bundle/macos/墨知.app`，未签名公证，不属于公开发布包。

## 功能

- 笔记与目录创建、重命名、移动、删除；UUID；删除/多文件改写前保留恢复副本。
- CodeMirror 6 源码、分栏、安全预览、自动保存、哈希冲突检查、恢复草稿、深浅主题。
- PNG/JPEG/GIF/WebP 图片导入（10 MiB 上限）、库内预览、附件重命名与引用改写；ZIP 库导出。
- TAG、目录、文件名与正文组合搜索；`tag:工作 path:项目 预算`；中文一字/二字补充索引。
- Markdown / Wiki 链接解析、反向链接、同名歧义与缺失提示；真实全局/局部图谱、筛选、双击打开、PNG 导出。
- HTTPS Git clone/commit/fetch/merge/push；固定分支；三方冲突选择/手动合并、附件保留双方、历史版本恢复。
- 库级进程锁、私有操作记录、同步中断恢复、启动/前台/手动核对及 5 秒元数据轮询；索引损坏隔离重建。

默认单篇笔记上限 2 MiB、单库 10000 篇；全局图谱最多 1000 节点/3000 边，局部最多 200 节点。图谱性能预算可保守调整。

## 工程与资料

- `apps/desktop-mobile/`：React 界面、Tauri commands、桌面凭据适配。
- `crates/platform-windows/`：Windows 原生凭据与文件通知。
- `crates/core/`：文件事务、Markdown、SQLite、关系查询、Git 状态处理。
- `tests/fixtures/`：中文样本。
- [技术方案](doc/Markdown笔记软件技术方案.md)
- [P0 验收记录](doc/p0/实施与验收.md)
- [P1 实施与验收记录](doc/p1/实施与验收.md)
- [P2 实施与验收记录](doc/p2/实施与验收.md)

Token 不进入前端、普通配置、日志或 Git URL；HTTPS 不跳过证书校验、不跟随跨站重定向。使用已有本地库同步前需具备 Git 仓库和已存在的配置分支；应用不自动合并无关历史。普通 Git 不等于独立备份，请定期导出。
