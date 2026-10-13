import { t, dateTime, useLanguage } from "./i18n";
export type NoteModal = {
  kind: "note" | "directory" | "move" | "delete";
  source: string;
  value: string;
  parent?: string;
};
export type HistoryEntry = { id: string; message: string; timestamp: number };

type NoteActionProps = {
  modal: NoteModal;
  vaultName?: string;
  tree: { path: string; isDirectory: boolean }[];
  busy: boolean;
  composing: boolean;
  error: string;
  onChange: (value: NoteModal) => void;
  onSubmit: () => void;
  onClose: () => void;
  onClearError: () => void;
};
export function NoteActionDialog({
  modal,
  vaultName,
  tree,
  busy,
  composing,
  error,
  onChange,
  onSubmit,
  onClose,
  onClearError,
}: NoteActionProps) {
  useLanguage();
  return (
    <div className="modal-backdrop">
      <form
        className="modal create-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("管理笔记")}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h2>
          {
            {
              note: t("新建笔记"),
              directory: t("新建目录"),
              move: t("重命名或移动"),
              delete: t("删除并保留恢复副本"),
            }[modal.kind]
          }
        </h2>
        {modal.kind === "note" || modal.kind === "directory" ? (
          <>
            <label className="modal-field">
              {t("位置")}
              <select
                aria-label={t("新建位置")}
                value={modal.parent ?? ""}
                onChange={(e) => onChange({ ...modal, parent: e.target.value })}
              >
                <option value="">
                  {vaultName ?? t("笔记库")} {t(" · 根目录")}
                </option>
                {tree
                  .filter((entry) => entry.isDirectory)
                  .map((entry) => (
                    <option key={entry.path} value={entry.path}>
                      {entry.path}
                    </option>
                  ))}
              </select>
            </label>
            <label className="modal-field">
              {t("名称")}
              <input
                autoFocus
                aria-label={t("名称")}
                value={modal.value}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  onClearError();
                  onChange({ ...modal, value: e.target.value });
                }}
              />
            </label>
            <p className="create-destination">
              {modal.parent ? `${modal.parent} / ` : ""}
              {modal.value.trim()}
              {modal.kind === "note" && !modal.value.trim().endsWith(".md")
                ? ".md"
                : ""}
            </p>
          </>
        ) : (
          <>
            <p className="subtle">{modal.source}</p>
            {modal.kind !== "delete" && (
              <input
                autoFocus
                aria-label={t("目标路径")}
                value={modal.value}
                onChange={(e) => onChange({ ...modal, value: e.target.value })}
              />
            )}
          </>
        )}
        <div className="workspace-toolbar">
          <button
            type="submit"
            className="primary"
            disabled={busy || composing}
          >
            {modal.kind === "delete"
              ? t("确认删除")
              : modal.kind === "note" || modal.kind === "directory"
                ? t("创建")
                : t("保存")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onClose();
            }}
          >
            {t("取消")}
          </button>
          {modal.kind === "move" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange({ ...modal, kind: "delete" })}
            >
              {t("删除此项")}
            </button>
          )}
        </div>
        {error && <p role="alert">{t(error)}</p>}
      </form>
    </div>
  );
}

type HistoryProps = {
  history: HistoryEntry[];
  path: string;
  historical: string | null;
  busy: boolean;
  composing: boolean;
  syncBlocked: boolean;
  syncing: boolean;
  onSelect: (id: string) => void;
  onRestore: () => void;
  onClose: () => void;
};
export function HistoryDialog({
  history,
  path,
  historical,
  busy,
  composing,
  syncBlocked,
  syncing,
  onSelect,
  onRestore,
  onClose,
}: HistoryProps) {
  useLanguage();
  return (
    <div className="modal-backdrop">
      <div
        className="modal history-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("版本历史")}
      >
        <h2>
          {t("版本历史 ·")} {path}
        </h2>
        <p className="subtle">
          {t("恢复作为当前修改保存，下一次同步产生新提交，不改写历史。")}
        </p>
        <div className="revision-list">
          {history.map((h) => (
            <button key={h.id} disabled={busy} onClick={() => onSelect(h.id)}>
              {dateTime(h.timestamp * 1000)} · {h.message} · {h.id.slice(0, 7)}
            </button>
          ))}
        </div>
        {historical !== null && (
          <textarea aria-label={t("历史内容")} readOnly value={historical} />
        )}
        <div className="workspace-toolbar">
          <button
            disabled={
              busy || composing || syncBlocked || syncing || historical === null
            }
            onClick={onRestore}
          >
            {t("恢复此版本到编辑器")}
          </button>
          <button onClick={onClose}>{t("关闭")}</button>
        </div>
      </div>
    </div>
  );
}
