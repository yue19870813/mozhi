import { invoke, isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import { getLanguage, setLanguage, t, useLanguage, type Language } from './i18n';

export function LanguageSettings() {
  const language = useLanguage();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function change(next: Language) {
    if (saving) return;
    setSaving(true);
    const previous = getLanguage();
    try {
      if (isTauri()) await invoke('ui_language', { language: next });
      setLanguage(next, localStorage);
      setError('');
    } catch {
      if (isTauri()) await invoke('ui_language', { language: previous }).catch(() => {});
      setError('无法保存语言设置');
    } finally {
      setSaving(false);
    }
  }
  return <><div className="setting-row"><label htmlFor="interface-language">{t('语言')}</label><select id="interface-language" disabled={saving} value={language} onChange={event => void change(event.target.value as Language)}>
    <option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option>
  </select></div>{error && <p className="notice error" role="alert">{t(error)}</p>}</>;
}
