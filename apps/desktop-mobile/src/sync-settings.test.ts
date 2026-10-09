import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncConfig } from './api';
import { setLanguage } from './i18n';
import { requireSshSync, sshSettings } from './sync-settings';

beforeEach(() => setLanguage('zh-CN'));
describe('SSH-only sync settings', () => {
  it('defaults new vaults to SSH', () => {
    expect(sshSettings(null)).toEqual({ protocol: 'ssh', url: '', branch: 'main', username: 'git' });
  });
  it('preserves existing SSH addresses and custom usernames', () => {
    const saved: SyncConfig = { protocol: 'ssh', url: 'alice@example.com:notes.git', branch: 'notes', username: 'alice' };
    expect(sshSettings(saved)).toEqual(saved);
    expect(() => requireSshSync(saved)).not.toThrow();
  });
  it('requires explicit replacement of HTTPS without mutating stored settings', () => {
    const saved: SyncConfig = { protocol: 'https', url: 'https://example.com/notes.git', branch: 'notes', username: 'alice' };
    const snapshot = { ...saved };
    const draft = sshSettings(saved);
    expect(draft).toEqual({ protocol: 'ssh', url: '', branch: 'notes', username: 'git' });
    expect(saved).toEqual(snapshot);
    expect(() => requireSshSync(saved)).toThrow('当前仅提供 SSH 同步');
    expect(() => requireSshSync(null)).toThrow('请先保存 Git 同步设置');
  });
  it('also blocks older configurations with an omitted protocol', () => {
    const legacy = { url: 'https://example.com/notes.git', branch: 'main', username: 'alice' } as SyncConfig;
    expect(sshSettings(legacy).protocol).toBe('ssh');
    expect(sshSettings(legacy).url).toBe('');
    expect(() => requireSshSync(legacy)).toThrow('当前仅提供 SSH 同步');
  });
});
