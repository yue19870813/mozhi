import { t, useLanguage } from "./i18n";
import { LanguageSettings } from "./LanguageSettings";
import { AboutPage } from "./AboutPage";
import { RefreshCw } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import {
  api,
  aiRequest,
  errorText,
  native,
  selectVault,
  workspace,
  type Note,
  type ParsedNote,
  type Vault,
} from "./api";
import { DocumentSession } from "./session";
import { Editor } from "./Editor";
import { NoteWorkspace } from "./NoteWorkspace";
import { platform } from "./platform";
import brandLogo from "./assets/brand-logo.png";
import { SyncPanel } from "./SyncPanel";
import { useVaultSync } from "./useVaultSync";
import { useNoteSearch } from "./useNoteSearch";
import { useDocumentLifecycle } from "./useDocumentLifecycle";
import { useNoteDocument } from "./useNoteDocument";
import { RecoveryPanel } from "./RecoveryPanel";
import { VaultSettings } from "./VaultSettings";
import { AppShell, Icon, useSidebar } from "./AppShell";
import { HomePage } from "./HomePage";
import { CreateSyncWizard } from "./CreateSyncWizard";
import { GettingStarted } from "./GettingStarted";
import { AiAssistant, emptyAiSession, type AiSession } from "./AiAssistant";
import { McpSettings } from "./McpSettings";
import { AiSettings } from "./AiSettings";
import { AutoSyncSchedule } from "./auto-sync";
import { GraphFilters, initialGraphFilters } from "./GraphFilters";
import {
  afterSave,
  moduleLabels,
  readEditorMode,
  readPreference,
  savePreference,
  type Module,
  type HomePage as HomeSection,
  type HelpPage,
  type SettingsPage,
} from "./navigation";
import {
  readRecent,
  writeRecent,
  visitRecent,
  moveRecent,
  pruneRecent,
  type RecentNote,
} from "./recent";
import {
  readPinned,
  writePinned,
  togglePinned,
  movePinned,
  prunePinned,
} from "./pinned";
import { createPath, parentDirectory } from "./create-path";
import { treeMoveDestination } from "./tree-drag";
const KnowledgeGraph = lazy(() =>
  import("./KnowledgeGraph").then((m) => ({ default: m.KnowledgeGraph })),
);
const ProbeGraph = lazy(() =>
  import("./Graph").then((m) => ({ default: m.Graph })),
);

