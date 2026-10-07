import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AboutWindow } from './AboutWindow';
import { readPreference } from './navigation';
import './styles.css';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getLanguage, initializeLanguage } from './i18n';
async function start() {
  const about = new URLSearchParams(location.search).get('view') === 'about';
  let locale = navigator.language;
  if (isTauri()) {
    try { locale = await invoke<string>('system_locale'); } catch { /* Fall back to the WebView locale. */ }
  }
  initializeLanguage(locale, localStorage);
  if (isTauri() && !about) await invoke('ui_language', { language: getLanguage() }).catch(() => {});
  document.documentElement.dataset.theme = readPreference('mozhi-theme', 'dark');
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{about?<AboutWindow/>:<App/>}</React.StrictMode>);
}
void start();
