# GitHub CI 与 Release

参考 siming 的手动版本发布流程。普通 CI 保留 macOS / Windows 上的前端构建、测试、Rust 测试、Clippy、格式检查、安装包和性能报告；Windows 还执行安装、覆盖安装、卸载测试。PR 仅有读取权限，不创建 Release。

## 首次配置

1. 将工作流和脚本合并到 GitHub 默认分支（本仓库 CI 默认 main）。
2. 启用仓库 Actions。Release 的 prepare 和 publish 两个 job 请求 `contents: write`；组织策略需允许该权限。
3. 默认分支规则需允许 GitHub Actions bot 提交版本准备 commit。若保护规则要求所有变更必须经 PR，应调整发布版本提交策略或提供规则例外；当前脚本遇到 push 拒绝会停止，不会绕过保护规则。
4. 不需要 PAT：使用 GitHub 提供的 `GITHUB_TOKEN`。默认生成未签名、未公证的包，不需要任何签名 Secret。

## 发布

GitHub → Actions → **Release** → **Run workflow**，选择默认分支，输入 `0.2.0` 或 `0.2.0-beta.1`（不要写 v）。

流程会：

1. 校验版本与 tag，更新 Cargo.toml、Cargo.lock、根目录及 app 的 package.json、package-lock.json 和 Tauri 配置；只改变本地包版本，不升级依赖。
2. 自动提交 `chore(release): prepare v…` 到默认分支，记录精确 commit。
3. 三个独立 runner 均检出该 commit，运行质量检查后生成安装包：

| Runner | 产物 |
| --- | --- |
| windows-2022 | `MoZhi-版本-windows-x64.exe`（NSIS） |
| macos-14 | `MoZhi-版本-macos-arm64.dmg` |
| macos-15-intel | `MoZhi-版本-macos-x64.dmg` |

4. 所有平台通过后，校验三份安装包齐全，生成 `SHA256SUMS.txt`，创建指向构建 commit 的 `v…` tag。
5. 创建 Draft Release、上传全部安装包和校验文件，最后转为公开 Release。带 `-beta.1`、`-rc.1` 等后缀的版本标为 Pre-release。Release notes 根据合并 PR 自动生成。

Windows 下载 WebView2 Bootstrapper 可能需要网络。SHA256SUMS 可用 `shasum -a 256 -c SHA256SUMS.txt` 校验（需三份包均在当前目录）。默认不包含自动更新服务、Linux 安装包、Apple 签名/公证或 Windows Authenticode 签名；未签名安装包可能出现 Gatekeeper / SmartScreen 提示。公开分发给普通用户前建议另行配置代码签名，签名密钥只能存放于受保护的 CI 环境。

Windows 安装器支持“当前用户”和“所有用户”两种安装范围。安装到 `C:\Program Files` 时选择“所有用户”，并允许管理员授权；“当前用户”应使用用户目录。旧版 `currentUser` 安装器不请求提权，手动选择 Program Files 可能出现“无法打开要写入的文件”。此时中止安装，关闭正在运行的墨知后，重新安装到用户目录，或改用支持所有用户安装的新包。Windows CI 分别测试用户目录和 Program Files 下的安装、覆盖安装和卸载；隔离 runner 必须具备管理员权限。

Windows 平台的 `productName` 为 `MoZhi`，安装器和卸载列表使用该名称。“当前用户”默认安装到 Windows 的用户程序目录，通常为 `%LOCALAPPDATA%\Programs\MoZhi`；“所有用户”默认安装到 `%ProgramFiles%\MoZhi`。应用窗口标题仍为“墨知”。NSIS 的 `both` 模式使用用户程序目录，与旧版仅 `currentUser` 模式的 `%LOCALAPPDATA%\MoZhi` 不同。CI 不通过 `/D` 覆盖目录，以检查真实默认路径。原有“墨知”安装记录不会自动迁移到新的产品名称，已安装旧版时应先退出并卸载旧版，再安装新版。

macOS 发布先用 Tauri 生成 `.app`，再由 `scripts/macos/build-dmg.sh` 使用 `hdiutil makehybrid` 和 `convert` 生成压缩 DMG，并执行 `hdiutil verify`。镜像包含应用和 Applications 快捷方式；不挂载可写镜像，不依赖 Finder AppleScript，也不设置自定义背景或图标位置。这用于避开托管 runner 上 `bundle_dmg.sh` 的失败路径。Vite 的 500 kB chunk 提示只是警告，与 DMG 打包失败无关。

macOS 默认使用 `signingIdentity: "-"` 对完整应用执行 ad-hoc 签名，并在制作 DMG 前检查签名与资源封印。仅有链接器签名的可执行文件不能替代完整 `.app` 签名，否则下载后可能出现“已损坏”提示。ad-hoc 签名不提供开发者身份或 Apple 公证，不能保证通过 Gatekeeper；面向普通用户分发仍需配置 Developer ID 签名与公证。`hdiutil verify` 只检查镜像完整性，不检查应用签名或公证状态。

## 失败与重试

- 任一构建失败，不创建 tag 或 Release；版本准备 commit 可能已经留在默认分支。优先用失败运行的 **Re-run failed jobs**，沿用相同源码。
- 上传失败可能留下 tag 和 Draft Release；重跑 publish 会核对 tag 指向的 commit，仅允许继续同一个草稿，不覆盖已公开版本。
- 已存在的版本 tag 不允许通过新的 Run workflow 重复发布；该版本发布后修改源码需使用新版本号。
- 若修复了工作流或打包脚本，需要合并修复后重新 **Run workflow**；旧运行的 **Re-run failed jobs** 仍使用原工作流和 prepare 记录的旧 commit，不会应用修复。失败版本尚未创建 tag 时，可再次输入同一版本号。
- 不并发发布；工作流使用全仓库 release concurrency。没有 force push、没有绕过 hooks 或分支保护。
- 流程本地验证不等于 GitHub runner 已执行成功；首次发布建议用 `0.1.1-beta.1` 验收三平台安装。

## 本地验证发布脚本

```sh
python3 -B -m unittest discover -s scripts -p test_release.py -v
# 以下需在干净工作区执行，仅校验，不修改版本：
python3 scripts/release.py --version 0.2.0 --check
```
