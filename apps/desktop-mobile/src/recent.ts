import { t, dateTime } from './i18n';
export type RecentNote = { path: string; title: string; openedAt: number };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const key = (vaultId: string) => `mozhi-recent-v1:${vaultId}`;
export function readRecent(storage: Storage, vaultId: string): RecentNote[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key(vaultId)) ?? '[]');
    if (!Array.isArray(value)) return [];
    const valid = value.filter((v): v is RecentNote => v && typeof v.path === 'string' && typeof v.title === 'string' && typeof v.openedAt === 'number' && Number.isFinite(v.openedAt) && v.openedAt >= 0 && v.openedAt <= 8640000000000000);
    const seen = new Set<string>();
    return valid.sort((a, b) => b.openedAt - a.openedAt).filter(v => { if (seen.has(v.path)) return false; seen.add(v.path); return true; }).slice(0, 50);
  } catch { return []; }
}
export function writeRecent(storage: Storage, vaultId: string, entries: RecentNote[]) {
  storage.setItem(key(vaultId), JSON.stringify(entries.slice(0, 50)));
}
export function visitRecent(entries: RecentNote[], entry: RecentNote): RecentNote[] {
  return [entry, ...entries.filter(item => item.path !== entry.path)].slice(0, 50);
}
export function moveRecent(entries: RecentNote[], from: string, to: string): RecentNote[] {
  return entries.map(item => item.path === from || item.path.startsWith(`${from}/`) ? { ...item, path: to + item.path.slice(from.length) } : item);
}
export function pruneRecent(entries: RecentNote[], paths: string[], skipped: string[] = []): RecentNote[] {
  const available = new Set(paths.filter(path => !skipped.includes(path)));
  return entries.filter(item => available.has(item.path));
}
export function relativeTime(time: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return t("刚刚");
  if (minutes < 60) return t("{0} 分钟前", minutes);
  if (minutes < 1440) return t("{0} 小时前", Math.floor(minutes / 60));
  if (minutes < 10080) return t("{0} 天前", Math.floor(minutes / 1440));
  return dateTime(time, true);
}
