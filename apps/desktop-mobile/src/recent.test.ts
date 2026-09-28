import { describe, expect, it } from 'vitest';
import { moveRecent, pruneRecent, readRecent, visitRecent, writeRecent } from './recent';
const note = (path: string, openedAt = 1) => ({ path, title: path, openedAt });
function storage() { const data = new Map<string,string>(); return { getItem: (key:string) => data.get(key) ?? null, setItem: (key:string,value:string) => { data.set(key,value); } }; }
describe('recently opened notes', () => {
  it('persists visits independently for each vault without counting startup', () => {
    const store=storage();expect(readRecent(store,'a')).toEqual([]);
    writeRecent(store,'a',[note('工作/计划.md')]);writeRecent(store,'b',[note('学习/计划.md')]);
    expect(readRecent(store,'a').map(n=>n.path)).toEqual(['工作/计划.md']);
    expect(readRecent(store,'b').map(n=>n.path)).toEqual(['学习/计划.md']);
  });
  it('moves repeat visits to the front and caps the history at fifty', () => {
    let entries=Array.from({length:50},(_,i)=>note(`${i}.md`,50-i));
    entries=visitRecent(entries,note('20.md',60));expect(entries[0].path).toBe('20.md');expect(entries).toHaveLength(50);
    entries=visitRecent(entries,note('new.md',61));expect(entries).toHaveLength(50);expect(entries.some(n=>n.path==='49.md')).toBe(false);
  });
  it('moves descendants without matching sibling prefixes and prunes deleted or unreadable notes', () => {
    const entries=moveRecent([note('a/x.md'),note('a/sub/y.md'),note('ab/z.md')],'a','b');
    expect(entries.map(n=>n.path)).toEqual(['b/x.md','b/sub/y.md','ab/z.md']);
    expect(pruneRecent(entries,['b/x.md','ab/z.md'],['ab/z.md']).map(n=>n.path)).toEqual(['b/x.md']);
  });
  it('recovers from malformed local storage without affecting note loading', () => {
    const store=storage();store.setItem('mozhi-recent-v1:a','{bad');expect(readRecent(store,'a')).toEqual([]);
    store.setItem('mozhi-recent-v1:a',JSON.stringify([null,{},note('ok.md')]));expect(readRecent(store,'a')).toEqual([note('ok.md')]);
  });
});
