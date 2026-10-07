import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getLanguage, initializeLanguage } from './i18n';
async function start() {
  let locale = navigator.language;
  if (isTauri()) {
    try { locale = await invoke<string>('system_locale'); } catch { /* Fall back to the WebView locale. */ }
  }
  initializeLanguage(locale, localStorage);
  if (isTauri()) await invoke('ui_language', { language: getLanguage() }).catch(() => {});
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
}
void start();
