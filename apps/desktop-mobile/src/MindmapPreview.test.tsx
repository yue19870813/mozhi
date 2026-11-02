// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('./api', () => ({ native: true, workspace: vi.fn() }));
import { workspace } from './api';
import { MindmapPreview } from './MindmapPreview';
import { setLanguage } from './i18n';

it('collapses branches by mouse and keyboard, expands all, zooms, and resets on document changes', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setLanguage('zh-CN');
  const host = document.createElement('div');
  const root = createRoot(host);
  const render = (content: string) => act(() => root.render(<MindmapPreview content={content} title="Note"/>));
  try {
    render('# Root\n## Branch\n- Leaf');
    const branch = () => host.querySelector<SVGGElement>('[aria-label="Branch"]')!;
    act(() => branch().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('[aria-label="Leaf"]')).toBeNull();
    expect(branch().getAttribute('aria-expanded')).toBe('false');
    act(() => branch().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(host.querySelector('[aria-label="Leaf"]')).not.toBeNull();
    act(() => branch().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
    act(() => button('展开全部').click());
    expect(host.querySelector('[aria-label="Leaf"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="放大脑图"]')!.click());
    expect(host.querySelector('svg > g')?.getAttribute('transform')).toContain('scale(1.25)');
    act(() => button('适应视图').click());
    expect(host.querySelector('svg > g')?.getAttribute('transform')).toContain('scale(1)');
    render('# Next\n- New');
    expect(host.querySelector('[aria-label="Branch"]')).toBeNull();
    expect(host.querySelector('[aria-label="New"]')).not.toBeNull();
  } finally { act(() => root.unmount()); setLanguage('en'); }
});

it('renders every character of a long label across multiple visible lines', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  const label = '蘇洵、蘇軾、蘇轍、歐陽修、王安石等北宋文學家留下了豐富的歷史資料和重要作品';
  try {
    act(() => root.render(<MindmapPreview content={`# Root\n- ${label}`} title="Note"/>));
    const node = host.querySelector<SVGGElement>(`[aria-label="${label}"]`)!;
    expect(node).not.toBeNull();
    expect([...node.querySelectorAll('tspan')].map(line => line.textContent).join('')).toBe(label);
    expect(Number(node.querySelector('rect')?.getAttribute('height'))).toBeGreaterThan(48);
  } finally { act(() => root.unmount()); }
});


it('loads local thumbnails, opens by mouse or keyboard and closes by button, Escape and backdrop', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setLanguage('zh-CN');
  const data = 'data:image/png;base64,aGVsbG8=';
  vi.mocked(workspace).mockResolvedValue(data);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MindmapPreview path="notes/note.md" title="Note" content={'# Root\n- ![Photo](../attachments/photo.png)\n  - Child\n\n![remote](https://example.com/remote.png)'}/>));
    expect(workspace).toHaveBeenCalledWith({ action: 'attachment', path: 'attachments/photo.png' });
    expect(host.querySelectorAll('image')).toHaveLength(1);
    const thumbnail = host.querySelector<SVGElement>('image')!;
    expect(thumbnail.getAttribute('href')).toBe(data);
    const open = () => act(() => thumbnail.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    open();
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog()?.querySelector('img')?.getAttribute('src')).toBe(data);
    expect(host.querySelector('[aria-label="Child"]')).not.toBeNull();
    act(() => dialog()!.querySelector<HTMLImageElement>('img')!.click());
    expect(dialog()).not.toBeNull();
    act(() => dialog()!.querySelector<HTMLButtonElement>('button')!.click());
    expect(dialog()).toBeNull();
    act(() => thumbnail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(dialog()).not.toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(dialog()).toBeNull();
    open();
    act(() => dialog()!.click());
    expect(dialog()).toBeNull();
    open();
    await act(async () => root.render(<MindmapPreview content="# Other" title="Other"/>));
    expect(dialog()).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); setLanguage('en'); }
});

it('leaves an unavailable image placeholder when attachment loading fails', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(workspace).mockRejectedValue(new Error('missing attachment'));
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MindmapPreview content="![](attachments/missing.png)" title="Note"/>));
    expect(host.querySelector('image')).toBeNull();
    expect(host.textContent).toContain('Image attachment:');
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
