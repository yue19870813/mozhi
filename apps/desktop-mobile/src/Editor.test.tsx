// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { SearchQuery, setSearchQuery, replaceAll, replaceNext, openSearchPanel, findNext, searchPanelOpen } from '@codemirror/search';
import { undo } from '@codemirror/commands';
import { Editor } from './Editor';
import { setLanguage } from './i18n';
import { matchCount } from './editor-search';

let host: HTMLDivElement, root: Root;
const change = vi.fn();
function render(readOnly = false, documentKey = 'test') {
  act(() => root.render(<Editor documentKey={documentKey} value="墨知 notes 墨知 NOTES" readOnly={readOnly} onChange={change} onComposition={()=>{}}/>));
  return EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  setLanguage('zh-CN'); change.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); setLanguage('en'); });
describe('editor find and replace', () => {
  it('opens with the keyboard shortcut and counts matches without editing text', () => {
    const view = render();
    act(() => {
      view.focus();
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '墨知' })) });
    });
    expect(host.querySelector('[name=search]')).not.toBeNull();
    expect(host.textContent).toContain('2 处匹配');
    act(() => { findNext(view); });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('墨知');
    expect(change).not.toHaveBeenCalled();
  });
  it('replaces matches with one undo step and supports case and regular expression queries', () => {
    const view = render();
    act(() => {
      openSearchPanel(view);
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'notes', replace: '笔记', caseSensitive: true })) });
      replaceAll(view);
    });
    expect(view.state.doc.toString()).toBe('墨知 笔记 墨知 NOTES');
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe('墨知 notes 墨知 NOTES');
    act(() => {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'n\\w+', replace: '笔记', regexp: true })) });
      replaceAll(view);
    });
    expect(view.state.doc.toString()).toBe('墨知 笔记 墨知 笔记');
  });
  it('hides replacement controls and blocks both replace commands when switching to read-only', () => {
    const view = render();
    act(() => { openSearchPanel(view); view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '墨知', replace: 'changed' })) }); });
    expect(host.querySelector('[name=replace]')).not.toBeNull();
    render(true);
    expect(host.querySelector('[name=replace]')).toBeNull();
    act(() => { expect(replaceAll(view)).toBe(false); expect(replaceNext(view)).toBe(false); });
    expect(view.state.doc.toString()).toBe('墨知 notes 墨知 NOTES');
    expect(change).not.toHaveBeenCalled();
    render(false);
    expect(host.querySelector('[name=replace]')).not.toBeNull();
  });
  it('handles whole-word and invalid queries and closes the panel with Escape', () => {
    const view = render();
    expect(matchCount(view.state, new SearchQuery({ search: 'note', wholeWord: true }))).toBe('0');
    expect(matchCount(view.state, new SearchQuery({ search: '[', regexp: true }))).toBe('0');
    act(() => { openSearchPanel(view); });
    act(() => { host.querySelector('[name=search]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); });
    expect(searchPanelOpen(view.state)).toBe(false);
  });
  it('commits panel input and replaces only the selected occurrence through the visible button', () => {
    const view = render();
    act(() => { openSearchPanel(view); });
    act(() => {
      const input = host.querySelector('[name=search]') as HTMLInputElement;
      input.value = '墨知'; input.dispatchEvent(new Event('change', { bubbles: true }));
      const replacement = host.querySelector('[name=replace]') as HTMLInputElement;
      replacement.value = '墨烛'; replacement.dispatchEvent(new Event('change', { bubbles: true }));
      findNext(view);
      (host.querySelector('[name=replace].cm-button') as HTMLButtonElement).click();
    });
    expect(view.state.doc.toString()).toBe('墨烛 notes 墨知 NOTES');
    expect(change).toHaveBeenCalledWith('墨烛 notes 墨知 NOTES');
  });
  it('updates panel language without losing the query and clears it when switching notes', () => {
    const view = render();
    act(() => { openSearchPanel(view); view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '墨知' })) }); setLanguage('zh-TW'); });
    expect(host.querySelector('[name=replace]')?.getAttribute('placeholder')).toBe('替換');
    expect((host.querySelector('[name=search]') as HTMLInputElement).value).toBe('墨知');
    render(false, 'other-note');
    expect(host.querySelector('[name=search]')).toBeNull();
    expect(host.querySelector('[role=status]')).toBeNull();
  });
});
