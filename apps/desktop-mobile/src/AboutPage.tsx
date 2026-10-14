import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Check, Download, RefreshCw } from 'lucide-react';
import { native } from './api';
import { t, useLanguage } from './i18n';
import { platform } from './platform';
import brandLogo from './assets/brand-logo.png';
import packageText from '../package.json?raw';

const bundledVersion: string = JSON.parse(packageText).version;

export function useAppVersion() {
  const [version, setVersion] = useState(bundledVersion);
  useEffect(() => {
    let active = true;
    if (native) void getVersion().then(value => { if (active) setVersion(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return version;
}
export function AboutPage() {
  useLanguage();
  const version = useAppVersion();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  async function checkForUpdates() {
    if (checking) return;
    if (!native) {
      setMessage(t('请在桌面应用中检查更新'));
      return;
    }
    setChecking(true);
    setMessage('');
    setProgress(null);
    try {
      const update = await check();
      if (!update) {
        setMessage(t('当前已是最新版本'));
        return;
      }
      const details = [t('发现新版本 {0}', update.version), update.body].filter(Boolean).join('\n\n');
      if (!window.confirm(`${details}\n\n${t('现在下载并安装吗？')}`)) {
        setMessage(t('更新已取消'));
        return;
      }
      let downloaded = 0;
      let total: number | undefined;
      setMessage(t('正在下载更新'));
      await update.downloadAndInstall(event => {
        if (event.event === 'Started') total = event.data.contentLength;
        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          setProgress(total ? Math.min(100, Math.round(downloaded / total * 100)) : null);
        }
        if (event.event === 'Finished') setProgress(100);
      });
      setMessage(t('更新已下载，正在重新启动'));
      await relaunch();
    } catch (error) {
      setMessage(`${t('检查更新失败')}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setChecking(false);
    }
  }
  return <section className="settings-page about-page">
    <h1>{t('关于')}</h1>
    <header className="about-brand"><img src={brandLogo} alt=""/><div><h2>MoZhi<span>墨知</span></h2><p className="subtle">{t('本地优先的 Markdown 笔记应用')}</p></div></header>
    <div className="about-description"><p>{t('让记录沉淀为相互连接的知识。')}</p><p>{t('笔记以 Markdown 文件保存在本地，通过标签、双向链接和知识图谱连接思考，适合个人知识管理、学习记录与项目资料整理。')}</p><p>{t('可使用自己的 Git 仓库同步，并按需配置 AI 助理进行问答、总结与生成笔记。')}</p></div>
    <dl className="about-details">
      <div><dt>{t('开发工作室')}</dt><dd>墨烛工作室</dd></div>
      <div><dt>{t('应用版本')}</dt><dd>{version}</dd></div>
      <div><dt>{t('运行环境')}</dt><dd>{native?t(platform.desktop):t('浏览器演示')}</dd></div>
      <div><dt>{t('软件更新')}</dt><dd className="about-update"><button type="button" disabled={checking} onClick={() => void checkForUpdates()}><span aria-hidden="true">{progress !== null ? <Download size={15}/> : message === t('当前已是最新版本') ? <Check size={15}/> : <RefreshCw size={15}/>}</span>{checking ? t('正在检查更新') : t('检查更新')}</button>{progress !== null && <progress max="100" value={progress}/>}<span role="status" aria-live="polite">{progress !== null ? `${progress}%` : message}</span></dd></div>
      <div><dt>{t('开源许可证')}</dt><dd>MIT</dd></div>
    </dl>
    <blockquote className="about-dedication">{t('献给我美丽的妻子和两个可爱的宝贝，谢谢你们让平凡的日子闪闪发光。')}</blockquote>
  </section>;
}
