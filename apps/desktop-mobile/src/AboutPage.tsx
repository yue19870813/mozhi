import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
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
  return <section className="settings-page about-page">
    <h1>{t('关于')}</h1>
    <header className="about-brand"><img src={brandLogo} alt=""/><div><h2>MoZhi<span>墨知</span></h2><p className="subtle">{t('本地优先的 Markdown 笔记应用')}</p></div></header>
    <div className="about-description"><p>{t('让记录沉淀为相互连接的知识。')}</p><p>{t('笔记以 Markdown 文件保存在本地，通过标签、双向链接和知识图谱连接思考，适合个人知识管理、学习记录与项目资料整理。')}</p><p>{t('可使用自己的 Git 仓库同步，并按需配置 AI 助理进行问答、总结与生成笔记。')}</p></div>
    <dl className="about-details">
      <div><dt>{t('应用版本')}</dt><dd>{version}</dd></div>
      <div><dt>{t('运行环境')}</dt><dd>{native?t(platform.desktop):t('浏览器演示')}</dd></div>
      <div><dt>{t('开源许可证')}</dt><dd>MIT</dd></div>
    </dl>
  </section>;
}
