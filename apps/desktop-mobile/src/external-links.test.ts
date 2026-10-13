import { afterEach, describe, expect, it, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ native: true, invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native, invoke: bridge.invoke }));
import { openWebUrl, webUrl } from './external-links';

afterEach(() => { bridge.native = true; bridge.invoke.mockClear(); vi.unstubAllGlobals(); });
describe('external web links', () => {
  it('preserves query and fragments and rejects unsafe protocols, credentials and malformed links', () => {
    expect(webUrl('https://example.com/a?q=b#part')).toBe('https://example.com/a?q=b#part');
    expect(webUrl('HTTP://localhost:8080')).toBe('http://localhost:8080/');
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/a', 'mailto:a@b.com', '//example.com', '../note.md', 'https://user:secret@example.com', 'https://example.com\n', 'https://', '']) expect(webUrl(url)).toBeNull();
  });
  it('opens desktop links through the validated native command and never invokes for unsafe input', async () => {
    await openWebUrl('https://example.com');
    expect(bridge.invoke).toHaveBeenCalledWith('open_external_link', { url: 'https://example.com/' });
    bridge.invoke.mockClear();
    await expect(openWebUrl('file:///tmp/private')).rejects.toThrow();
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
  it('opens browser demo links in a separate window without opener access', async () => {
    bridge.native = false;
    const open = vi.fn(); vi.stubGlobal('window', { open });
    await openWebUrl('https://example.com');
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
});
