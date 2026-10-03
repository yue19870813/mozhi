type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const key = (vaultId: string) => `mozhi-pinned-v1:${vaultId}`;
export function readPinned(storage: Storage, vaultId: string): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key(vaultId)) ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter((path): path is string => typeof path === 'string' && path.length > 0 && /\.md$/i.test(path)))] : [];
  } catch { return []; }
}
export function writePinned(storage: Storage, vaultId: string, paths: string[]) {
  storage.setItem(key(vaultId), JSON.stringify(paths));
}
export function togglePinned(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths.filter(item => item !== path) : [path, ...paths];
}
export function movePinned(paths: string[], from: string, to: string): string[] {
  return [...new Set(paths.map(path => path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path))];
}
export function prunePinned(paths: string[], available: string[]): string[] {
  const existing = new Set(available);
  return paths.filter(path => existing.has(path));
}
