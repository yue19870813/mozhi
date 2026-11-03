// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AutoSyncSchedule, defaultAutoSync } from './auto-sync';
import { useVaultSync } from './useVaultSync';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), workspace: vi.fn() }));
vi.mock('./api', () => ({ native: true, api: {}, workspace: bridge.workspace, errorText: String }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it('does not let a late running response re-lock the sync button after failure', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  bridge.listen.mockResolvedValue(() => {});
  let sync!: ReturnType<typeof useVaultSync>;
  const syncingRef = { current: false };
  const operation = { current: false };
  const isComposing = { current: false };
  const session = { current: null };
  const schedule = { current: new AutoSyncSchedule(Date.now()) };
  const trayHidden = { current: false };
  const onSyncSettled = vi.fn();
  function Harness() {
    sync = useVaultSync({
      vaultId: 'vault', busy: false, blocked: false, operation, isComposing,
      syncingRef, session, schedule, trayHidden, flush: async () => {},
      reload: async () => {}, setBusy: () => {}, setError: () => {}, setStatus: () => {}, onSyncSettled,
    });
    return null;
  }
  await act(async () => { root!.render(<Harness/>); await Promise.resolve(); });
  const started = bridge.listen.mock.calls.find(([name]) => name === 'tray_sync_started')?.[1];
  const finished = bridge.listen.mock.calls.find(([name]) => name === 'tray_sync_finished')?.[1];
  expect(started).toBeTypeOf('function');
  expect(finished).toBeTypeOf('function');

  const oldStart = deferred<{vaultId:string;running:boolean;revision:number;lastSyncAt:number;lastError:string|null;completed:boolean}>();
  const finish = deferred<{vaultId:string;running:boolean;revision:number;lastSyncAt:number;lastError:string|null;completed:boolean}>();
  bridge.invoke.mockReturnValueOnce(oldStart.promise).mockReturnValueOnce(finish.promise);
  started();
  finished();
  finish.resolve({ vaultId:'vault', running:false, revision:2, lastSyncAt:0, lastError:'SSH 握手失败', completed:true });
  oldStart.resolve({ vaultId:'vault', running:true, revision:1, lastSyncAt:0, lastError:null, completed:false });
  await act(async () => { await Promise.all([oldStart.promise, finish.promise]); await Promise.resolve(); });

  expect(sync.syncing).toBe(false);
  expect(syncingRef.current).toBe(false);
  expect(sync.autoPaused).toBe(true);
  expect(onSyncSettled).toHaveBeenCalledOnce();
});
