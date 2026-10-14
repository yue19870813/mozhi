# 应用内 MCP 服务

墨知运行时，Codex、Claude Code 等 MCP 客户端可以通过 Streamable HTTP 访问明确授权的笔记库。关闭主窗口后应用留在菜单栏或系统托盘，MCP 服务继续运行；从托盘退出应用后服务停止。默认关闭，不安装独立后台服务，也不会自动修改客户端配置。

## 启用与权限

1. 打开要授权的笔记库，在「设置 → MCP 服务」设置端口（默认 `37891`）。
2. 勾选启用和读取权限，按需选择「允许直接新建笔记」及「允许 MCP 云端问答」，然后保存。保存明确授权当前库；每次只开放一个库。
3. 点击「查看 / 复制访问令牌」，从原生窗口复制到客户端进程的 `MOZHI_MCP_TOKEN` 环境变量。令牌保存在系统凭据库，不会通过 WebView 返回。
4. 配置客户端并连接 `http://127.0.0.1:37891/mcp`。修改端口后同步修改客户端地址。

切到其他库时服务暂停访问，正在执行的问答取消；切回授权库后恢复。关闭、重新保存权限或轮换令牌会使旧会话失效。模型地址、名称或凭据变化后，云端问答需重新授权；此授权独立于界面 AI 的自动发送授权。

## Codex

在 `~/.codex/config.toml` 添加（使用自定义端口时更改 URL）：

```toml
[mcp_servers.mozhi]
url = "http://127.0.0.1:37891/mcp"
bearer_token_env_var = "MOZHI_MCP_TOKEN"
```

## Claude Code

在客户端使用的 `.mcp.json` 中合并：

```json
{
  "mcpServers": {
    "mozhi": {
      "type": "http",
      "url": "http://127.0.0.1:37891/mcp",
      "headers": { "Authorization": "Bearer ${MOZHI_MCP_TOKEN}" }
    }
  }
}
```

客户端必须继承环境变量；从 Finder、开始菜单或其他父进程启动的客户端可能无法继承终端变量。请按客户端自身的环境配置方式设置，重启客户端后连接。不要把真实令牌提交到 Git、写入笔记或放进 URL。示例中只有环境变量占位符。

## 工具

先调用 `get_vault_info` 获取 `vaultId`。其余工具必须显式传入该 ID；不会自动选择界面当前库。

| 工具 | 参数与行为 |
| --- | --- |
| `get_vault_info` | 返回授权库 ID、名称、可访问状态、读取／新建／问答能力；不返回绝对路径 |
| `list_notes` | `vaultId`，可选 `directory`、`tag`、`offset`、`limit`；按路径排序，默认 50、上限 200 |
| `search_notes` | `vaultId`、`query`，可选 `mode: keyword / hybrid`、`limit`；返回片段及实际检索模式 |
| `read_note` | `vaultId`、`path`；返回磁盘 Markdown、正文、元数据、内容哈希 |
| `create_note` | `vaultId`、`path`、`body`，可选 `tags`；仅新建，返回路径、UUID、哈希及可选索引警告 |
| `ask_notes` | `vaultId`、`question`；检索已保存笔记，调用设置的模型，返回完整 Markdown 回答与实际来源 |

路径用 `/`，相对于笔记库，只能访问非隐藏 Markdown 文件。新建的父目录必须已经存在。不提供覆盖、删除、目录创建、附件、Git 操作或命令执行。

读取**不会自动保存编辑器**，未保存内容不会成为问答来源。新建不会覆盖当前草稿；同步或待解决冲突期间拒绝写入。写入成功但索引失败返回成功和 `indexWarning`，不要因此重复创建。界面刷新及本地向量索引由已有机制更新，自动同步遵循用户设置。

问答独立于界面聊天记录，每次最多 10 篇、24,000 个 Unicode 字符，来源包含实际片段与截取标志。只发送本次问题和选取的文本，不发送附件、完整笔记库或绝对路径。笔记被当作参考数据，不执行其指令。与界面生成共享单任务限制，网络等待不占用笔记库锁。连接超时 10 秒，总请求超时 120 秒，限制响应大小，不自动重试。HTTPS 与本机 HTTP 规则沿用 AI 配置。

## 常见问题

| 状态／错误码 | 处理 |
| --- | --- |
| 端口不可用 | 关闭占用该端口的服务或修改端口；墨知不会自动换端口 |
| HTTP 401 | 检查 Bearer 令牌、环境继承；轮换后更新客户端并重新连接 |
| HTTP 403 | 拒绝网页 Origin、非本机 Host 或重复 Host；使用原生 MCP 客户端 |
| `PERMISSION_DENIED` | 在设置中授权对应能力；模型变化后重新授权问答 |
| `VAULT_CHANGED` | 切回授权库，用 `get_vault_info` 检查 ID，不重用其他库 ID |
| `NOT_FOUND` / `INVALID_PATH` | 使用库内已有 Markdown 相对路径，不使用隐藏文件或链接 |
| `ALREADY_EXISTS` / `DRAFT_CONFLICT` | 换新文件名，或在界面处理恢复草稿；不会覆盖 |
| `SYNC_BLOCKED` | 等待同步完成或在界面处理冲突 |
| `MODEL_CONFIG` / `MODEL_CREDENTIALS` | 检查 AI 设置和系统凭据库权限 |
| `NO_CONTEXT` / `BUSY` / `RATE_LIMITED` / `TIMEOUT` / `CANCELLED` | 调整检索问题、停止其他生成或待问题解决后手动重试 |
| `OPERATION_FAILED` | 在墨知中检查本地状态；MCP 不返回原始服务错误、凭据或本地绝对路径 |

## 分层与验证范围

`crates/mcp` 定义工具、校验、MCP 协议与 HTTP 安全边界，只依赖可注入的 `Backend`。桌面适配实现授权和文件／模型服务，不通过 Tauri 命令模拟调用。上下文准备与模型请求由界面 AI 和 MCP 共用。以后可在独立宿主中实现同一后端接口。

自动测试使用临时合成笔记与模拟模型，覆盖真实 HTTP 初始化、工具发现与调用、取消、参数、认证、Host／Origin、端口占用和请求体限制，以及磁盘读取、分页、跨库与写入保护。真实 Codex／Claude Code 桌面客户端、钥匙串交互、应用重启与 Windows 运行验收仍需对应环境人工验证；协议测试不替代这些验收。
