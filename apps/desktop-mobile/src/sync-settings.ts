import type { SyncConfig } from './api';
import { t } from './i18n';

// Keep stored legacy settings untouched until the user explicitly saves SSH settings.
export function sshSettings(saved: SyncConfig | null): SyncConfig {
  if (saved?.protocol === 'ssh') return { ...saved };
  return { protocol: 'ssh', url: '', branch: saved?.branch || 'main', username: 'git' };
}

export function requireSshSync(saved: SyncConfig | null): void {
  if (!saved) throw new Error(t("请先保存 Git 同步设置"));
  if (saved.protocol !== 'ssh') {
    throw new Error(t("当前仅提供 SSH 同步，请填写 SSH 仓库地址并保存设置。"));
  }
}
