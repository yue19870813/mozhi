// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentSession } from "./session";
import { useVaultFileChanges } from "./useVaultFileChanges";
import type { Note } from "./api";

const bridge = vi.hoisted(() => ({ read: vi.fn(), workspace: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock("./api", () => ({
  native: true,
  api: { read: bridge.read },
  workspace: bridge.workspace,
  errorText: (e: unknown) => String(e),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));

const note = { path: "a.md", content: "old", contentHash: "h0" };
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.resetAllMocks();
  bridge.workspace.mockResolvedValue("initial");
  bridge.read.mockResolvedValue(note);
  bridge.listen.mockResolvedValue(bridge.stop);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function mount() {
  const session = { current: new DocumentSession({ ...note }, vi.fn()) };
  const setError = vi.fn(), reload = vi.fn().mockResolvedValue(undefined);
  const syncingRef = { current: false };
  function Harness({ vaultId = "vault" }: { vaultId?: string }) {
    useVaultFileChanges({
      vaultId, session, syncingRef,
      operation: { current: false }, isComposing: { current: false },
      reload, setError, run: async (action) => action(),
    });
    return null;
  }
  await act(async () => root.render(<Harness />));
  return { session, setError, reload, syncingRef, Harness };
}
async function tick(ms = 5000) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

it("refreshes external changes when the document has no draft", async () => {
  const h = await mount();
  bridge.workspace.mockResolvedValue("external");
  await tick();
  await tick();
  expect(h.reload).toHaveBeenCalledOnce();
  expect(h.setError).not.toHaveBeenCalled();
});

it("waits for synchronization to finish before checking files", async () => {
  const h = await mount();
  h.syncingRef.current = true;
  bridge.workspace.mockResolvedValue("sync changed files");
  await tick(10000);
  expect(bridge.workspace).toHaveBeenCalledOnce();
  expect(h.reload).not.toHaveBeenCalled();
  h.syncingRef.current = false;
  await tick(1000);
  expect(h.reload).toHaveBeenCalledOnce();
});

it("does not warn about an autosave while the user is editing again", async () => {
  const h = await mount();
  h.session.current.note = { ...note, content: "saved", contentHash: "h1" };
  h.session.current.text = "next draft";
  bridge.workspace.mockResolvedValue("own save");
  bridge.read.mockResolvedValue(h.session.current.note);
  await tick();
  expect(h.setError).not.toHaveBeenCalled();
  expect(h.reload).not.toHaveBeenCalled();
  expect(h.session.current.text).toBe("next draft");
});

it("preserves a dirty draft and warns once per distinct external change", async () => {
  const h = await mount();
  h.session.current.text = "draft";
  bridge.workspace.mockResolvedValue("external");
  bridge.read.mockResolvedValue({ ...note, content: "external", contentHash: "external" });
  await tick();
  await tick(10000);
  expect(h.setError).toHaveBeenCalledTimes(1);
  expect(h.reload).not.toHaveBeenCalled();
  expect(h.session.current.text).toBe("draft");
  expect(h.session.current.note.contentHash).toBe("h0");
  bridge.workspace.mockResolvedValue("another external change");
  await tick();
  expect(h.setError).toHaveBeenCalledTimes(2);
});

it("defers unrelated changes until the draft is saved", async () => {
  const h = await mount();
  h.session.current.text = "draft";
  bridge.workspace.mockResolvedValue("other note changed");
  await tick();
  expect(h.setError).not.toHaveBeenCalled();
  expect(h.reload).not.toHaveBeenCalled();
  h.session.current.note = { ...note, content: "draft", contentHash: "saved" };
  await tick(1000);
  expect(h.reload).toHaveBeenCalledOnce();
});

it("rechecks after an in-flight save without mistaking its disk write for a conflict", async () => {
  const h = await mount();
  let acknowledge!: (value: { note: Note }) => void;
  const saved = { ...note, content: "saved", contentHash: "h1" };
  h.session.current = new DocumentSession(note, () => new Promise((resolve) => { acknowledge = resolve; }));
  h.session.current.text = "saved";
  const saving = h.session.current.flush();
  await Promise.resolve();
  bridge.workspace.mockResolvedValue("own save");
  bridge.read.mockResolvedValue(saved);
  await tick();
  expect(bridge.read).not.toHaveBeenCalled();
  acknowledge({ note: saved });
  await saving;
  h.session.current.text = "next draft";
  await tick();
  expect(h.setError).not.toHaveBeenCalled();
});

it("discards a disk read invalidated by a save acknowledgement", async () => {
  const h = await mount();
  h.session.current.text = "draft";
  bridge.workspace.mockResolvedValue("own save");
  let finish!: (value: Note) => void;
  bridge.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await tick();
  const saved = { ...note, content: "draft", contentHash: "h1" };
  h.session.current.note = saved;
  h.session.current.text = "new draft";
  await act(async () => finish(saved));
  bridge.read.mockResolvedValue(saved);
  await tick();
  expect(h.setError).not.toHaveBeenCalled();
  expect(h.reload).not.toHaveBeenCalled();
});

it("validates watcher events through the same disk comparison", async () => {
  const h = await mount();
  h.session.current.text = "draft";
  bridge.workspace.mockResolvedValue("own save");
  const onChange = bridge.listen.mock.calls[0][1];
  onChange({ payload: { vaultId: "vault" } });
  await tick(1000);
  expect(bridge.read).toHaveBeenCalledOnce();
  expect(h.setError).not.toHaveBeenCalled();
  onChange({ payload: { vaultId: "vault" } });
  await tick(1000);
  expect(bridge.read).toHaveBeenCalledOnce();
});

it("ignores late results from the previous vault", async () => {
  const h = await mount();
  h.session.current.text = "draft";
  bridge.workspace.mockResolvedValue("changed");
  let finish!: (value: Note) => void;
  bridge.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await tick();
  await act(async () => root.render(<h.Harness vaultId="other" />));
  await act(async () => finish({ ...note, contentHash: "external" }));
  expect(h.setError).not.toHaveBeenCalled();
  expect(h.reload).not.toHaveBeenCalled();
});
