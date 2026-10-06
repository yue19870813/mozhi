export type AutoSyncSettings = { enabled: boolean; onOpen: boolean; afterSave: boolean; idleSeconds: number; intervalMinutes: number };
export const defaultAutoSync: AutoSyncSettings = { enabled: false, onOpen: true, afterSave: true, idleSeconds: 30, intervalMinutes: 5 };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export function readAutoSync(storage: Storage, vaultId: string): AutoSyncSettings {
  try {
    const value = JSON.parse(storage.getItem(`mozhi-auto-sync-v1:${vaultId}`) ?? '{}');
    return {
      enabled: value.enabled === true,
      onOpen: value.onOpen !== false,
      afterSave: value.afterSave !== false,
      idleSeconds: Number.isInteger(value.idleSeconds) && value.idleSeconds >= 10 && value.idleSeconds <= 600 ? value.idleSeconds : 30,
      intervalMinutes: Number.isInteger(value.intervalMinutes) && value.intervalMinutes >= 1 && value.intervalMinutes <= 60 ? value.intervalMinutes : 5,
    };
  } catch { return { ...defaultAutoSync }; }
}
export function writeAutoSync(storage: Storage, vaultId: string, settings: AutoSyncSettings) {
  storage.setItem(`mozhi-auto-sync-v1:${vaultId}`, JSON.stringify(settings));
}
export class AutoSyncSchedule {
  opened = true;
  savedAt: number | null = null;
  paused = false;
  constructor(public lastSyncAt: number) {}
  due(settings: AutoSyncSettings, now: number, blocked: boolean): boolean {
    return settings.enabled && !this.paused && !blocked && (
      (this.opened && settings.onOpen) ||
      (settings.afterSave && this.savedAt !== null && now - this.savedAt >= settings.idleSeconds * 1000) ||
      now - this.lastSyncAt >= settings.intervalMinutes * 60000
    );
  }
  succeeded(now: number) { this.opened = false; this.savedAt = null; this.lastSyncAt = now; this.paused = false; }
}
