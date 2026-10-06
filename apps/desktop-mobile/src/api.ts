import { invoke, isTauri } from '@tauri-apps/api/core';
import welcome from '../../../tests/fixtures/欢迎使用.md?raw';
import ime from '../../../tests/fixtures/中文输入检查.md?raw';
import plan from '../../../tests/fixtures/项目计划.md?raw';
export type Note = { path: string; content: string; contentHash: string };
export type Vault = { id: string; name: string; entries: { path: string; bytes: number }[]; skipped: string[] };
export type SearchResult = { hits: { path: string; title: string; excerpt: string }[]; elapsedMs: number; strategy: string };
export const native = isTauri();
const samples = new Map(Object.entries({ '欢迎使用.md': welcome, '中文输入检查.md': ime, '项目计划.md': plan }));
const drafts = new Map<string, string>();
const demoNote = (path: string): Note => ({ path, content: samples.get(path) ?? '', contentHash: samples.get(path) ?? '' });
let activeVaultId = '';
export function selectVault(id: string) { activeVaultId = id; }
function call<T>(command: string, args: Record<string,unknown> = {}): Promise<T> { return invoke(command, { ...args, vaultId: activeVaultId }); }
export async function workspace<T>(request: Record<string,unknown>): Promise<T> {
  if (!native) throw new Error('此操作需要桌面应用；浏览器仅提供编辑界面演示');
  return call('workspace', { request });
}
export type ParsedNote = { path: string; id: string | null; title: string; tags: string[]; references: { raw: string; start: number; end: number; wiki: boolean; image: boolean; target: string | null; resolution: string }[]; issues: string[] };
export type SyncConfig = { protocol: 'https' | 'ssh'; url: string; branch: string; username: string };
export type Conflict = { path: string; ancestor: string | null; local: string | null; remote: string | null; binary: boolean; localDeleted: boolean; remoteDeleted: boolean };
export type SyncState = { phase: string; message: string; conflicts: Conflict[]; commit: string | null; lastSuccess: number | null };
export const api = {
  async openDemo(): Promise<Vault> {
    return native ? invoke('open_demo') : { id: 'demo', name: '墨知示例笔记', entries: [...samples].map(([path, content]) => ({ path, bytes: new TextEncoder().encode(content).length })), skipped: [] };
  },
  async openVault(): Promise<Vault | null> { return native ? invoke('open_vault') : null; },
  async read(path: string): Promise<Note> { return native ? call('read_note', { path }) : demoNote(path); },
  async readDraft(path: string): Promise<string | null> { return native ? call('read_draft', { path }) : drafts.get(path) ?? null; },
  async draft(path: string, content: string): Promise<void> { if (native) await call('save_draft', { path, content }); else drafts.set(path, content); },
  async save(note: Note, content: string): Promise<{ note: Note; indexWarning?: string }> {
    if (native) return call('save_note', { path: note.path, expectedContentHash: note.contentHash, content });
    if (samples.get(note.path) !== note.contentHash) throw { code: 'CONTENT_CONFLICT', message: '内容版本发生变化' };
    samples.set(note.path, content); drafts.set(note.path, content);
    return { note: demoNote(note.path) };
  },
  async search(query: string, directory: string): Promise<SearchResult> {
    if (native) return call('search_notes', { query, directory });
    const started = performance.now();
    return { hits: [...samples].filter(([path, content]) => path.startsWith(directory) && `${path}\n${content}`.toLowerCase().includes(query.toLowerCase())).map(([path, content]) => ({ path, title: content.match(/^# (.+)$/m)?.[1] ?? path, excerpt: content.slice(0, 160) })), elapsedMs: performance.now() - started, strategy: 'browser-demo' };
  },
  async credentials(config: SyncConfig): Promise<boolean> { return invoke('set_credentials', { config }); },
  async selectSshKey(): Promise<{ keyCount: number } | null> { return invoke('select_ssh_key'); },
  async checkSshAgent(): Promise<{ keyCount: number }> { return invoke('check_ssh_agent'); },
  async clone(config: SyncConfig, name: string): Promise<Vault | null> { return invoke('clone_vault', { config, name }); },
  async probes(): Promise<unknown> { if (!native) throw new Error('请在桌面应用中运行 Rust 样本'); return invoke('run_probes'); },
};
export const errorText = (error: unknown): string => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error);
