import { t, useLanguage } from "./i18n";
import { native } from "./api";
import { platform } from "./platform";
import { dropFolderForEntry } from "./tree-drag";
import type { RefObject, Dispatch, SetStateAction, DragEvent } from "react";
import type { useNoteSearch } from "./useNoteSearch";
export type TreeEntry = {
  path: string;
  isDirectory: boolean;
  isAttachment?: boolean;
};
type Props = {
  path: string;
  vaultName?: string;
  pinnedNotes: { path: string; title: string }[];
  dropTarget: string | null;
  onTogglePin: (path: string) => void;
  onNewNote: () => void;
  onNewDirectory: () => void;
  onRefresh: () => void;
  visible: boolean;
  busy: boolean;
  composing: boolean;
  syncing: boolean;
  syncBlocked: boolean;
  search: ReturnType<typeof useNoteSearch>;
  searchField: RefObject<HTMLInputElement | null>;
  tags: string[];
  tree: TreeEntry[];
  visibleTree: TreeEntry[];
  collapsed: Set<string>;
  selectedTreePath: string;
  dragSource: string;
  dropTargetRow: string | null;
  dragSourceRef: RefObject<string>;
  setCollapsed: Dispatch<SetStateAction<Set<string>>>;
  setSelectedDirectory: (path: string) => void;
  setSelectedTreePath: (path: string) => void;
  setDragSource: (path: string) => void;
  setDropTarget: (path: string | null) => void;
  setDropTargetRow: (path: string | null) => void;
  onManage: (path: string) => void;
  onOpen: (path: string) => void;
  onShowTreeMenu: (entry?: TreeEntry) => void;
  onClearDrag: () => void;
  onDragOverFolder: (
    event: DragEvent,
    folder: string,
    row?: string | null,
  ) => void;
  onDropIntoFolder: (event: DragEvent, folder: string) => void;
};
export function NotesSidebar({
  path,
  vaultName,
  pinnedNotes,
  dropTarget,
  onTogglePin,
  onNewNote,
  onNewDirectory,
  onRefresh,
  visible,
  busy,
  composing,
  syncing,
  syncBlocked,
  search,
  searchField,
  tags,
  tree,
  visibleTree,
  collapsed,
  selectedTreePath,
  dragSource,
  dropTargetRow,
  dragSourceRef,
  setCollapsed,
  setSelectedDirectory,
  setSelectedTreePath,
  setDragSource,
  setDropTarget,
  setDropTargetRow,
  onManage,
  onOpen,
  onShowTreeMenu,
  onClearDrag,
  onDragOverFolder,
  onDropIntoFolder,
}: Props) {
  useLanguage();
  const {
    query,
    setQuery,
    tag,
    setTag,
    directory,
    setDirectory,
    filenameOnly,
    setFilenameOnly,
    results,
  } = search;
  return (
    <div className="module-sidebar-page notes-sidebar" hidden={!visible}>
      <div className="search-box">
        <span>⌕</span>
        <input
          ref={searchField}
          aria-label={t("搜索笔记")}
          placeholder={t("搜索 / tag:工作")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>{platform.modifier} K</kbd>
      </div>
      <details className="filter-disclosure">
        <summary>{t("筛选条件")}</summary>
        <div className="search-filters">
          <select
            aria-label={t("搜索标签")}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="">{t("所有标签")}</option>
            {tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label={t("搜索目录")}
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
          >
            <option value="">{t("所有目录")}</option>
            {tree
              .filter((e) => e.isDirectory)
              .map((e) => (
                <option key={e.path}>{e.path}</option>
              ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={filenameOnly}
              onChange={(e) => setFilenameOnly(e.target.checked)}
            />
            {t("仅文件名")}
          </label>
        </div>
      </details>
      {!!pinnedNotes.length && (
        <section className="pinned-sidebar" aria-label={t("置顶笔记")}>
          <div className="sidebar-label">{t("置顶笔记")}</div>
          {pinnedNotes.map((note) => (
            <div className="tree-row" key={note.path}>
              <button
                className={`note-item ${path === note.path ? "selected" : ""}`}
                title={note.path}
                disabled={busy || composing}
                onClick={() => onOpen(note.path)}
              >
                <span aria-hidden="true">↑</span>
                <span>{note.title}</span>
              </button>
              <button
                className="pin-action"
                aria-label={t("取消置顶 {0}", note.path)}
                title={t("取消置顶")}
                disabled={busy || composing}
                onClick={() => onTogglePin(note.path)}
              >
                {t("取消置顶")}
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="sidebar-label">
        {query || tag || directory ? t("搜索结果") : t("笔记库")}
      </div>
      <div
        className={`vault-root ${selectedTreePath === "" ? "selected" : ""} ${dropTarget === "" && dropTargetRow === null ? "drop-target" : ""}`}
        onDragOver={(event) => onDragOverFolder(event, "")}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDropTarget(null);
            setDropTargetRow(null);
          }
        }}
        onDrop={(event) => onDropIntoFolder(event, "")}
      >
        <button
          disabled={busy || composing}
          onClick={() => {
            setSelectedDirectory("");
            setSelectedTreePath("");
          }}
        >
          ▱ {vaultName ?? t("正在加载…")} <small>{t("根目录")}</small>
        </button>
      </div>
      <div className="file-actions">
        <button
          disabled={busy || composing || !native || syncing}
          onClick={onNewNote}
        >
          {t("＋笔记")}
        </button>
        <button
          disabled={busy || composing || !native || syncing}
          onClick={onNewDirectory}
        >
          {t("＋目录")}
        </button>
        <button
          disabled={busy || composing || !native || syncing}
          onClick={onRefresh}
        >
          {t("刷新")}
        </button>
      </div>
      <div
        className="note-list"
        onContextMenu={(event) => {
          event.preventDefault();
          onShowTreeMenu();
        }}
        onDragOver={(event) => {
          if (event.target === event.currentTarget) onDragOverFolder(event, "");
        }}
        onDrop={(event) => {
          if (event.target === event.currentTarget) onDropIntoFolder(event, "");
        }}
      >
        {results
          ? results.hits.map((entry) => (
              <button
                className="search-result"
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onShowTreeMenu({ path: entry.path, isDirectory: false });
                }}
                key={entry.path}
                disabled={busy || composing}
                onClick={() => onOpen(entry.path)}
              >
                <strong>{entry.title}</strong>
                <small>{entry.path}</small>
                <span>{entry.excerpt}</span>
              </button>
            ))
          : visibleTree.map((entry) => (
              <div
                key={entry.path}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onShowTreeMenu(entry);
                }}
                className={`tree-row ${dragSource === entry.path ? "dragging" : ""} ${dropTargetRow === entry.path ? "drop-target" : ""}`}
                style={{
                  paddingLeft:
                    Math.min(entry.path.split("/").length - 1, 5) * 10,
                }}
                draggable={
                  native && !busy && !composing && !syncBlocked && !syncing
                }
                onDragStart={(event) => {
                  if (!native || busy || composing || syncBlocked || syncing) {
                    event.preventDefault();
                    return;
                  }
                  dragSourceRef.current = entry.path;
                  setDragSource(entry.path);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", "mozhi-tree-entry");
                }}
                onDragEnd={onClearDrag}
                onDragOver={(event) =>
                  onDragOverFolder(event, dropFolderForEntry(entry), entry.path)
                }
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  ) {
                    setDropTarget(null);
                    setDropTargetRow(null);
                  }
                }}
                onDrop={(event) =>
                  onDropIntoFolder(event, dropFolderForEntry(entry))
                }
              >
                {entry.isDirectory && (
                  <button
                    className="tree-expander"
                    aria-label={`${collapsed.has(entry.path) ? t("展开") : t("折叠")} ${entry.path}`}
                    disabled={busy || composing}
                    onClick={() =>
                      setCollapsed((old) => {
                        const next = new Set(old);
                        if (next.has(entry.path)) next.delete(entry.path);
                        else next.add(entry.path);
                        return next;
                      })
                    }
                  >
                    {collapsed.has(entry.path) ? "▸" : "▾"}
                  </button>
                )}
                <button
                  title={entry.path}
                  disabled={busy || composing}
                  aria-current={
                    selectedTreePath === entry.path
                      ? entry.isDirectory
                        ? "location"
                        : "page"
                      : undefined
                  }
                  className={`${entry.isDirectory && selectedTreePath === entry.path ? "note-item selected-directory" : "note-item"} ${!entry.isDirectory && selectedTreePath === entry.path ? "selected" : ""}`}
                  onClick={() => {
                    if (entry.isDirectory) {
                      setSelectedDirectory(entry.path);
                      setSelectedTreePath(entry.path);
                    } else if (entry.isAttachment) {
                      setSelectedTreePath(entry.path);
                      onManage(entry.path);
                    } else onOpen(entry.path);
                  }}
                >
                  <span>{entry.isDirectory ? "▱" : "▧"}</span>
                  <span>
                    {entry.path.split("/").pop()?.replace(/\.md$/i, "")}
                  </span>
                </button>
                <button
                  className="tree-menu"
                  aria-label={t("管理 {0}", entry.path)}
                  disabled={busy || composing || !native}
                  onClick={() => onShowTreeMenu(entry)}
                >
                  ⋯
                </button>
              </div>
            ))}
        {results?.hits.length === 0 && (
          <p className="empty-small">{t("没有匹配的笔记")}</p>
        )}
      </div>
      {results && (
        <p className="search-meta">
          {results.hits.length} {t("条 ·")} {results.elapsedMs.toFixed(1)}{" "}
          {t("ms · 最多 100 条")}
        </p>
      )}
    </div>
  );
}
