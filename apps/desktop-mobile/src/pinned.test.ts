import { describe, expect, it } from 'vitest';
import { movePinned, prunePinned, readPinned, togglePinned, writePinned } from './pinned';
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
describe('pinned notes', () => {
  it('persists pin and unpin separately for each vault across reloads', () => {
    const store = storage();
    writePinned(store, 'a', togglePinned([], '计划.md'));
    writePinned(store, 'b', ['计划.md']);
    expect(readPinned(store, 'a')).toEqual(['计划.md']);
    writePinned(store, 'a', togglePinned(readPinned(store, 'a'), '计划.md'));
    expect(readPinned(store, 'a')).toEqual([]);
    expect(readPinned(store, 'b')).toEqual(['计划.md']);
  });
  it('puts newly pinned notes first without duplicates', () => {
    expect(togglePinned(['旧笔记.md'], '新笔记.md')).toEqual(['新笔记.md', '旧笔记.md']);
    expect(togglePinned(['新笔记.md', '旧笔记.md'], '新笔记.md')).toEqual(['旧笔记.md']);
  });
  it('keeps pins when notes or directories move without changing sibling prefixes', () => {
    const paths = movePinned(['a/计划.md', 'a/sub/资料.md', 'ab/资料.md'], 'a', 'b');
    expect(paths).toEqual(['b/计划.md', 'b/sub/资料.md', 'ab/资料.md']);
    expect(movePinned(paths, 'b/计划.md', 'b/新计划.md')[0]).toBe('b/新计划.md');
    expect(prunePinned(paths, ['b/计划.md', 'ab/资料.md'])).toEqual(['b/计划.md', 'ab/资料.md']);
  });
  it('ignores corrupt storage and invalid entries without preventing note loading', () => {
    const store = storage();
    store.setItem('mozhi-pinned-v1:a', '{broken');
    expect(readPinned(store, 'a')).toEqual([]);
    store.setItem('mozhi-pinned-v1:a', JSON.stringify([null, {}, 3, '', 'image.png', '笔记.md', '笔记.md']));
    expect(readPinned(store, 'a')).toEqual(['笔记.md']);
    expect(readPinned({ getItem: () => { throw new Error('unavailable'); }, setItem: () => {} }, 'a')).toEqual([]);
  });
});
