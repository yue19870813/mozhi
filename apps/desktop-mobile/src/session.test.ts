import { describe, expect, it } from 'vitest';
import { DocumentSession } from './session';
describe('autosave concurrency', () => {
  it('retains edits typed during an in-flight save and advances the expected hash', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const session = new DocumentSession({ path: 'a.md', content: 'old', contentHash: 'h0' }, async (note, content) => {
      calls.push(`${note.contentHash}:${content}`);
      if (calls.length === 1) await gate;
      return { note: { ...note, content, contentHash: `h${calls.length}` } };
    });
    session.text = 'first';
    const first = session.flush();
    await new Promise(resolve => setTimeout(resolve, 0));
    session.text = 'second';
    const second = session.flush();
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual(['h0:first', 'h1:second']);
    expect(session.dirty).toBe(false);
  });
  it('keeps the previous hash and current draft on conflict', async () => {
    const session = new DocumentSession({ path: 'a.md', content: 'disk', contentHash: 'h0' }, async () => { throw new Error('conflict'); });
    session.text = 'draft';
    await expect(session.flush()).rejects.toThrow('conflict');
    expect(session.text).toBe('draft');
    expect(session.note.contentHash).toBe('h0');
    expect(session.dirty).toBe(true);
  });
});
