export type Module = 'home' | 'notes' | 'graph' | 'ai' | 'help' | 'settings';
export type HomePage = 'overview' | 'recent';
export type SettingsPage = 'appearance' | 'vault' | 'sync' | 'recovery' | 'ai';
export type HelpPage = 'intro' | 'shortcuts' | 'lab';
export type EditorMode = 'source' | 'split' | 'preview';
export const moduleLabels: Record<Module, string> = { home: '首页', notes: '我的笔记', graph: '知识图谱', ai: 'AI 助理', help: '帮助', settings: '设置' };

/** The action must not run if saving fails or composition/another operation owns the session. */
export async function afterSave(blocked: boolean, save: () => Promise<void>, action: () => Promise<void>) {
  if (blocked) return false;
  await save();
  await action();
  return true;
}
export function readPreference(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* UI preferences must not interrupt editing. */ }
}
export function readEditorMode(): EditorMode {
  const value = readPreference('mozhi-editor-mode', 'split');
  return value === 'source' || value === 'preview' ? value : 'split';
}
