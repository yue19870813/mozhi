import { SettingsSwitch } from './SettingsSwitch';
import { useEffect, useState } from 'react';
import { Server, ShieldCheck, KeyRound, Terminal, Copy, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { native, errorText } from './api';
import { t, useLanguage } from './i18n';

export type McpPreferences = {
  enabled: boolean; port: number; vaultId: string; vaultName: string;
  read: boolean; create: boolean; ask: boolean;
};
export type McpStatus = {
  settings: McpPreferences; running: boolean; available: boolean;
  error: string | null; url: string;
};
export function mcpStatusLabel(status: McpStatus | null) {
  return !status?.running ? '服务已停止' : status.available ? '服务运行中' : '已暂停：请切回授权笔记库';
}
export function canSaveMcp(value: McpPreferences, vaultId: string | undefined, desktop: boolean, busy: boolean) {
  return desktop && !busy && !!vaultId && Number.isInteger(value.port)
    && value.port >= 1 && value.port <= 65535 && (!value.enabled || value.read);
}
const permissions = [
  ['read', '允许读取当前笔记库'],
  ['create', '允许直接新建笔记'], ['ask', '允许 MCP 云端问答'],
] as const;

export function McpSettings({ vaultId, vaultName }: { vaultId?: string; vaultName?: string }) {
  useLanguage();
  const [value, setValue] = useState<McpPreferences>({ enabled: false, port: 37891, vaultId: '', vaultName: '', read: false, create: false, ask: false });
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [client, setClient] = useState<'codex' | 'claude'>('codex');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!native) return;
    let active = true;
    async function refresh(initial = false) {
      try {
        const result = await invoke<McpStatus>('mcp_request', { request: { action: 'status' } });
        if (active) { setStatus(result); if (initial) setValue(result.settings); }
      } catch (e) { if (active) setMessage(errorText(e)); }
    }
    void refresh(true);
    const timer = setInterval(() => void refresh(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [vaultId]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setMessage('');
    try {
      await action();
      const result = await invoke<McpStatus>('mcp_request', { request: { action: 'status' } });
      setStatus(result); setValue(result.settings);
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }
  const url = `http://127.0.0.1:${value.port}/mcp`;
  const stateClass = !status?.running ? 'stopped' : status.available ? 'running' : 'paused';
  const permissionDescriptions = {
    read: '读取与检索磁盘上已保存的 Markdown 笔记。',
    create: '允许创建新笔记，不会覆盖已有文件。',
    ask: '将问题和相关片段发送到已配置的模型服务。',
  };
  function toggle(key: 'enabled' | 'read' | 'create' | 'ask', label: string) {
    return <SettingsSwitch label={t(label)} disabled={!native || busy} checked={value[key]} onChange={e => setValue({ ...value, [key]: e.target.checked })}/>;
  }
  return <section className="settings-page mcp-settings">
    <div className="mcp-content">
      <header className="mcp-page-header">
        <div><h1>{t('MCP 服务')}</h1><p>{t('墨知运行时允许外部 AI 访问授权笔记库；默认关闭，仅监听本机。')}</p></div>
        <span className={`mcp-status ${stateClass}`} role="status"><i/>{t(mcpStatusLabel(status))}</span>
      </header>
      <section className="mcp-card">
        <div className="mcp-card-heading"><span className="mcp-card-icon"><Server size={17}/></span><h2>{t('服务连接')}</h2></div>
        <label className="mcp-toggle-row"><span><strong>{t('启用 MCP 服务')}</strong><small>{t('仅本机访问，退出墨知后服务停止。')}</small></span>{toggle('enabled', '启用 MCP 服务')}</label>
        <div className="mcp-connection-grid">
          <label className="mcp-field"><span>{t('端口')}</span><input type="number" min={1} max={65535} disabled={!native || busy} value={value.port} onChange={e => setValue({ ...value, port: Number(e.target.value) })}/></label>
          <div className="mcp-field"><span>{t('服务地址')}</span><code className="mcp-endpoint">{url}</code></div>
        </div>
      </section>
      <section className="mcp-card">
        <div className="mcp-card-heading"><span className="mcp-card-icon"><ShieldCheck size={17}/></span><h2>{t('笔记库与权限')}</h2></div>
        <div className="mcp-vault-grid">
          <div><small>{t('当前笔记库：')}</small><strong>{vaultName ?? '—'}</strong></div>
          <div><small>{t('授权笔记库')}</small><strong>{status?.settings.vaultName || t('未授权')}</strong></div>
        </div>
        {status?.settings.vaultId && <code className="mcp-vault-id">{status.settings.vaultId}</code>}
        <div className="mcp-permissions">
          {permissions.map(([key, label]) => <label className="mcp-toggle-row" key={key}>
            <span className="mcp-permission-copy"><strong>{t(label)}{status && <em>{t(status.settings[key] ? '已授权' : '未授权')}</em>}</strong><small>{t(permissionDescriptions[key])}</small></span>
            {toggle(key, label)}
          </label>)}
        </div>
        <p className="mcp-hint">{t('保存将授权当前打开的笔记库。读取仅包含磁盘已保存内容；新建不允许覆盖。云端问答会向设置的模型服务发送问题与相关片段。')}</p>
        <div className="mcp-save-row"><button className="mcp-save-button" disabled={!canSaveMcp(value, vaultId, native, busy)} onClick={() => void run(() => invoke('mcp_request', { request: { action: 'configure', enabled: value.enabled, port: value.port, read: value.read, create: value.create, ask: value.ask } }))}>{t('保存设置')}</button></div>
      </section>
      <section className="mcp-card">
        <div className="mcp-card-heading"><span className="mcp-card-icon"><KeyRound size={17}/></span><h2>{t('访问令牌')}</h2></div>
        <p className="mcp-hint">{t('令牌只在原生窗口展示。将其配置为客户端环境变量 MOZHI_MCP_TOKEN，不要写入笔记库。模型服务配置变化后需重新授权 MCP 云端问答。')}</p>
        <div className="mcp-actions">
          <button disabled={!native || busy || !status?.settings.vaultId} onClick={() => void run(() => invoke('mcp_token'))}><Copy size={14}/>{t('查看 / 复制访问令牌')}</button>
          <button disabled={!native || busy || !status?.settings.vaultId} onClick={() => {if (window.confirm(t('轮换令牌将断开旧连接，是否继续？'))) void run(() => invoke('mcp_request', { request: { action: 'rotate' } }));}}><RefreshCw size={14}/>{t('轮换令牌')}</button>
        </div>
        <div className="mcp-client-heading"><span><Terminal size={15}/>{t('客户端连接示例')}</span><div className="mcp-client-tabs" role="tablist" aria-label={t('客户端连接示例')}>
          {(['codex', 'claude'] as const).map(id => <button key={id} id={`mcp-tab-${id}`} role="tab" aria-selected={client === id} aria-controls={`mcp-panel-${id}`} onClick={() => setClient(id)}>{id === 'codex' ? 'Codex' : 'Claude Code'}</button>)}
        </div></div>
        <div id="mcp-panel-codex" role="tabpanel" aria-labelledby="mcp-tab-codex" hidden={client !== 'codex'}><div className="mcp-code-file">~/.codex/config.toml</div><pre>{`[mcp_servers.mozhi]\nurl = "${url}"\nbearer_token_env_var = "MOZHI_MCP_TOKEN"`}</pre></div>
        <div id="mcp-panel-claude" role="tabpanel" aria-labelledby="mcp-tab-claude" hidden={client !== 'claude'}><div className="mcp-code-file">.mcp.json</div><pre>{JSON.stringify({ mcpServers: { mozhi: { type: 'http', url, headers: { Authorization: 'Bearer ${MOZHI_MCP_TOKEN}' } } } }, null, 2)}</pre></div>
        <p className="mcp-hint mcp-client-hint">{t('客户端需继承该环境变量；连接配置不包含真实令牌。')}</p>
      </section>
      {!native && <p className="notice">{t('MCP 服务仅支持桌面应用。')}</p>}
      {busy && <p role="status">{t('正在处理…')}</p>}
      {(message || status?.error) && <p className="notice" role="alert">{t(message || status!.error!)}</p>}
    </div>
  </section>;
}
