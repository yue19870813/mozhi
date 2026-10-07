import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncPanel } from './SyncPanel';
import { defaultAutoSync } from './auto-sync';

function settingsMarkup(enabled: boolean, afterSave = true) {
  const html = renderToStaticMarkup(<SyncPanel busy run={async action=>action()} onVault={async()=>{}} onReload={async()=>{}} onSync={async()=>{}} syncRevision={0} autoSync={{...defaultAutoSync,enabled,afterSave}} autoPaused={false} onAutoSync={()=>{}}/>);
  return html.split('<section class="auto-sync-settings">')[1].split('</section>')[0];
}

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
