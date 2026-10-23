// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it } from 'vitest';
import { readCollapsedFolders, useCollapsedFolders } from './useCollapsedFolders';

beforeEach(() => { localStorage.clear(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
it('restores collapsed folders after remount and keeps different vaults separate', () => {
  const host = document.createElement('div');
  let root = createRoot(host);
  let state!: ReturnType<typeof useCollapsedFolders>;
  function Harness() { state = useCollapsedFolders(); return null; }
  act(() => root.render(<Harness/>));
  act(() => state.restore('a'));
  act(() => state.setCollapsed(new Set(['工作', '工作/项目'])));
  act(() => state.restore('b'));
  expect([...state.collapsed]).toEqual([]);
  act(() => state.setCollapsed(new Set(['私人'])));
  act(() => state.restore('a'));
  expect([...state.collapsed]).toEqual(['工作', '工作/项目']);
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(<Harness/>));
  act(() => state.restore('a'));
  expect([...state.collapsed]).toEqual(['工作', '工作/项目']);
  act(() => state.setCollapsed(old => new Set([...old].filter(path => path !== '工作'))));
  expect([...readCollapsedFolders('a')]).toEqual(['工作/项目']);
  expect([...readCollapsedFolders('b')]).toEqual(['私人']);
  act(() => root.unmount());
});
it('recovers malformed preferences without preventing startup', () => {
  localStorage.setItem('mozhi-collapsed-folders-v1:a', 'invalid');
  expect([...readCollapsedFolders('a')]).toEqual([]);
  localStorage.setItem('mozhi-collapsed-folders-v1:a', JSON.stringify(['folder', null, 1, '', 'folder']));
  expect([...readCollapsedFolders('a')]).toEqual(['folder']);
});
