import { useState } from 'react';
import { api, errorText, native, workspace, type SyncConfig, type Vault } from './api';
import { t, useLanguage } from './i18n';

export function CreateSyncWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (vault: Vault) => Promise<void> }) {
  useLanguage();
  const [step, setStep] = useState(0), [name, setName] = useState(t('我的笔记库')),
    [url, setUrl] = useState(''), [branch, setBranch] = useState('main'),
    [vault, setVault] = useState<Vault | null>(null), [publicKey, setPublicKey] = useState(''),
    [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setStatus(''); try { await action(); } catch (e) { setStatus(''); setError(errorText(e)); } finally { setBusy(false); } }
  async function create() { await run(async () => { const result = await api.createVault(name); if (!result) return; setVault(result); await onCreated(result); setStep(1); }); }
  async function generate() { await run(async () => { const result = await api.generateSshKey(); setPublicKey(result.publicKey); setStatus(t('密钥已生成并加载到系统 Agent')); }); }
  async function copyKey() { try { await navigator.clipboard.writeText(publicKey); setStatus(t('公钥已复制')); } catch (e) { setError(errorText(e)); } }
  async function sync() {
    if (!vault) return;
    await run(async () => {
      const config: SyncConfig = { protocol: 'ssh', url: url.trim(), branch: branch.trim() || 'main', username: url.trim().match(/^(?:ssh:\/\/)?([^/@:]+)@/)?.[1] ?? 'git' };
      await workspace({ action: 'configure', config });
      setStatus(t('正在验证连接并首次同步'));
      await workspace({ action: 'sync' });
      setStep(3);
      setStatus(t('首次同步完成'));
    });
  }
  return <div className="modal-backdrop" role="presentation"><section className="modal create-sync-wizard" role="dialog" aria-modal="true" aria-labelledby="create-sync-title">
    <header className="wizard-header"><div><h2 id="create-sync-title">{t('创建并同步个人笔记库')}</h2><p className="subtle">{t('步骤 {0} / 4', String(step + 1))}</p></div><button disabled={busy} onClick={onClose} aria-label={t('关闭')}>×</button></header>
    {!native ? <p className="notice">{t('此操作需要桌面应用；浏览器仅提供编辑界面演示')}</p> : <>
      {step === 0 && <><label className="modal-field">{t('笔记库名称')}<input disabled={busy} value={name} onChange={e => setName(e.target.value)} autoFocus /></label><p className="subtle">{t('选择父目录后，将在其中创建同名目录和欢迎笔记。')}</p><div className="workspace-toolbar"><button disabled={busy || !name.trim()} onClick={() => void create()}>{t('选择位置并创建')}</button></div></>}
      {step === 1 && <><p>{t('本地笔记库已创建，默认分支为 main。')}</p><button disabled={busy} onClick={() => void generate()}>{t('生成并加载 SSH 密钥')}</button>{publicKey && <><label className="modal-field">{t('添加到远端平台的公钥')}<textarea readOnly value={publicKey} rows={4} /></label><button disabled={busy} onClick={() => void copyKey()}>{t('复制公钥')}</button><p className="subtle">{t('请在 Git 托管平台添加此公钥，再继续。')}</p><div className="workspace-toolbar"><button disabled={busy} onClick={() => setStep(2)}>{t('我已添加，继续')}</button></div></>}</>}
      {step === 2 && <><label className="modal-field">{t('SSH 仓库地址')}<input disabled={busy} value={url} onChange={e => setUrl(e.target.value)} placeholder="git@example.com:account/notes.git" /></label><label className="modal-field">{t('分支')}<input disabled={busy} value={branch} onChange={e => setBranch(e.target.value)} /></label><p className="subtle">{t('请先在托管平台创建空仓库。首次同步会推送本地初始提交。')}</p><div className="workspace-toolbar"><button disabled={busy || !url.trim()} onClick={() => void sync()}>{t('验证并首次同步')}</button></div></>}
      {step === 3 && <div role="status">{status || t('同步已完成，笔记库已打开。')}</div>}
      {status && step !== 3 && <p className="notice" role="status">{status}</p>}{error && <p className="notice error" role="alert">{t(error)}</p>}
    </>}
    <footer className="workspace-toolbar"><button disabled={busy} onClick={onClose}>{t('关闭')}</button></footer>
  </section></div>;
}
