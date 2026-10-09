import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from './i18n';
beforeEach(() => setLanguage('zh-CN'));
import { platform } from './platform';

import { renderToStaticMarkup } from 'react-dom/server';
import { SyncPanel } from './SyncPanel';
import { defaultAutoSync } from './auto-sync';

function settingsMarkup(enabled: boolean, afterSave = true) {
  const html = renderToStaticMarkup(<SyncPanel busy run={async action=>action()} onVault={async()=>{}} onReload={async()=>{}} onSync={async()=>{}} syncRevision={0} autoSync={{...defaultAutoSync,enabled,afterSave}} autoPaused={false} onAutoSync={()=>{}}/>);
  return html.split('<section class="auto-sync-settings">')[1].split('</section>')[0];
}

describe('SSH tools by platform', () => {
  it('offers only SSH and hides protocol switching and Token configuration', () => {
    const html = renderToStaticMarkup(<SyncPanel busy={false} run={async action=>action()} onVault={async()=>{}} onReload={async()=>{}} onSync={async()=>{}} syncRevision={0} autoSync={defaultAutoSync} autoPaused={false} onAutoSync={()=>{}}/>);
    expect(html).toContain('value="SSH"');
    expect(html).toContain('SSH 仓库 URL');
    expect(html).toContain('SSH 用户名');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('HTTPS');
    expect(html).not.toContain('Token');
  });
  const originalDesktop = platform.desktop;
  afterEach(() => { platform.desktop = originalDesktop; });
  it.each(['Windows', 'macOS', '桌面'])('gates SSH buttons on %s and respects busy state', desktop => {
    platform.desktop = desktop;
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
