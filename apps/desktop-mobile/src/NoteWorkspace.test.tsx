// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoteWorkspace } from './NoteWorkspace';
import { setLanguage } from './i18n';

let host: HTMLDivElement, root: Root;
const content = '# Start\n\n## Repeat\n\n## Repeat\n';
function render(mode: 'source' | 'preview' | 'split' = 'source', path = 'current.md') {
  act(() => root.render(<NoteWorkspace visible vaultId="vault-a" path={path} title="Current" content={content} saveStatus="Saved" notes={[]} mode={mode} busy={false} composing={false} syncBlocked={false} syncing={false} pinned={false} relationsOpen sidebarVisible onToggleSidebar={()=>{}} onMode={()=>{}} onSummary={()=>{}} onTogglePin={()=>{}} onImportImage={()=>{}} onPasteImage={async()=>null} onToggleRelations={()=>{}} onCloseRelations={()=>{}} onManage={()=>{}} onHistory={()=>{}} onChange={()=>{}} onComposition={()=>{}} onOpen={()=>{}} onLink={()=>{}} onTag={()=>{}} onError={()=>{}}/>));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
  setLanguage('zh-CN'); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); setLanguage('en'); });
describe('note outline panel', () => {
  it('keeps duplicate headings separate and moves the source cursor to the chosen heading', () => {
    render();
    const tabs = host.querySelectorAll('[role=tab]');
    expect([...tabs].map(tab => tab.textContent)).toEqual(['大纲','关联信息']);
    const headings = host.querySelectorAll<HTMLButtonElement>('.outline-item');
    expect(headings).toHaveLength(3);
    act(() => headings[2].click());
    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
    expect(view.state.selection.main.anchor).toBe(content.lastIndexOf('## Repeat'));
    render('source','another.md');
    expect(EditorView.findFromDOM(host.querySelector('.cm-editor')!)!.state.selection.main.anchor).toBe(0);
  });
  it('maps a preview jump to the matching heading offset', () => {
    render('preview');
    const headings = host.querySelectorAll<HTMLButtonElement>('.outline-item');
    act(() => headings[1].click());
    expect(host.querySelector(`[data-outline-offset="${content.indexOf('## Repeat')}"]`)).not.toBeNull();
  });
});
