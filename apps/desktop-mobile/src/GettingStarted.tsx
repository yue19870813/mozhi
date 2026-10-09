import { t, useLanguage } from './i18n';
import { platform } from './platform';

export function GettingStarted({ disabled, onSyncSettings }: { disabled: boolean; onSyncSettings: () => void }) {
  useLanguage();
  return <section className="help-page getting-started">
    <div className="getting-started-content">
      <h1>{t("使用入门")}</h1>
      <h2>{t("首次同步指南")}</h2>
      <p>{t("无需安装 Git 命令行。当前仅提供 SSH 同步；先准备远端仓库，再为当前电脑配置 SSH 密钥。以下以 GitHub 为例。")}</p>
      <h2>{t("1. 准备自己的远端仓库")}</h2>
      <p>{t("在 GitHub 创建笔记仓库，个人笔记建议设为 Private。勾选 Add a README file，确保仓库已有首次提交和默认分支；不要直接克隆完全空的仓库。")}</p>
      <p>{t("记下实际分支名（例如 main 或 master），从 Code → SSH 复制仓库地址。下面的 YOUR_NAME 和 my-notes 请替换为自己的账号和仓库名。")}</p>
      <pre><code>{"git@github.com:YOUR_NAME/my-notes.git\nssh://git@github.com/YOUR_NAME/my-notes.git"}</code></pre>
      <h2>{t("2. 按系统配置 SSH 密钥")}</h2>
      <p>{t("展开对应系统的步骤。已有可访问仓库的密钥可跳过生成；每台电脑都需要完成自己的密钥加载。")}</p>
      <details className="help-platform" open={platform.desktop!=='Windows'}><summary>macOS</summary>
        <div><p>{t("打开「终端」，生成密钥。将示例邮箱换成自己的标识；按提示选择保存位置和密码。如提示文件已存在，请换名保存，不要覆盖旧密钥。")}</p>
      <pre><code>{"ssh-keygen -t ed25519 -C \"your-email@example.com\""}</code></pre>
      <p>{t("默认私钥是 ~/.ssh/id_ed25519，公钥是同名 .pub 文件。执行以下命令复制公钥；如果使用了自定义文件名，请替换路径。")}</p>
      <pre><code>{"pbcopy < ~/.ssh/id_ed25519.pub"}</code></pre>
      <p>{t("在 GitHub → Settings → SSH and GPG keys → New SSH key 中，选择 Authentication Key 并粘贴公钥。只上传 .pub 公钥，私钥和密码留在本机，不要放入笔记库。")}</p>
      <p>{t("回到墨知「设置 → 同步」，点击「选择 SSH 密钥」。在文件选择器按 ⌘ Shift G 输入 ~/.ssh/，选择 id_ed25519 私钥（不是 .pub）。加密私钥会弹出密码框。")}</p>
      <p>{t("若提示私钥权限不正确，执行下方命令后重新选择。最后点击「检查 SSH Agent」，确认已加载密钥。")}</p>
      <pre><code>{"chmod 600 ~/.ssh/id_ed25519"}</code></pre>
      </div></details>
      <details className="help-platform" open={platform.desktop==='Windows'}><summary>Windows</summary>
        <div><p>{t("先在 Windows「可选功能」中确认已安装 OpenSSH Client（客户端）。墨知使用系统 OpenSSH Agent；只安装 Git for Windows 并不能代替这一步。")}</p>
      <p>{t("首次使用，在管理员 PowerShell 中依次执行以下命令，启用并启动 ssh-agent 服务。若服务已经运行，可跳过；提示服务不存在时先安装 OpenSSH Client。")}</p>
      <pre><code>{"Set-Service -Name ssh-agent -StartupType Automatic\nStart-Service -Name ssh-agent"}</code></pre>
      <p>{t("回到日常登录账户的普通 PowerShell，执行下方命令生成密钥。将示例邮箱换成自己的标识，保留或自行选择路径并设置密码；已有密钥时不要覆盖。")}</p>
      <pre><code>{"ssh-keygen -t ed25519 -C \"your-email@example.com\""}</code></pre>
      <p>{t("默认文件在用户目录的 .ssh 文件夹内。执行下方命令复制公钥，自定义文件名时请替换路径，然后将公钥添加到 GitHub。")}</p>
      <pre><code>{"Get-Content \"$env:USERPROFILE\\.ssh\\id_ed25519.pub\" | Set-Clipboard"}</code></pre>
      <p>{t("在 GitHub → Settings → SSH and GPG keys → New SSH key 中，选择 Authentication Key 并粘贴公钥。只上传 .pub 公钥，私钥和密码留在本机，不要放入笔记库。")}</p>
      <p>{t("在墨知「设置 → 同步」点击「检查 SSH Agent」，再点「选择 SSH 密钥」，选择用户目录下 .ssh 中的 id_ed25519（不是 .pub）。输入私钥密码后，再次检查已加载的密钥数量。")}</p>
      <p>{t("若检测到 Pageant，请退出 Pageant 后重试，避免它与 Windows OpenSSH Agent 冲突。不要在 Windows 上使用 chmod 600 修复权限；请根据系统提示检查私钥的 Windows 文件权限。")}</p>
      </div></details>
      <h2>{t("3. 填写配置并克隆笔记库")}</h2>
      <p>{t("在「设置 → 同步」填写 SSH 仓库 URL、实际分支名和 SSH 用户名。GitHub 的 SSH 用户名通常是 git，不是你的 GitHub 登录名；若 URL 中含用户名，两处应一致。")}</p>
      <p>{t("在「克隆已有仓库」填写新目录名，点击「选择位置并克隆」，选择父目录。墨知会在其中创建新目录；该子目录必须尚不存在。完成后自动切换到自己的笔记库，并保存同步配置。")}</p>
      <p>{t("已有本地 Git 仓库：直接打开包含 .git 的仓库根目录，在同步页填写配置并点击「保存设置」。普通 Markdown 文件夹不会因保存同步设置而自动变成 Git 仓库；先备份笔记，再复制到克隆后的库中。")}</p>
      <p>{t("旧 HTTPS 配置需要重新填写 SSH 地址并保存；原凭据保留，当前不提供 HTTPS 同步。")}</p>
      <h2>{t("4. 验证首次同步")}</h2>
      <p>{t("确认侧栏显示自己的笔记库，新建一篇测试笔记并等待「已保存到本机」。点击右上角同步图标，或在同步设置中点击「立即同步」。")}</p>
      <p>{t("等待「同步完成」，再到 GitHub 的对应分支刷新，确认新笔记和正文都已出现。保存到本机不等于已推送到远端；Agent 加载成功也不等于拥有仓库权限。")}</p>
      <p>{t("首次手动同步成功后，可开启「启用自动同步」，选择打开笔记库时同步、保存后空闲同步及同步间隔。另一台电脑需为同一仓库和分支配置密钥并克隆；编辑前后都同步，减少冲突。")}</p>
      <h2>{t("常见问题与恢复")}</h2>
      <p>{t("未加载密钥或重启后失败：重新选择私钥，检查 Agent 状态。认证失败：确认公钥登记在正确账号下、账号有仓库权限、SSH 用户名正确。")}</p>
      <p>{t("克隆失败：检查网络、仓库地址、远端首次提交、分支名称和目标目录。同步冲突：到同步设置对照本地与远端内容，逐项选择或手动合并，保存决议后再同步；恢复记录与笔记库导出位于设置中。")}</p>
      <div className="workspace-toolbar"><button disabled={disabled} onClick={onSyncSettings}>{t("前往同步设置")}</button></div>
      <h2>{t("开始记录与连接知识")}</h2>
      <p>{t("打开一个本地文件夹作为笔记库，在「我的笔记」中新建 Markdown 笔记和目录。")}</p>
      <p>{t("源码、分栏与预览随时切换。输入会自动保存；保存失败或发现冲突时，请按页面提示协调版本。")}</p>
      <p>{t("使用 [[笔记名称]] 建立引用，在关联信息中查看反向链接，在知识图谱中探索笔记之间的联系。")}</p>

    </div>
  </section>;
}
