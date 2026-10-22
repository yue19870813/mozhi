// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
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
