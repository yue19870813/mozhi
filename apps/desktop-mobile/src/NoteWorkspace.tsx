import { t, useLanguage } from "./i18n";
import { Editor } from "./Editor";
import { MindmapPreview } from "./MindmapPreview";
import { Preview } from "./Preview";
import { Icon } from "./AppShell";
import { native, type ParsedNote } from "./api";
import { platform } from "./platform";
import type { EditorMode } from "./navigation";
import { noteStats } from "./note-stats";
import { useMemo, useState } from "react";
import { ListTree, Link2, X } from "lucide-react";
import { noteOutline } from "./note-outline";

type Props = {
  visible: boolean;
  vaultId?: string;
  path: string;
  title: string;
  content: string;
  saveStatus: string;
  current?: ParsedNote;
  notes: ParsedNote[];
  mode: EditorMode;
  busy: boolean;
  composing: boolean;
  syncBlocked: boolean;
  syncing: boolean;
  pinned: boolean;
  relationsOpen: boolean;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onMode: (mode: EditorMode) => void;
  onSummary: () => void;
  onTogglePin: () => void;
  onImportImage: () => void;
  onPasteImage?: (file: File) => Promise<string | null>;
  onToggleRelations: () => void;
  onCloseRelations: () => void;
  onManage: (kind: "move" | "delete") => void;
  onHistory: () => void;
  onChange: (value: string) => void;
  onComposition: (active: boolean) => void;
  onOpen: (path: string) => void;
  onLink: (path: string, wiki?: boolean) => void;
  onTag: (tag: string) => void;
  onError: (message: string) => void;
};

