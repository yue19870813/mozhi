// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import App from './App';
import { setLanguage } from './i18n';

it('keeps the editor and undo history mounted while modules switch and saves the document before navigation', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const media = {matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()};
  vi.stubGlobal('matchMedia',()=>media);
  Range.prototype.getClientRects=()=>[] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect=()=>new DOMRect();
  Element.prototype.scrollIntoView=vi.fn();
  localStorage.clear();setLanguage('zh-CN');
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>{root.render(<App/>);});
    const nav=(label:string)=>host.querySelector(`.module-rail [aria-label="${label}"]`) as HTMLButtonElement;
    await act(async()=>{nav('我的笔记').click();});
    expect(nav('我的笔记').getAttribute('aria-current')).toBe('page');
    const view=EditorView.findFromDOM(host.querySelector('.note-workspace .cm-editor')!)!;
    const original=view.state.doc.toString();
    expect(host.querySelector('.note-metrics')?.textContent).toContain('阅读约');
    expect(host.querySelector('.note-save-state')?.textContent).toContain('已更新演示内容');
    act(()=>{view.dispatch({changes:{from:original.length,insert:'\nsynthetic refactor test'}});});
    expect(host.querySelector('.note-save-state')?.textContent).toContain('待保存');
    await act(async()=>{nav('设置').click();});
    expect(host.querySelector('.save-status')?.textContent).toContain('已更新演示内容');
    await act(async()=>{nav('我的笔记').click();});
    expect(EditorView.findFromDOM(host.querySelector('.note-workspace .cm-editor')!)).toBe(view);
    expect(view.state.doc.toString()).toContain('synthetic refactor test');
    act(()=>{undo(view);});
    expect(view.state.doc.toString()).toBe(original);
    await act(async()=>{nav('首页').click();});
  } finally {
    act(()=>root.unmount());host.remove();vi.unstubAllGlobals();setLanguage('en');
  }
});
