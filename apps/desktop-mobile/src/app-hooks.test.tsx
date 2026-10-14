// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNoteSearch } from "./useNoteSearch";
import { useVaultSync } from "./useVaultSync";
import { useNoteDocument } from "./useNoteDocument";
import { AutoSyncSchedule, defaultAutoSync } from "./auto-sync";
import { setLanguage } from "./i18n";
import type { Vault, SearchResult } from "./api";

const bridge = vi.hoisted(() => ({
  workspace: vi.fn(),
  read: vi.fn(),
  readDraft: vi.fn(),
  save: vi.fn(),
  checkSshAgent: vi.fn(),
  selectSshKey: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("./api", () => ({
  native: true,
  workspace: bridge.workspace,
  api: bridge,
  errorText: (error: unknown) => String(error),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));
let root: Root, host: HTMLDivElement;
const error = vi.fn();
const vault = (id: string): Vault => ({
  id,
  name: id,
  demo: false,
  entries: [],
  skipped: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  bridge.workspace.mockReset();
  bridge.read.mockReset();
  bridge.readDraft.mockReset();
  bridge.save.mockReset();
  bridge.checkSshAgent.mockReset();
  bridge.selectSshKey.mockReset();
  bridge.invoke.mockReset().mockResolvedValue(null);
  bridge.listen.mockReset().mockResolvedValue(() => {});
  error.mockClear();
  localStorage.clear();
  setLanguage("zh-CN");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  setLanguage("en");
});

describe("extracted note search", () => {
  it("debounces filters and ignores old responses after switching libraries", async () => {
    let search!: ReturnType<typeof useNoteSearch>;
    const old = deferred<SearchResult>();
    const next = deferred<SearchResult>();
    bridge.workspace
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    function Harness({ opened }: { opened: Vault }) {
      search = useNoteSearch(opened, 0, error);
      return null;
    }
    act(() => root.render(<Harness opened={vault("a")} />));
    act(() => {
      search.setQuery("first");
      search.setQuery("second");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(bridge.workspace).toHaveBeenCalledTimes(1);
    expect(bridge.workspace).toHaveBeenLastCalledWith({
      action: "search",
      query: "second",
      directory: "",
      tag: "",
      filenameOnly: false,
    });
    act(() => root.render(<Harness opened={vault("b")} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const result = {
      hits: [{ path: "new.md", title: "new", excerpt: "new" }],
      elapsedMs: 1,
      strategy: "keyword",
    };
    await act(async () => {
      next.resolve(result);
      await next.promise;
      old.reject(new Error("old vault"));
      await Promise.resolve();
    });
    expect(search.results).toEqual(result);
    expect(error).not.toHaveBeenCalled();
  });
  it("clears results and cancels pending debounce when filters are cleared", async () => {
    let search!: ReturnType<typeof useNoteSearch>;
    const opened = vault("a");
    function Harness() {
      search = useNoteSearch(opened, 0, error);
      return null;
    }
    act(() => root.render(<Harness />));
    act(() => search.setQuery("temporary"));
    act(() => search.setQuery(""));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(bridge.workspace).not.toHaveBeenCalled();
    expect(search.results).toBeNull();
  });
});

describe("extracted note document", () => {
  function harness() {
    const syncingRef = { current: false },
      autoSchedule = { current: new AutoSyncSchedule(Date.now()) };
    const onLoaded = vi.fn(),
      updateKnowledge = vi.fn().mockResolvedValue(undefined),
      setStatus = vi.fn();
    let document!: ReturnType<typeof useNoteDocument>;
    function Harness() {
      document = useNoteDocument({
        syncingRef,
        autoSchedule,
        onLoaded,
        updateKnowledge,
        setError: error,
        setStatus,
      });
      return null;
    }
    act(() => root.render(<Harness />));
    return {
      get document() {
        return document;
      },
      syncingRef,
      autoSchedule,
      onLoaded,
      updateKnowledge,
      setStatus,
    };
  }
  it("keeps recovery drafts separate from disk contents and ignores edits during sync", async () => {
    const h = harness();
    bridge.read.mockResolvedValue({
      path: "note.md",
      content: "saved",
      contentHash: "hash",
    });
    bridge.readDraft.mockResolvedValue("recovery draft");
    await act(async () => {
      await h.document.loadNote("note.md");
    });
    expect(h.document.content).toBe("saved");
    expect(h.document.recovery).toBe("recovery draft");
    expect(h.onLoaded).toHaveBeenCalledOnce();
    h.syncingRef.current = true;
    act(() => {
      h.document.change("blocked edit");
    });
    expect(h.document.content).toBe("saved");
    expect(h.document.session.current?.dirty).toBe(false);
    h.syncingRef.current = false;
    act(() => {
      h.document.change("new content");
      h.document.composition(true);
    });
    expect(h.document.session.current?.dirty).toBe(true);
    expect(h.document.isComposing.current).toBe(true);
  });
  it("retains dirty content on failed saves and schedules sync only after successful disk acknowledgment", async () => {
    const h = harness();
    bridge.read.mockResolvedValue({
      path: "note.md",
      content: "saved",
      contentHash: "hash",
    });
    bridge.readDraft.mockResolvedValue(null);
    await act(async () => {
      await h.document.loadNote("note.md");
    });
    act(() => h.document.change("edited"));
    bridge.save.mockRejectedValueOnce(new Error("disk changed"));
    await act(async () => {
      await expect(h.document.flush()).rejects.toThrow("disk changed");
    });
    expect(h.document.content).toBe("edited");
    expect(h.document.session.current?.dirty).toBe(true);
    expect(h.updateKnowledge).not.toHaveBeenCalled();
    expect(h.autoSchedule.current.savedAt).toBeNull();
    bridge.save.mockResolvedValueOnce({
      note: { path: "note.md", content: "edited", contentHash: "new-hash" },
    });
    await act(async () => {
      await h.document.flush();
    });
    expect(h.document.session.current?.dirty).toBe(false);
    expect(h.document.session.current?.note.contentHash).toBe("new-hash");
    expect(h.updateKnowledge).toHaveBeenCalledOnce();
    expect(h.autoSchedule.current.savedAt).not.toBeNull();
  });
});

describe("extracted vault sync", () => {
  function harness(
    flush = vi.fn().mockResolvedValue(undefined),
    reload = vi.fn().mockResolvedValue(undefined),
  ) {
    const refs = {
      operation: { current: false },
      isComposing: { current: false },
      syncingRef: { current: false },
      session: { current: null },
      schedule: { current: new AutoSyncSchedule(Date.now()) },
      trayHidden: { current: false },
    };
    let sync!: ReturnType<typeof useVaultSync>;
    const setBusy = vi.fn(),
      setStatus = vi.fn();
    function Harness({
      id = "a",
      blocked = false,
    }: {
      id?: string;
      blocked?: boolean;
    }) {
      sync = useVaultSync({
        vaultId: id,
        busy: false,
        blocked,
        ...refs,
        flush,
        reload,
        setBusy,
        setError: error,
        setStatus,
      });
      return null;
    }
    act(() => root.render(<Harness />));
    return {
      get sync() {
        return sync;
      },
      refs,
      flush,
      reload,
      setBusy,
      setStatus,
      Harness,
    };
  }
  it("skips automatic Git sync without an SSH key and retries after loading one", async () => {
    const h = harness();
    const config = {
      protocol: "ssh",
      url: "git@example.com:notes.git",
      branch: "main",
      username: "git",
    };
    bridge.workspace.mockResolvedValueOnce(config);
    bridge.checkSshAgent.mockRejectedValueOnce(
      new Error("SSH Agent 尚未加载密钥，请选择 SSH 私钥"),
    );
    act(() => h.sync.configureAutoSync({ ...defaultAutoSync, enabled: true }));
    await act(async () => {
      await h.sync.syncNow(true);
    });
    expect(bridge.workspace.mock.calls.map((call) => call[0].action)).toEqual([
      "config",
    ]);
    expect(h.flush).not.toHaveBeenCalled();
    expect(h.sync.syncing).toBe(false);
    expect(h.refs.syncingRef.current).toBe(false);
    expect(h.sync.sshAgentError).toContain("SSH Agent 尚未加载密钥");
    expect(h.sync.autoPaused).toBe(true);

    bridge.selectSshKey.mockResolvedValueOnce({ keyCount: 1 });
    bridge.workspace
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ state: { phase: "idle", message: "" } });
    await act(async () => {
      await h.sync.loadSshKeyAndSync();
    });
    expect(bridge.workspace.mock.calls.map((call) => call[0].action)).toEqual([
      "config",
      "config",
      "sync",
    ]);
    expect(h.flush).toHaveBeenCalledOnce();
    expect(h.sync.sshAgentError).toBe("");
    expect(h.sync.autoPaused).toBe(false);
  });
  it("flushes before network sync, rejects duplicate triggers and releases guards after completion", async () => {
    const saved = deferred<void>();
    const h = harness(vi.fn(() => saved.promise));
    bridge.workspace
      .mockResolvedValueOnce({
        protocol: "ssh",
        url: "git@example.com:notes.git",
        branch: "main",
        username: "git",
      })
      .mockResolvedValueOnce({ state: { phase: "idle", message: "" } });
    let task!: Promise<void>;
    act(() => {
      task = h.sync.syncNow();
    });
    expect(h.refs.syncingRef.current).toBe(true);
    expect(bridge.workspace).not.toHaveBeenCalled();
    await act(async () => {
      await h.sync.syncNow();
    });
    expect(h.flush).toHaveBeenCalledTimes(1);
    await act(async () => {
      saved.resolve();
      await task;
    });
    expect(bridge.workspace.mock.calls.map((call) => call[0].action)).toEqual([
      "config",
      "sync",
    ]);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.refs.syncingRef.current).toBe(false);
    expect(h.refs.operation.current).toBe(false);
    expect(h.sync.syncing).toBe(false);
    expect(h.setStatus).toHaveBeenCalledWith("同步完成");
  });
  it("never calls the network if saving fails and releases the operation guard", async () => {
    const h = harness(vi.fn().mockRejectedValue(new Error("disk conflict")));
    await act(async () => {
      await h.sync.syncNow();
    });
    expect(bridge.workspace).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Error: disk conflict");
    expect(h.refs.operation.current).toBe(false);
    expect(h.refs.syncingRef.current).toBe(false);
  });
  it("pauses automatic sync after failure and isolates settings when the vault changes", async () => {
    const h = harness();
    bridge.workspace
      .mockResolvedValueOnce({
        protocol: "ssh",
        url: "git@example.com:notes.git",
        branch: "main",
        username: "git",
      })
      .mockRejectedValueOnce(new Error("offline"));
    act(() => h.sync.configureAutoSync({ ...defaultAutoSync, enabled: true }));
    await act(async () => {
      await h.sync.syncNow(true);
    });
    expect(h.sync.autoPaused).toBe(true);
    expect(h.refs.schedule.current.paused).toBe(true);
    const calls = bridge.workspace.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(bridge.workspace).toHaveBeenCalledTimes(calls);
    act(() => root.render(<h.Harness id="b" />));
    expect(h.sync.autoSync.enabled).toBe(false);
    expect(h.sync.autoPaused).toBe(false);
    expect(
      JSON.parse(localStorage.getItem("mozhi-auto-sync-v1:a")!).enabled,
    ).toBe(true);
  });
  it("reconciles a completed tray sync when the window returns", async () => {
    const h = harness();
    await act(async () => { await Promise.resolve(); });
    bridge.invoke.mockResolvedValueOnce({
      vaultId: "a", running: false, revision: 3,
      lastSyncAt: Date.now(), lastError: null, completed: true,
    });
    const finished = bridge.listen.mock.calls.find(([name]) => name === "tray_sync_finished")?.[1];
    expect(finished).toBeTypeOf("function");
    await act(async () => { finished(); await Promise.resolve(); });
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.sync.syncRevision).toBe(1);
    expect(h.sync.autoPaused).toBe(false);
    expect(h.refs.schedule.current.opened).toBe(false);
  });
});
