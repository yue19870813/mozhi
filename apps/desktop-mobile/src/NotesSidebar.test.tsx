// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NotesSidebar } from './NotesSidebar';
import { useNoteSearch } from './useNoteSearch';
import { setLanguage } from './i18n';

const bridge = vi.hoisted(() => ({ workspace: vi.fn() }));
vi.mock('./api', () => ({ native: true, workspace: bridge.workspace, errorText: String }));

it('clears all search controls and ignores a response arriving after reset', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setLanguage('zh-CN');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let search!: ReturnType<typeof useNoteSearch>;
  let resolve!: (value: unknown) => void;
  bridge.workspace.mockReturnValue(new Promise(done => { resolve = done; }));
  const onError = vi.fn(), noop = () => {};
  function Harness() {
    search = useNoteSearch(null, 0, onError);
    const field = useRef<HTMLInputElement>(null);
    return <NotesSidebar path="" pinnedNotes={[]} dropTarget={null} onTogglePin={noop}
      onNewNote={noop} onNewDirectory={noop} onRefresh={noop} visible busy={false}
      composing={false} syncing={false} syncBlocked={false} search={search}
      searchField={field} tags={['读书']} tree={[{path:'笔记',isDirectory:true}]}
      visibleTree={[]} collapsed={new Set()} selectedTreePath="" dragSource=""
      dropTargetRow={null} dragSourceRef={{current:''}} setCollapsed={noop}
      setSelectedDirectory={noop} setSelectedTreePath={noop} setDragSource={noop}
      setDropTarget={noop} setDropTargetRow={noop} onManage={noop} onOpen={noop}
      onShowTreeMenu={noop} onClearDrag={noop} onDragOverFolder={noop} onDropIntoFolder={noop}/>;
  }
  try {
    act(() => root.render(<Harness/>));
    expect(host.querySelector('.clear-search')).toBeNull();
    act(() => {
      search.setQuery('tag:读书');
      search.setTag('读书');
      search.setDirectory('笔记');
      search.setFilenameOnly(true);
    });
    await act(async () => { await new Promise(done => setTimeout(done, 250)); });
    expect(bridge.workspace).toHaveBeenCalledTimes(1);
    act(() => (host.querySelector('.clear-search') as HTMLButtonElement).click());
    expect(search.query).toBe('');
    expect(search.tag).toBe('');
    expect(search.directory).toBe('');
    expect(search.filenameOnly).toBe(false);
    expect(search.results).toBeNull();
    expect(host.querySelector('.clear-search')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[aria-label="搜索笔记"]'));
    await act(async () => {
      resolve({hits:[{path:'old.md',title:'old',excerpt:''}],elapsedMs:1,strategy:'keyword'});
      await Promise.resolve();
    });
    expect(search.results).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    // The reset action is also available when only the checkbox is active.
    act(() => search.setFilenameOnly(true));
    expect(host.querySelector('.clear-search')).not.toBeNull();
    act(() => (host.querySelector('.clear-search') as HTMLButtonElement).click());
    expect(search.filenameOnly).toBe(false);
  } finally {
    act(() => root.unmount());
    host.remove();
    setLanguage('en');
  }
});