/** The editor stays mounted when navigating between modules. */
export function NoteWorkspace({
  visible,
  vaultId,
  path,
  title,
  content,
  saveStatus,
  current,
  notes,
  mode,
  busy,
  composing,
  syncBlocked,
  syncing,
  pinned,
  relationsOpen,
  sidebarVisible,
  onToggleSidebar,
  onMode,
  onSummary,
  onTogglePin,
  onImportImage,
  onPasteImage,
  onToggleRelations,
  onCloseRelations,
  onManage,
  onHistory,
  onChange,
  onComposition,
  onOpen,
  onLink,
  onTag,
  onError,
}: Props) {
  useLanguage();
  const { count, minutes } = noteStats(content);
  const headings = useMemo(() => noteOutline(content), [content]);
  const [panel, setPanel] = useState<"outline" | "relations">("outline");
  const [jump, setJump] = useState<{ offset: number; serial: number; documentKey: string } | null>(null);
  const currentJump = jump?.documentKey === `${vaultId}:${path}` ? jump : null;
  function showPanel(next: "outline" | "relations") {
    if (relationsOpen && panel === next) onCloseRelations();
    else {
      setPanel(next);
      if (!relationsOpen) onToggleRelations();
    }
  }
  return (
    <section hidden={!visible} className="note-workspace">
      <header className="note-heading">
        <div className="note-heading-copy">
          <h1 title={title || t("一个想法，从这里开始")}>
            {title || t("一个想法，从这里开始")}
          </h1>
          {path && (
            <p className="subtle note-metrics">
              <span>{t("{0} 字", count.toLocaleString())}</span>
              <span>{t("阅读约 {0} 分钟", minutes)}</span>
              <span className="note-save-state" role="status">
                {t(saveStatus)}
              </span>
            </p>
          )}
        </div>
        <div className="note-heading-controls">
          <button
            className="sidebar-toggle"
            title={sidebarVisible ? t("隐藏侧栏") : t("展开侧栏")}
            aria-label={sidebarVisible ? t("隐藏笔记侧栏") : t("展开笔记侧栏")}
            aria-expanded={sidebarVisible}
            aria-controls="module-sidebar"
            onClick={onToggleSidebar}
          >
            <Icon name="panel" />
          </button>
          <div className="segmented" role="group" aria-label={t("笔记视图")}>
            {(["source", "split", "preview", "mindmap"] as const).map((key, i) => (
              <button
                disabled={composing}
                aria-pressed={mode === key}
                className={mode === key ? "selected" : ""}
                key={key}
                onClick={() => onMode(key)}
              >
                {[t("源码"), t("分栏"), t("预览"), t("脑图")][i]}
              </button>
            ))}
          </div>
          {path && (
            <div className="note-tools">
              <button disabled={busy || composing} onClick={onSummary}>
                {t("AI 总结")}
              </button>
              <button
                disabled={busy || composing}
                aria-pressed={pinned}
                onClick={onTogglePin}
              >
                {pinned ? t("取消置顶") : t("置顶笔记")}
              </button>
              <button
                disabled={
                  busy || composing || !native || syncBlocked || syncing
                }
                onClick={onImportImage}
              >
                {t("插入图片")}
              </button>
              <button
                aria-expanded={relationsOpen && panel === "outline"}
                aria-controls="note-relations"
                onClick={() => showPanel("outline")}
              >
                <ListTree size={15} aria-hidden="true" /> {t("大纲")}
              </button>
              <button
                aria-expanded={relationsOpen && panel === "relations"}
                aria-controls="note-relations"
                onClick={() => showPanel("relations")}
              >
                <Link2 size={15} aria-hidden="true" /> {t("关联信息")}
              </button>
              <details className="note-menu">
                <summary aria-label={t("笔记操作")} title={t("更多笔记操作")}>
                  {t("更多 ···")}
                </summary>
                <div className="note-menu-items">
                  <button
                    disabled={busy || composing || !native}
                    onClick={() => onManage("move")}
                  >
                    {t("重命名 / 移动")}
                  </button>
                  <button
                    disabled={busy || composing || !native}
                    onClick={onHistory}
                  >
                    {t("版本历史")}
                  </button>
                  <button
                    disabled={busy || composing || !native}
                    onClick={() => onManage("delete")}
                  >
                    {t("删除")}
                  </button>
                </div>
              </details>
            </div>
          )}
        </div>
      </header>
      {path ? (
        <div className="editing-area">
          <div className={`document-panes ${mode}`}>
            {
              <div hidden={mode === "preview" || mode === "mindmap"} className="source-pane">
                <div className="pane-label">
                  MARKDOWN <span>UTF-8</span>
                </div>
                <Editor
                  documentKey={`${vaultId}:${path}`}
                  value={content}
                  readOnly={busy || syncBlocked || syncing}
                  onChange={onChange}
                  onComposition={onComposition}
                  onPasteImage={onPasteImage}
                  notes={notes}
                  path={path}
                  jump={mode === "source" || mode === "split" ? currentJump : null}
                />
              </div>
            }
            {
              <div hidden={mode === "source" || mode === "mindmap"} className="preview-pane">
                <div className="pane-label">
                  {t("预览")} <span>{t("安全渲染")}</span>
                </div>
                <Preview content={content} path={path} onOpen={onLink} jump={mode !== "source" ? currentJump : null} />
              </div>
            }
            {mode === "mindmap" && visible && <MindmapPreview key={`${vaultId}:${path}`} content={content} title={title || t("无标题")}/>}
          </div>
          <aside
            id="note-relations"
            className="relations"
            hidden={!relationsOpen}
          >
            <div className="note-panel-header"><div className="note-panel-tabs" role="tablist" aria-label={t("笔记侧栏")}>
              <button role="tab" aria-selected={panel === "outline"} onClick={() => setPanel("outline")}>{t("大纲")}</button>
              <button role="tab" aria-selected={panel === "relations"} onClick={() => setPanel("relations")}>{t("关联信息")}</button>
            </div><button className="relation-close" aria-label={t("关闭笔记侧栏")} onClick={onCloseRelations}><X size={16}/></button></div>
            {panel === "outline" ? <nav className="note-outline" aria-label={t("本文大纲")}>
              {headings.length ? headings.map((heading, index) => <button key={`${heading.offset}-${index}`} className="outline-item" style={{paddingLeft: 8 + (heading.level - 1) * 12}} title={heading.text} onClick={() => setJump({offset:heading.offset,serial:Date.now() + index,documentKey:`${vaultId}:${path}`})}>{heading.text || t("无标题")}</button>) : <p className="subtle">{t("本文没有标题")}</p>}
            </nav> : <>
            <h3>{t("标签")}</h3>
            <p className="subtle">{t("在 front matter 的 tags 数组中编辑")}</p>
            <div className="tag-list">
              {current?.tags.map((t) => (
                <button key={t} onClick={() => onTag(t)}>
                  #{t}
                </button>
              ))}
            </div>
            <h3>{t("反向链接")}</h3>
            {notes
              .filter((n) => n.references.some((r) => r.target === path))
              .map((n) => (
                <button
                  className="relation-link"
                  key={n.path}
                  onClick={() => onOpen(n.path)}
                >
                  {n.title}
                </button>
              ))}
            <h3>{t("出站链接")}</h3>
            {current?.references
              .filter((r) => !r.image)
              .map((r, i) => (
                <button
                  className="relation-link"
                  key={i}
                  onClick={() => {
                    if (r.target) onOpen(r.target);
                    else
                      onError(
                        `${r.resolution === "ambiguous" ? t("同名歧义") : t("目标缺失")}：${r.raw}`,
                      );
                  }}
                >
                  {r.target ? "↗" : "○"} {r.raw}
                  {r.resolution === "ambiguous" ? t("（歧义）") : ""}
                </button>
              ))}
            {current?.issues.map((issue) => (
              <p className="metadata-issue" key={issue}>
                {issue}
              </p>
            ))}
            </>}
          </aside>
        </div>
      ) : (
        <div className="empty-state">
          <h2>{t("从第一篇笔记开始")}</h2>
          <p>{t("打开本地目录，或点击侧边栏「＋笔记」。")}</p>
        </div>
      )}
      <footer className="document-footer">
        <span>
          {composing ? t("中文组合输入中") : t("750 ms 自动保存")} ·{" "}
          {platform.modifier} {t("S 保存 ·")} {platform.modifier} {t("N 新建")}
        </span>
        <span>
          {t("本地 Markdown ·")} {t(platform.desktop)} MVP
        </span>
      </footer>
    </section>
  );
}
