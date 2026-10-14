// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useDocumentLifecycle } from "./useDocumentLifecycle";
import { DocumentSession } from "./session";
import { AutoSyncSchedule } from "./auto-sync";
import type { Vault } from "./api";

const bridge = vi.hoisted(() => ({
  draft: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("./api", () => ({
  native: true,
  api: { draft: bridge.draft },
  errorText: (e: unknown) => String(e),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: bridge.close,
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  bridge.close.mockResolvedValue(bridge.unlisten);
  bridge.listen.mockResolvedValue(bridge.unlisten);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
function harness(vaultId?: string) {
  const session = {
    current: new DocumentSession(
      { path: "synthetic.md", content: "old", contentHash: "hash" },
      vi.fn(),
    ),
  };
  session.current.text = "draft";
  const operation = { current: false },
    isComposing = { current: false },
    syncingRef = { current: false };
  const flush = vi.fn().mockResolvedValue(undefined),
    error = vi.fn();
  function Harness({ content = "draft" }: { content?: string }) {
    useDocumentLifecycle({
      content,
      composing: false,
      busy: false,
      modal: null,
      history: null,
      session,
      operation,
      isComposing,
      syncingRef,
      vaultRef: { current: vaultId ? { id: vaultId, name: vaultId, demo: false, entries: [], skipped: [] } satisfies Vault : null },
      autoSchedule: { current: new AutoSyncSchedule(Date.now()) },
      trayHidden: { current: false },
      autoSync: { enabled: true, onOpen: true, afterSave: true, idleSeconds: 30, intervalMinutes: 5 },
      autoPaused: false,
      syncBlocked: false,
      flush,
      updateKnowledge: vi.fn(),
      reload: vi.fn(),
      run: async (action) => action(),
      openSearch: vi.fn(),
      newNote: vi.fn(),
      setError: error,
      setStatus: vi.fn(),
    });
    return null;
  }
  act(() => root.render(<Harness />));
  return { session, operation, isComposing, syncingRef, flush, error, Harness };
}
it("writes a draft before automatic save and clears pending timers on unmount", async () => {
  const h = harness();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(bridge.draft).toHaveBeenCalledWith("synthetic.md", "draft");
  expect(h.flush).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(h.flush).toHaveBeenCalledOnce();
  act(() => root.render(<h.Harness content="next" />));
  act(() => root.unmount());
  root = createRoot(host);
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.flush).toHaveBeenCalledOnce();
});
it("blocks hiding during sync, composition or a failed save", async () => {
  const h = harness();
  await act(async () => {
    await Promise.resolve();
  });
  const close = bridge.close.mock.calls[0][0];
  const event = { preventDefault: vi.fn() };
  h.syncingRef.current = true;
  await close(event);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(h.flush).not.toHaveBeenCalled();
  h.syncingRef.current = false;
  h.isComposing.current = true;
  await close(event);
  expect(h.flush).not.toHaveBeenCalled();
  h.isComposing.current = false;
  h.flush.mockRejectedValueOnce(new Error("disk conflict"));
  await close(event);
  expect(bridge.invoke).not.toHaveBeenCalled();
  expect(h.error).toHaveBeenCalled();
  await close(event);
  expect(bridge.invoke).toHaveBeenCalledWith("hide_to_tray", { schedule: null });
});
it("passes the current vault schedule to the native tray and quits only after saving", async () => {
  const h = harness("vault-a");
  await act(async () => { await Promise.resolve(); });
  const close = bridge.close.mock.calls[0][0];
  await close({ preventDefault: vi.fn() });
  expect(bridge.invoke).toHaveBeenCalledWith("hide_to_tray", { schedule: expect.objectContaining({
    vaultId: "vault-a", enabled: true, idleSeconds: 30, intervalMinutes: 5,
  }) });
  const quit = bridge.listen.mock.calls.find(([name]) => name === "tray_quit_requested")?.[1];
  expect(quit).toBeTypeOf("function");
  await act(async () => { quit(); await Promise.resolve(); });
  expect(h.flush).toHaveBeenCalledTimes(2);
  expect(bridge.invoke).toHaveBeenCalledWith("quit_app");
});
it("disposes native listeners even if registration finishes after unmount", async () => {
  let finish!: (stop: () => void) => void;
  bridge.close.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  harness();
  await act(async () => {
    await Promise.resolve();
  });
  act(() => root.unmount());
  root = createRoot(host);
  expect(bridge.unlisten).toHaveBeenCalledTimes(3);
  finish(bridge.unlisten);
  await Promise.resolve();
  expect(bridge.unlisten).toHaveBeenCalledTimes(4);
});
