import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from './i18n';
beforeEach(() => setLanguage('zh-CN'));
import { platform } from './platform';

const renderState = vi.hoisted(() => ({ ssh: false }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => actual.useState(renderState.ssh && typeof initial === 'object' && initial !== null && 'protocol' in initial ? { ...initial, protocol: 'ssh' } : initial) };
});
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncPanel } from './SyncPanel';
import { defaultAutoSync } from './auto-sync';

function settingsMarkup(enabled: boolean, afterSave = true) {
  const html = renderToStaticMarkup(<SyncPanel busy run={async action=>action()} onVault={async()=>{}} onReload={async()=>{}} onSync={async()=>{}} syncRevision={0} autoSync={{...defaultAutoSync,enabled,afterSave}} autoPaused={false} onAutoSync={()=>{}}/>);
  return html.split('<section class="auto-sync-settings">')[1].split('</section>')[0];
}

describe('SSH tools by platform', () => {
  const originalDesktop = platform.desktop;
  afterEach(() => { renderState.ssh = false; platform.desktop = originalDesktop; });
  it.each(['Windows', 'macOS', '桌面'])('gates SSH buttons on %s and respects busy state', desktop => {
    platform.desktop = desktop;
    renderState.ssh = true;
    for (const busy of [false, true]) {
      const html = renderToStaticMarkup(<SyncPanel busy={busy} run={async action=>action()} onVault={async()=>{}} onReload={async()=>{}} onSync={async()=>{}} syncRevision={0} autoSync={defaultAutoSync} autoPaused={false} onAutoSync={()=>{}}/>);
      for (const label of ['选择 SSH 密钥', '检查 SSH Agent']) {
        const button = html.match(new RegExp(`<button([^>]*)>${label}</button>`));
        expect(button).not.toBeNull();
        expect(button![1].includes('disabled')).toBe(busy || desktop === '桌面');
      }
      if (desktop === 'Windows') expect(html).toContain('Windows 使用 OpenSSH Agent');
    }
  });
});

describe('automatic sync settings while busy', () => {
  it('keeps the enabled switch and settings available during synchronization', () => {
    const html = settingsMarkup(true);
    expect(html.match(/<input/g)).toHaveLength(5);
    expect(html).not.toContain('disabled');
  });
  it('keeps the master switch available after disabling and disables only dependent settings', () => {
    const inputs = settingsMarkup(false).match(/<input[^>]*>/g)!;
    expect(inputs[0]).not.toContain('disabled');
    expect(inputs[0]).not.toContain('checked');
    for (const input of inputs.slice(1)) expect(input).toContain('disabled');
    expect(settingsMarkup(true, false).match(/disabled=""/g)).toHaveLength(1);
  });
});
