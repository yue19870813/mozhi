import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { native } from './api';
import { useAppVersion } from './AboutPage';
import { initializeLanguage, languageKey, t, useLanguage } from './i18n';
import { readPreference } from './navigation';
import brandLogo from './assets/brand-logo.png';

export function AboutWindow() {
  useLanguage();
  const version = useAppVersion();
  function close() { if (native) void getCurrentWindow().close(); }
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === languageKey) initializeLanguage(navigator.language, localStorage);
      if (event.key === 'mozhi-theme') document.documentElement.dataset.theme = readPreference('mozhi-theme', 'dark');
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('storage', update); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('storage', update); window.removeEventListener('keydown', key); };
  }, []);
  return <main className="about-window">
    <img className="about-window-icon" src={brandLogo} alt=""/>
    <h1>MoZhi<span>墨知</span></h1>
    <p className="about-window-version">{t('应用版本')} {version}</p>
    <p className="about-window-summary">{t('本地优先的 Markdown 笔记应用')}</p>
    <p className="about-window-tagline">{t('让记录沉淀为相互连接的知识。')}</p>
    <div className="about-window-license">{t('开源许可证')} · MIT</div>
  </main>;
}
