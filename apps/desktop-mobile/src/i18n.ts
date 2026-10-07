import { useSyncExternalStore } from 'react';
import { translations } from './locales';

export type Language = 'zh-CN' | 'en' | 'ja';
export const languageKey = 'mozhi-language';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function systemLanguage(locale: string): Language {
  const primary = locale.toLowerCase().split(/[-_]/)[0];
  return primary === 'zh' ? 'zh-CN' : primary === 'ja' ? 'ja' : 'en';
}
export function readLanguage(storage: PreferenceStorage, locale: string): Language {
  try {
    const saved = storage.getItem(languageKey);
    if (saved === 'zh-CN' || saved === 'en' || saved === 'ja') return saved;
  } catch { /* A blocked preference store must not prevent startup. */ }
  return systemLanguage(locale);
}
let language: Language = 'en';
const listeners = new Set<() => void>();
export function getLanguage(): Language { return language; }
export function setLanguage(next: Language, storage?: PreferenceStorage) {
  storage?.setItem(languageKey, next);
  language = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach(listener => listener());
}
export function useLanguage() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLanguage, getLanguage);
}
export function initializeLanguage(locale: string, storage: PreferenceStorage) {
  const selected = readLanguage(storage, locale);
  try { setLanguage(selected, storage); } catch { setLanguage(selected); }
}
function format(text: string, values: unknown[]) {
  return text.replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match);
}
const reverse = new Map<string, string>();
for (const [key, values] of Object.entries(translations)) for (const value of values) reverse.set(value, key);
// Existing status messages can change language without altering interpolated paths or names.
const messages = new Map<string, { key: string; values: unknown[] }>();
export function t(key: string, ...values: unknown[]): string {
  const cached = messages.get(key);
  if (cached && !values.length) return t(cached.key, ...cached.values);
  const source = translations[key] ? key : reverse.get(key) ?? key;
  const translated = language === 'zh-CN' ? source : translations[source]?.[language === 'en' ? 0 : 1] ?? key;
  const result = format(translated, values);
  if (values.length && result !== source) {
    if (messages.size >= 256) messages.delete(messages.keys().next().value!);
    messages.set(result, { key: source, values });
  }
  return result;
}
export function dateTime(time: number, dateOnly = false): string {
  return new Intl.DateTimeFormat(language, dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(time);
}
