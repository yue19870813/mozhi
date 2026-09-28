import { describe, expect, it, vi } from 'vitest';
import { afterSave } from './navigation';
import { DocumentSession } from './session';
describe('navigation save protection', () => {
  it('retains the current document and draft when saving fails', async () => {
    const session=new DocumentSession({path:'a.md',content:'disk',contentHash:'old'},async()=>{throw new Error('conflict');});
    session.text='unsaved 中文';const navigate=vi.fn(async()=>{});
    await expect(afterSave(false,()=>session.flush(),navigate)).rejects.toThrow('conflict');
    expect(navigate).not.toHaveBeenCalled();expect(session.text).toBe('unsaved 中文');expect(session.dirty).toBe(true);
  });
  it('does not save or navigate during composition or a competing operation', async () => {
    const save=vi.fn(async()=>{}),navigate=vi.fn(async()=>{});
    expect(await afterSave(true,save,navigate)).toBe(false);
    expect(save).not.toHaveBeenCalled();expect(navigate).not.toHaveBeenCalled();
  });
  it('waits for disk acknowledgement before changing the visible module', async () => {
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const navigate=vi.fn(async()=>{});const pending=afterSave(false,()=>wait,navigate);
    expect(navigate).not.toHaveBeenCalled();release();expect(await pending).toBe(true);expect(navigate).toHaveBeenCalledOnce();
  });
});