import { NotesSidebar, type TreeEntry } from "./NotesSidebar";
import {
  NoteActionDialog,
  HistoryDialog,
  type NoteModal as Modal,
  type HistoryEntry,
} from "./WorkspaceDialogs";
export default function App() {
  useLanguage();
  const treeContextMenu = useRef<Menu | null>(null);
  useEffect(
    () => () => {
      void treeContextMenu.current?.close().catch(() => {});
    },
    [],
  );
  const [vault, setVault] = useState<Vault | null>(null);
  const [createSyncOpen, setCreateSyncOpen] = useState(false);
  const [module, setModule] = useState<Module>("home"),
    [mode, setMode] = useState(readEditorMode);
  const [homePage, setHomePage] = useState<HomeSection>("overview"),
    [helpPage, setHelpPage] = useState<HelpPage>("intro"),
    [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  const tab =
    module === "settings"
      ? settingsPage
      : module === "help"
        ? helpPage
        : module;
  const sidebar = useSidebar();
  const [recent, setRecent] = useState<RecentNote[]>([]),
    recentRef = useRef<RecentNote[]>([]);
  const aiSessions = useRef(new Map<string, AiSession>());
  const [aiVisited, setAiVisited] = useState(false),
    [summaryPath, setSummaryPath] = useState("");
  const rememberAiSession = useCallback((value: AiSession) => {
    const id = vaultRef.current?.id;
    if (id) aiSessions.current.set(id, value);
  }, []);
  const autoSchedule = useRef(new AutoSyncSchedule(Date.now()));
  const trayHidden = useRef(false);
  const [pinned, setPinned] = useState<string[]>([]),
    pinnedRef = useRef<string[]>([]);
  function storePinned(paths: string[], id = vaultRef.current?.id) {
    pinnedRef.current = paths;
    setPinned(paths);
    if (id)
      try {
        writePinned(localStorage, id, paths);
      } catch {
        setError(t("无法保存置顶设置；笔记内容不受影响。"));
      }
  }
  function togglePin(next: string) {
    if (
      busy ||
      composing ||
      operation.current ||
      isComposing.current ||
      !vaultRef.current
    )
      return;
    storePinned(togglePinned(pinnedRef.current, next));
  }
  const [relationsOpen, setRelationsOpen] = useState(false),
    [graphVisited, setGraphVisited] = useState(false),
    [syncVisited, setSyncVisited] = useState(false);
  const [graphFilters, setGraphFilters] = useState(initialGraphFilters);
  const [searchFocus, setSearchFocus] = useState(0);
  function storeRecent(entries: RecentNote[], id = vaultRef.current?.id) {
    recentRef.current = entries;
    setRecent(entries);
    if (id)
      try {
        writeRecent(localStorage, id, entries);
      } catch {
        setError(t("无法保存最近访问记录；笔记内容不受影响。"));
      }
  }
  function recordVisit(next: string, text: string) {
    storeRecent(
      visitRecent(recentRef.current, {
        path: next,
        title:
          text.match(/^# (.+)$/m)?.[1] ??
          next.split("/").pop()!.replace(/\.md$/i, ""),
        openedAt: Date.now(),
      }),
    );
  }
  useEffect(() => {
    savePreference("mozhi-editor-mode", mode);
  }, [mode]);
  useEffect(() => {
    if (searchFocus && module === "notes" && sidebar.visible)
      searchField.current?.focus();
  }, [searchFocus, module, sidebar.visible]);
  const [theme, setTheme] = useState(readPreference("mozhi-theme", "dark")),
    [status, setStatus] = useState(t("打开笔记库")),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const [modal, setModal] = useState<Modal | null>(null);
  const [syncBlocked, setSyncBlocked] = useState(false);
  const syncingRef = useRef(false);
  const [tree, setTree] = useState<TreeEntry[]>([]),
    [notes, setNotes] = useState<ParsedNote[]>([]),
    [revision, setRevision] = useState(0),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedDirectory, setSelectedDirectory] = useState("");
  const [selectedTreePath, setSelectedTreePath] = useState("");
  const [dragSource, setDragSource] = useState(""),
    [dropTarget, setDropTarget] = useState<string | null>(null),
    [dropTargetRow, setDropTargetRow] = useState<string | null>(null);
  const dragSourceRef = useRef("");
  const [history, setHistory] = useState<HistoryEntry[] | null>(null),
    [historical, setHistorical] = useState<string | null>(null),
    [report, setReport] = useState<unknown>(null),
    [longSample, setLongSample] = useState("");
  const searchField = useRef<HTMLInputElement>(null),
    initialized = useRef(false),
    operation = useRef(false),
    vaultRef = useRef<Vault | null>(null);
  const search = useNoteSearch(vault, revision, setError);
  const { setQuery, setTag, setDirectory } = search;
  const tags = [...new Set(notes.flatMap((note) => note.tags))].sort();
  const updateKnowledge = useCallback(async () => {
    if (!native) {
      setNotes(api.demoNotes());
      return;
    }
    const id = vaultRef.current?.id;
    const [entries, parsed] = await Promise.all([
      workspace<TreeEntry[]>({ action: "tree" }),
      workspace<ParsedNote[]>({ action: "knowledge" }),
    ]);
    if (id === vaultRef.current?.id) {
      setTree(entries);
      setSelectedDirectory((previous) =>
        previous &&
        !entries.some((entry) => entry.isDirectory && entry.path === previous)
          ? ""
          : previous,
      );
      setSelectedTreePath((previous) =>
        previous && !entries.some((entry) => entry.path === previous)
          ? ""
          : previous,
      );
      setNotes(parsed);
      setRevision((r) => r + 1);
      const state = await workspace<{ phase: string }>({
        action: "sync_state",
      });
      setSyncBlocked(state.phase === "conflict");
    }
  }, []);
  const onNoteLoaded = useCallback(() => {
    setHistory(null);
    setHistorical(null);
  }, []);
  const {
    path,
    setPath,
    content,
    saveStatus,
    setContent,
    recovery,
    setRecovery,
    composing,
    session,
    isComposing,
    loadNote,
    flush,
    change,
    composition,
  } = useNoteDocument({
    syncingRef,
    autoSchedule,
    updateKnowledge,
    onLoaded: onNoteLoaded,
    setError,
    setStatus,
  });
  const current = notes.find((note) => note.path === path);
  const adopt = useCallback(
    async (opened: Vault) => {
      setSummaryPath("");
      selectVault(opened.id);
      vaultRef.current = opened;
      storePinned(
        prunePinned(
          readPinned(localStorage, opened.id),
          opened.entries.map((e) => e.path),
        ),
        opened.id,
      );
      storeRecent(
        pruneRecent(
          readRecent(localStorage, opened.id),
          opened.entries.map((e) => e.path),
          opened.skipped,
        ),
        opened.id,
      );
      setGraphFilters(initialGraphFilters);
      setGraphVisited(false);
      setRelationsOpen(false);
      setSyncBlocked(false);
      setVault(opened);
      setQuery("");
      setTag("");
      setDirectory("");
      setSelectedDirectory("");
      setSelectedTreePath("");
      session.current = null;
      setPath("");
      setContent("");
      setRecovery(null);
      setNotes([]);
      setTree([]);
      setCollapsed(new Set());
      const first =
        opened.entries.find(
          (e) => e.path === "欢迎使用.md" && !opened.skipped.includes(e.path),
        ) ?? opened.entries.find((e) => !opened.skipped.includes(e.path));
      if (first) await loadNote(first.path);
      else setStatus(t("此目录暂无笔记，点击新建笔记开始"));
      await updateKnowledge();
      if (opened.skipped.length)
        setError(t("未读取的笔记：{0}", opened.skipped.join("、")));
    },
    [loadNote, updateKnowledge],
  );
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (operation.current || isComposing.current || busy) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setStatus(t("正在处理…"));
    try {
      let result: T | undefined;
      await afterSave(false, flush, async () => {
        result = await action();
      });
      return result;
    } catch (e) {
      setStatus(t("操作未完成"));
      setError(errorText(e));
      return undefined;
    } finally {
      operation.current = false;
      setBusy(false);
      setStatus((previous) =>
        t(previous) === t("正在处理…")
          ? native
            ? t("本地工作区就绪")
            : t("浏览器内存演示")
          : previous,
      );
    }
  }
  async function reload() {
    if (!native) return;
    const opened = await workspace<Vault>({ action: "refresh" });
    setVault(opened);
    vaultRef.current = opened;
    storePinned(
      prunePinned(
        pinnedRef.current,
        opened.entries.map((e) => e.path),
      ),
    );
    storeRecent(
      pruneRecent(
        recentRef.current,
        opened.entries.map((e) => e.path),
        opened.skipped,
      ),
    );
    const previous = session.current?.note.path;
    if (previous && opened.entries.some((e) => e.path === previous)) {
      const disk = await api.read(previous);
      if (disk.contentHash !== session.current?.note.contentHash)
        await loadNote(previous);
    } else {
      session.current = null;
      setPath("");
      setContent("");
      setRecovery(null);
    }
    await updateKnowledge();
  }
  const {
    autoSync,
    autoPaused,
    syncing,
    sshAgentError,
    syncRevision,
    configureAutoSync,
    syncNow,
    loadSshKeyAndSync,
  } = useVaultSync({
    vaultId: vault?.id,
    busy,
    blocked:
      busy ||
      composing ||
      syncBlocked ||
      !!modal ||
      history !== null ||
      recovery !== null,
    operation,
    isComposing,
    syncingRef,
    session,
    schedule: autoSchedule,
    trayHidden,
    flush,
    reload,
    setBusy,
    setError,
    setStatus,
  });
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    api
      .openDemo()
      .then(adopt)
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(false));
  }, [adopt]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    savePreference("mozhi-theme", theme);
  }, [theme]);
  useDocumentLifecycle({
    content,
    composing,
    busy,
    modal,
    history,
    session,
    operation,
    isComposing,
    syncingRef,
    vaultRef,
    autoSchedule,
    trayHidden,
    autoSync,
    autoPaused,
    syncBlocked: syncBlocked || !!modal || history !== null || recovery !== null,
    flush,
    updateKnowledge,
    reload,
    run,
    openSearch,
    newNote,
    setError,
    setStatus,
  });
  async function switchModule(next: Module) {
    await run(async () => {
      if (next === "ai") {
        setAiVisited(true);
        setSummaryPath("");
      }
      if (next === "graph") setGraphVisited(true);
      if (next === "settings" && settingsPage === "sync") setSyncVisited(true);
      setModule(next);
      sidebar.dismiss();
    });
  }
  async function selectSettings(next: SettingsPage) {
    await run(async () => {
      if (next === "sync") setSyncVisited(true);
      setModule("settings");
      setSettingsPage(next);
      sidebar.dismiss();
    });
  }
  async function openSearch() {
    await run(async () => {
      setModule("notes");
      sidebar.reveal();
      setSearchFocus((n) => n + 1);
    });
  }
  function locate(next: string) {
    setCollapsed(
      (old) =>
        new Set([...old].filter((folder) => !next.startsWith(`${folder}/`))),
    );
  }
  async function navigate(next: string) {
    await run(async () => {
      const note =
        next === path && session.current
          ? session.current.note
          : await loadNote(next);
      recordVisit(next, next === path ? content : note.content);
      locate(next);
      setSelectedDirectory(parentDirectory(next));
      setSelectedTreePath(next);
      setModule("notes");
      sidebar.dismiss();
    });
  }
  function newNote() {
    if (syncingRef.current) return;
    setError("");
    setModal({
      kind: "note",
      source: "",
      parent: selectedDirectory,
      value: t("新笔记"),
    });
  }
  function newDirectory() {
    if (syncingRef.current) return;
    setError("");
    setModal({
      kind: "directory",
      source: "",
      parent: selectedDirectory,
      value: t("新目录"),
    });
  }
  async function showTreeMenu(entry?: TreeEntry) {
    if (!native || busy || composing || syncingRef.current) return;
    try {
      const items = [
        {
          id: "open-directory",
          text: t(platform.openDirectory),
          action: () => {
            void workspace({
              action: "open_directory",
              path: entry?.path ?? "",
            }).catch((e) => setError(errorText(e)));
          },
        },
      ];
      if (entry)
        items.push({
          id: "manage-entry",
          text: t("重命名 / 移动"),
          action: () =>
            setModal({ kind: "move", source: entry.path, value: entry.path }),
        });
      const menuVaultId = vaultRef.current?.id;
      if (entry && !entry.isDirectory && !entry.isAttachment)
        items.push({
          id: "toggle-pin",
          text: pinnedRef.current.includes(entry.path)
            ? t("取消置顶")
            : t("置顶笔记"),
          action: () => {
            if (menuVaultId === vaultRef.current?.id) togglePin(entry.path);
          },
        });
      await treeContextMenu.current?.close();
      const menu = await Menu.new({ items });
      treeContextMenu.current = menu;
      await menu.popup();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function openVault() {
    if (syncingRef.current) return;
    await run(async () => {
      const opened = await api.openVault();
      if (opened) {
        await adopt(opened);
        setModule("home");
        sidebar.dismiss();
      }
    });
  }
  async function openKnownVault(id: string) {
    if (syncingRef.current) return;
    await run(async () => {
      await adopt(await api.openKnownVault(id));
      setStatus(t("已切换笔记库"));
    });
  }
  function clearDrag() {
    dragSourceRef.current = "";
    setDragSource("");
    setDropTarget(null);
    setDropTargetRow(null);
  }
  function dragOverFolder(
    event: React.DragEvent,
    folder: string,
    row: string | null = null,
  ) {
    const source = dragSourceRef.current;
    const destination =
      source &&
      treeMoveDestination(
        source,
        folder,
        tree.map((entry) => entry.path),
      );
    if (!destination || busy || composing || syncBlocked || syncing) {
      setDropTarget(null);
      setDropTargetRow(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(folder);
    setDropTargetRow(row);
  }
  async function dropIntoFolder(event: React.DragEvent, folder: string) {
    event.preventDefault();
    event.stopPropagation();
    const source = dragSourceRef.current;
    const destination =
      source &&
      treeMoveDestination(
        source,
        folder,
        tree.map((entry) => entry.path),
      );
    clearDrag();
    if (!destination || busy || composing || syncBlocked || syncing) return;
    await run(async () => {
      await performMove(source, destination, folder);
    });
  }
  async function performMove(
    source: string,
    destination: string,
    folder: string,
  ) {
    await workspace({ action: "move", from: source, to: destination });
    storeRecent(moveRecent(recentRef.current, source, destination));
    storePinned(movePinned(pinnedRef.current, source, destination));
    const next =
      path === source || path.startsWith(`${source}/`)
        ? `${destination}${path.slice(source.length)}`
        : path;
    await reload();
    if (next && next !== path) await loadNote(next);
    setSelectedDirectory(folder);
    setSelectedTreePath(destination);
    setCollapsed(
      (old) =>
        new Set([...old].filter((item) => !destination.startsWith(`${item}/`))),
    );
    setQuery("");
    setTag("");
    setDirectory("");
  }
  useEffect(() => {
    if (module === "notes" && sidebar.visible)
      document
        .querySelector(".note-item.selected")
        ?.scrollIntoView({ block: "nearest" });
  }, [path, module, sidebar.visible]);
  async function submitModal() {
    if (syncingRef.current) return;
    if (!modal) return;
    const m = modal;
    let destination = "";
    if (m.kind === "note" || m.kind === "directory") {
      try {
        destination = createPath(m.parent ?? "", m.value, m.kind);
      } catch (e) {
        setError(errorText(e));
        return;
      }
    }
    await run(async () => {
      if (m.kind === "note" || m.kind === "directory") {
        const opened = await workspace<Vault>({
          action: "create",
          path: destination,
          directory: m.kind === "directory",
        });
        setVault(opened);
        await updateKnowledge();
        setQuery("");
        setTag("");
        setDirectory("");
        setCollapsed(
          (old) =>
            new Set(
              [...old].filter(
                (folder) => !destination.startsWith(`${folder}/`),
              ),
            ),
        );
        if (m.kind === "note") {
          const note = await loadNote(destination);
          recordVisit(destination, note.content);
          setSelectedDirectory(m.parent ?? "");
        } else setSelectedDirectory(destination);
        setSelectedTreePath(destination);
        setModule("notes");
        sidebar.dismiss();
      } else if (m.kind === "move")
        await performMove(m.source, m.value, parentDirectory(m.value));
      else {
        await workspace({ action: "delete", path: m.source });
        await reload();
      }
      setModal(null);
    });
  }
  async function importImage() {
    await run(async () => {
      const attachment = await workspace<string | null>({
        action: "import_image",
      });
      if (attachment) {
        const depth = path.split("/").length - 1;
        change(
          `${session.current!.text}\n\n![图片](${"../".repeat(depth)}${attachment})\n`,
        );
      }
    });
  }
  function link(target: string, wiki = false) {
    if (wiki) {
      const reference = current?.references.find(
        (r) => r.wiki && r.raw === target,
      );
      if (reference?.target) {
        void navigate(reference.target);
        return;
      }
      setError(
        reference?.resolution === "ambiguous"
          ? t("同名笔记存在歧义：{0}", target)
          : t("链接目标不存在：{0}", target),
      );
      return;
    }
    const parts = path.split("/").slice(0, -1);
    for (const part of target.split("#")[0].split("/")) {
      if (part === "..") {
        if (!parts.length) return;
        parts.pop();
      } else if (part && part !== ".") parts.push(part);
    }
    const resolved = parts.join("/");
    if (vault?.entries.some((e) => e.path === resolved))
      void navigate(resolved);
    else setError(t("未找到链接目标：{0}", target));
  }
  useEffect(() => {
    if (!native || !vault) return;
    let last = "";
    let disposed = false;
    let checking = false;
    const timer = setInterval(async () => {
      if (
        document.hidden ||
        syncingRef.current ||
        operation.current ||
        isComposing.current ||
        checking
      )
        return;
      checking = true;
      try {
        const fingerprint = await workspace<string>({ action: "fingerprint" });
        if (disposed) return;
        if (last && last !== fingerprint) {
          if (session.current?.dirty) {
            setError(
              t("检测到外部文件修改。当前草稿已保留，请保存时协调版本。"),
            );
            return;
          }
          await run(reload);
        }
        last = fingerprint;
      } catch (e) {
        if (!disposed) setError(errorText(e));
      } finally {
        checking = false;
      }
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [vault?.id]);
  useEffect(() => {
    if (!native || !vault) return;
    let disposed = false;
    let changed = false;
    let stop: (() => void) | undefined;
    listen<{ vaultId: string }>("vault_files_changed", (event) => {
      if (event.payload.vaultId === vault.id) changed = true;
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    const timer = setInterval(() => {
      if (
        !changed ||
        document.hidden ||
        syncingRef.current ||
        operation.current ||
        isComposing.current
      )
        return;
      if (session.current?.dirty) {
        setError(
          t("检测到外部文件变化，当前编辑内容不会被覆盖；保存时将核对版本。"),
        );
        return;
      }
      changed = false;
      void run(reload);
    }, 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
      stop?.();
    };
  }, [vault?.id]);
  const title =
    current?.title ??
    content.match(/^# (.+)$/m)?.[1] ??
    path.replace(/\.md$/i, "");
  const pinnedNotes = pinned
    .filter((next) => !vault?.skipped.includes(next))
    .map((next) => ({
      path: next,
      title:
        notes.find((note) => note.path === next)?.title ??
        next.split("/").pop()!.replace(/\.md$/i, ""),
    }));
  const visibleTree = (
    native
      ? tree
      : (vault?.entries.map((e) => ({
          ...e,
          isDirectory: false,
          isAttachment: false,
        })) ?? [])
  ).filter(
    (e) => ![...collapsed].some((folder) => e.path.startsWith(`${folder}/`)),
  );
  const sidebarContent = (
    <>
      <button
        className="vault-switcher"
        disabled={!native || busy || composing || syncing}
        onClick={() => void openVault()}
        title={vault?.name}
      >
        <img
          className="mini-brand"
          src={brandLogo}
          alt=""
          width={32}
          height={32}
        />
        <span>
          {t("墨知")}
          <small>{vault?.name ?? t("正在加载…")}</small>
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      <div className="module-sidebar-page" hidden={module !== "home"}>
        <button
          className="new-note"
          disabled={!native || busy || composing || syncing}
          onClick={newNote}
        >
          {t("＋ 新建笔记")}
        </button>
        <nav aria-label={t("首页导航")}>
          {(
            [
              ["overview", t("概览")],
              ["recent", t("最近打开")],
            ] as const
          ).map(([key, label]) => (
            <button
              className={`nav-item ${homePage === key ? "active" : ""}`}
              aria-current={homePage === key ? "page" : undefined}
              key={key}
              disabled={busy || composing}
              onClick={() => {
                setHomePage(key);
                sidebar.dismiss();
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <NotesSidebar
        path={path}
        vaultName={vault?.name}
        pinnedNotes={pinnedNotes}
        dropTarget={dropTarget}
        onTogglePin={togglePin}
        onNewNote={newNote}
        onNewDirectory={newDirectory}
        onRefresh={() => void run(reload)}
        visible={module === "notes"}
        busy={busy}
        composing={composing}
        syncing={syncing}
        syncBlocked={syncBlocked}
        search={search}
        searchField={searchField}
        tags={tags}
        tree={tree}
        visibleTree={visibleTree}
        collapsed={collapsed}
        selectedTreePath={selectedTreePath}
        dragSource={dragSource}
        dropTargetRow={dropTargetRow}
        dragSourceRef={dragSourceRef}
        setCollapsed={setCollapsed}
        setSelectedDirectory={setSelectedDirectory}
        setSelectedTreePath={setSelectedTreePath}
        setDragSource={setDragSource}
        setDropTarget={setDropTarget}
        setDropTargetRow={setDropTargetRow}
        onManage={(path) =>
          setModal({ kind: "move", source: path, value: path })
        }
        onOpen={(path) => void navigate(path)}
        onShowTreeMenu={(entry) => void showTreeMenu(entry)}
        onClearDrag={clearDrag}
        onDragOverFolder={dragOverFolder}
        onDropIntoFolder={(event, folder) => void dropIntoFolder(event, folder)}
      />
      <div className="module-sidebar-page" hidden={module !== "graph"}>
        <h2>{t("知识图谱")}</h2>
        <GraphFilters
          value={graphFilters}
          onChange={setGraphFilters}
          current={path}
          tags={tags}
        />
      </div>
      <div className="module-sidebar-page" hidden={module !== "ai"}>
        <h2>{t("AI 助理")}</h2>
        <button
          className="nav-item"
          disabled={busy || composing}
          onClick={() => void selectSettings("ai")}
        >
          {t("模型设置")}
        </button>
      </div>
      <div className="module-sidebar-page" hidden={module !== "help"}>
        <h2>{t("帮助")}</h2>
        <nav aria-label={t("帮助导航")}>
          {(
            [
              ["intro", t("使用入门")],
              ["shortcuts", t("快捷键")],
              ["lab", t("技术验证")],
            ] as const
          ).map(([key, label]) => (
            <button
              className={`nav-item ${helpPage === key ? "active" : ""}`}
              key={key}
              disabled={busy || composing}
              onClick={() =>
                void run(async () => {
                  setHelpPage(key);
                  sidebar.dismiss();
                })
              }
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="module-sidebar-page" hidden={module !== "settings"}>
        <h2>{t("设置")}</h2>
        <nav aria-label={t("设置导航")}>
          {(
            [
              ["appearance", t("外观")],
              ["vault", t("笔记库")],
              ["sync", t("同步")],
              ["recovery", t("恢复记录")],
              ["ai", t("AI 模型")],
              ["mcp", t("MCP 服务")],
              ["about", t("关于")],
            ] as const
          ).map(([key, label]) => (
            <button
              className={`nav-item ${settingsPage === key ? "active" : ""}`}
              key={key}
              disabled={busy || composing}
              onClick={() => void selectSettings(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <button
          disabled={!native || busy || composing || syncing}
          onClick={() => void openVault()}
        >
          {t("打开笔记库")}
        </button>
      </div>
    </>
  );
  return (
    <AppShell
      active={module}
      disabled={busy || composing || !!modal || history !== null}
      onNavigate={(next) => void switchModule(next)}
      sidebar={sidebarContent}
      sidebarVisible={sidebar.visible}
      dismissSidebar={sidebar.dismiss}
    >
      <header className="topbar">
        <button
          className="sidebar-toggle"
          title={sidebar.visible ? t("隐藏侧栏") : t("展开侧栏")}
          aria-label={sidebar.visible ? t("收起侧栏") : t("展开侧栏")}
          aria-expanded={sidebar.visible}
          aria-controls="module-sidebar"
          onClick={sidebar.toggle}
        >
          <Icon name="panel" />
        </button>
        <div className="breadcrumb">
          {module === "notes"
            ? t("笔记库 / {0}", path || t("未选择笔记"))
            : t(moduleLabels[module])}
        </div>
        <div className="save-status" role="status">
          <span
            aria-hidden="true"
            className={`dot ${busy || syncing || syncBlocked || autoPaused || !!error || !!session.current?.dirty ? "status-pending" : ""}`}
          />
          {t(status)}
        </div>
        <button
          className="topbar-sync"
          title={t("立即同步")}
          aria-label={t("立即同步")}
          aria-busy={syncing}
          disabled={
            !native ||
            !vault ||
            busy ||
            composing ||
            syncing ||
            syncBlocked ||
            !!modal ||
            history !== null
          }
          onClick={() => void syncNow()}
        >
          <RefreshCw size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </header>
      {error && (
        <div className="notice error" role="alert">
          <span>{t(error)}</span>
          {path && (
            <button
              disabled={busy || composing}
              onClick={() => {
                setBusy(true);
                api
                  .draft(path, session.current?.text ?? content)
                  .then(() => loadNote(path))
                  .catch((e) => setError(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {t("保留草稿并重读磁盘")}
            </button>
          )}
          <button aria-label={t("关闭提示")} onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {syncing && (
        <div className="notice" role="status">
          {t("正在同步；可以浏览笔记，编辑和切换笔记库将在完成后恢复。")}
        </div>
      )}
      {sshAgentError && (
        <div className="notice" role="status">
          <span>{t(sshAgentError)}</span>
          <button disabled={busy || syncing} onClick={() => void loadSshKeyAndSync()}>
            {t("选择 SSH 密钥")}
          </button>
        </div>
      )}
      {syncBlocked && (
        <div className="notice">
          <span>{t("此库有待处理的 Git 冲突，编辑暂时只读。")}</span>
          <button
            disabled={busy || composing}
            onClick={() => void selectSettings("sync")}
          >
            {t("处理冲突")}
          </button>
        </div>
      )}
      {recovery !== null && (
        <div className="notice">
          <span>
            {t("发现与磁盘版本不同的恢复草稿。恢复后请检查并协调内容。")}
          </span>
          <button
            disabled={busy || composing || syncBlocked || syncing}
            onClick={() => {
              change(recovery);
              setRecovery(null);
            }}
          >
            {t("恢复草稿")}
          </button>
          <button onClick={() => setRecovery(null)}>{t("稍后处理")}</button>
        </div>
      )}
      <div className="page-slot" hidden={module !== "home"}>
        <HomePage
          welcome={
            !!vault?.demo &&
            vault.entries.some((note) => note.path === "欢迎使用.md") &&
            !vault.skipped.includes("欢迎使用.md")
          }
          pinned={pinnedNotes}
          onTogglePin={togglePin}
          recent={recent.map((item) => ({
            ...item,
            title:
              notes.find((note) => note.path === item.path)?.title ??
              item.title,
          }))}
          all={homePage === "recent"}
          busy={busy || composing}
          canCreate={native && !syncing}
          onOpen={(next) => void navigate(next)}
          onAll={() => setHomePage("recent")}
          onNew={newNote}
          onBrowse={() => void switchModule("notes")}
          onCreateAndSync={() => setCreateSyncOpen(true)}
        />
      </div>
      <NoteWorkspace
        visible={module === "notes"}
        vaultId={vault?.id}
        path={path}
        title={title}
        content={content}
        saveStatus={saveStatus}
        current={current}
        notes={notes}
        mode={mode}
        busy={busy}
        composing={composing}
        syncBlocked={syncBlocked}
        syncing={syncing}
        pinned={pinned.includes(path)}
        relationsOpen={relationsOpen}
        sidebarVisible={sidebar.visible}
        onToggleSidebar={sidebar.toggle}
        onMode={setMode}
        onTogglePin={() => togglePin(path)}
        onSummary={() =>
          void run(async () => {
            setSummaryPath(path);
            setAiVisited(true);
            setModule("ai");
            sidebar.dismiss();
          })
        }
        onImportImage={() => void importImage()}
        onPasteImage={native ? async (file) => {
          if (file.size > 10 * 1024 * 1024) {
            setError(t("图片上限 10 MiB"));
            return null;
          }
          const attachment = await run(async () => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
            }
            return workspace<string>({ action: "import_image_data", data: btoa(binary) });
          });
          return attachment ?? null;
        } : undefined}
        onToggleRelations={() => setRelationsOpen((value) => !value)}
        onCloseRelations={() => setRelationsOpen(false)}
        onManage={(kind) =>
          setModal({ kind, source: path, value: kind === "move" ? path : "" })
        }
        onHistory={() =>
          void run(async () => {
            setHistory(await workspace({ action: "history", path }));
            setHistorical(null);
          })
        }
        onChange={change}
        onComposition={composition}
        onOpen={(next) => void navigate(next)}
        onLink={link}
        onTag={(tag) => {
          setTag(tag);
          sidebar.reveal();
        }}
        onError={setError}
      />
      {graphVisited && (
        <div className="page-slot" hidden={module !== "graph"}>
          <Suspense fallback={<p className="notice">{t("正在加载图谱…")}</p>}>
            <KnowledgeGraph
              key={vault?.id}
              active={module === "graph"}
              theme={theme}
              filters={graphFilters}
              current={path}
              revision={revision}
              onOpen={(p) => void navigate(p)}
            />
          </Suspense>
        </div>
      )}
      {syncVisited && (
        <div className="page-slot" hidden={tab !== "sync"}>
          <SyncPanel
            key={vault?.id}
            busy={busy || composing || syncing}
            run={run}
            onVault={adopt}
            onReload={reload}
            onSync={() => syncNow()}
            syncRevision={syncRevision}
            autoSync={autoSync}
            autoPaused={autoPaused}
            onAutoSync={configureAutoSync}
          />
        </div>
      )}
      {aiVisited && vault && (
        <div className="page-slot" hidden={module !== "ai"}>
          <AiAssistant
            key={vault.id}
            vaultId={vault.id}
            notes={
              notes.length
                ? notes
                : vault.entries.map((note) => ({
                    path: note.path,
                    title: note.path.replace(/\.md$/i, ""),
                  }))
            }
            directories={tree
              .filter((entry) => entry.isDirectory)
              .map((entry) => entry.path)}
            initial={aiSessions.current.get(vault.id) ?? emptyAiSession()}
            onSession={rememberAiSession}
            onOpen={(next) => void navigate(next)}
            onSettings={() => void selectSettings("ai")}
            summaryPath={summaryPath}
            beforeOptimize={async () => {
              if (recovery !== null)
                throw new Error(
                  t("笔记存在待恢复草稿，请先打开笔记处理后再优化"),
                );
              const id = vault.id;
              return (
                (await run(async () => vaultRef.current?.id === id)) === true
              );
            }}
            onApplyOptimization={async (next, hash, body) => {
              if (recovery !== null)
                throw new Error(
                  t("笔记存在待恢复草稿，请先打开笔记处理后再优化"),
                );
              const id = vault.id;
              return (
                (await run(async () => {
                  if (vaultRef.current?.id !== id)
                    throw new Error(t("笔记库已切换"));
                  const result = await aiRequest<{
                    note: Note;
                    indexWarning?: string;
                  }>(id, {
                    action: "apply_optimization",
                    path: next,
                    expectedContentHash: hash,
                    body,
                  });
                  autoSchedule.current.savedAt = Date.now();
                  if (session.current?.note.path === next) {
                    session.current = new DocumentSession(
                      result.note,
                      api.save,
                      setError,
                    );
                    setContent(result.note.content);
                    setRecovery(null);
                  }
                  try {
                    await updateKnowledge();
                  } catch {
                    setError(t("笔记已保存，请重新打开笔记库刷新索引"));
                  }
                  if (result.indexWarning) setError(result.indexWarning);
                  setStatus(t("已应用到原笔记"));
                  return true;
                })) === true
              );
            }}
            onSave={async (next, body) => {
              const saved = await run(async () => {
                const result = await aiRequest<{ indexWarning?: string }>(
                  vault.id,
                  { action: "save", path: next, body },
                );
                autoSchedule.current.savedAt = Date.now();
                try {
                  await reload();
                } catch {
                  setError(t("笔记已保存，请重新打开笔记库刷新索引"));
                }
                if (result.indexWarning) setError(result.indexWarning);
                setStatus(t("已创建 {0}", next));
                return true;
              });
              return saved === true;
            }}
          />
        </div>
      )}
      {module === "settings" && settingsPage === "ai" && <AiSettings />}
      {tab === "mcp" && (
        <McpSettings vaultId={vault?.id} vaultName={vault?.name} />
      )}
      {tab === "about" && <AboutPage />}
      <section className="settings-page" hidden={tab !== "appearance"}>
        <h1>{t("外观")}</h1>
        <p className="subtle">{t("选择适合你的阅读与书写环境。")}</p>
        <div className="settings-card">
          <div className="setting-row">
            <span>{t("主题")}</span>
            <div className="segmented">
              {(["dark", "light"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={theme === value}
                  className={theme === value ? "selected" : ""}
                  onClick={() => setTheme(value)}
                >
                  {value === "dark" ? t("深色") : t("浅色")}
                </button>
              ))}
            </div>
          </div>
          <LanguageSettings />
        </div>
      </section>
      <section className="settings-page" hidden={tab !== "vault"}>
        <h1>{t("笔记库")}</h1>
        <p className="subtle">
          {t("当前笔记库：")}
          {vault?.name}
        </p>
        <div className="workspace-toolbar">
          <button disabled={busy || composing || syncing} onClick={() => setCreateSyncOpen(true)}>{t("创建并同步个人笔记库")}</button>
          <button
            disabled={busy || composing || !native || syncing}
            onClick={() => void openVault()}
          >
            {t("打开其他笔记库")}
          </button>
          <button
            disabled={busy || composing || !native}
            onClick={() =>
              void run(async () => {
                if (await workspace({ action: "export" }))
                  setStatus(t("笔记库已导出"));
              })
            }
          >
            {t("导出笔记库")}
          </button>
        </div>
        {tab === "vault" && (
          <VaultSettings
            currentId={vault?.id}
            disabled={busy || composing || syncing}
            onOpen={openKnownVault}
          onCreateAndSync={() => setCreateSyncOpen(true)}
          />
        )}
      </section>
      {tab === "intro" && (
        <GettingStarted
          disabled={busy || composing || !native}
          onSyncSettings={() => void selectSettings("sync")}
        />
      )}
      {createSyncOpen && <CreateSyncWizard onClose={() => setCreateSyncOpen(false)} onCreated={async opened => { await adopt(opened); setModule("home"); }} />}
      <section className="help-page" hidden={tab !== "shortcuts"}>
        <h1>{t("快捷键")}</h1>
        <dl className="shortcut-list">
          <div>
            <dt>{t("搜索笔记")}</dt>
            <dd>{platform.modifier} K</dd>
          </div>
          <div>
            <dt>{t("新建笔记")}</dt>
            <dd>{platform.modifier} N</dd>
          </div>
          <div>
            <dt>{t("保存当前笔记")}</dt>
            <dd>{platform.modifier} S</dd>
          </div>
        </dl>
      </section>
      {tab === "recovery" && (
        <RecoveryPanel
          key={vault?.id}
          busy={busy || composing || syncing}
          run={run}
          onRestore={async (id) => {
            const result = await workspace<{ path: string }>({
              action: "restore",
              id,
            });
            await reload();
            setStatus(t("已恢复至 {0}", result.path));
          }}
        />
      )}
      <section hidden={tab !== "lab"} className="lab-panel">
        <h1>{t("技术验证")}</h1>
        <p className="subtle">
          {t(
            "验证样本与实际笔记库分开运行。中文组合输入仍需人工操作系统输入法。",
          )}
        </p>
        <div className="workspace-toolbar">
          <button
            disabled={busy}
            onClick={() =>
              setLongSample(
                "# 中文输入样本\n\n知识图谱帮助我整理项目计划。Rust 与 Markdown 混排，标点：预算、计划。\n".repeat(
                  660,
                ),
              )
            }
          >
            {t("加载 100 KB 长文")}
          </button>
          <button
            disabled={busy || !native}
            onClick={() => void run(async () => setReport(await api.probes()))}
          >
            {t("运行搜索 / Git 样本")}
          </button>
        </div>
        {report !== null && (
          <pre className="report-json">{JSON.stringify(report, null, 2)}</pre>
        )}
        {longSample && (
          <div className="long-sample">
            <Editor
              documentKey="long-sample"
              value={longSample}
              readOnly={false}
              onChange={setLongSample}
              onComposition={composition}
            />
          </div>
        )}
        <div className="probe-graph">
          <Suspense fallback={null}>{tab === "lab" && <ProbeGraph />}</Suspense>
        </div>
      </section>
      {modal && (
        <NoteActionDialog
          modal={modal}
          vaultName={vault?.name}
          tree={tree}
          busy={busy}
          composing={composing}
          error={error}
          onChange={setModal}
          onSubmit={() => void submitModal()}
          onClearError={() => setError("")}
          onClose={() => {
            setModal(null);
            setError("");
          }}
        />
      )}
      {history !== null && (
        <HistoryDialog
          history={history}
          path={path}
          historical={historical}
          busy={busy}
          composing={composing}
          syncBlocked={syncBlocked}
          syncing={syncing}
          onSelect={(id) =>
            void run(async () =>
              setHistorical(await workspace({ action: "version", path, id })),
            )
          }
          onRestore={() => {
            if (historical !== null) {
              change(historical);
              setHistory(null);
              setHistorical(null);
            }
          }}
          onClose={() => {
            setHistory(null);
            setHistorical(null);
          }}
        />
      )}
    </AppShell>
  );
}
