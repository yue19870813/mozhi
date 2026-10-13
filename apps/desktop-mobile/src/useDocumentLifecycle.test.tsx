// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useDocumentLifecycle } from "./useDocumentLifecycle";
import { DocumentSession } from "./session";
import { AutoSyncSchedule } from "./auto-sync";

const bridge = vi.hoisted(() => ({
  draft: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
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
    destroy: bridge.destroy,
  }),
}));
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
function harness() {
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
      vaultRef: { current: null },
      autoSchedule: { current: new AutoSyncSchedule(Date.now()) },
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
it("blocks close during sync or composition and never destroys the window if saving fails", async () => {
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
  expect(bridge.destroy).not.toHaveBeenCalled();
  expect(h.error).toHaveBeenCalled();
  await close(event);
  expect(bridge.destroy).toHaveBeenCalledOnce();
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
  expect(bridge.unlisten).toHaveBeenCalledTimes(2);
  finish(bridge.unlisten);
  await Promise.resolve();
  expect(bridge.unlisten).toHaveBeenCalledTimes(3);
});
