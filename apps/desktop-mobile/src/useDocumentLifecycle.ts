import { useEffect, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api, native, errorText, type Vault } from "./api";
import { t } from "./i18n";
import type { DocumentSession } from "./session";
import type { AutoSyncSchedule } from "./auto-sync";
type Options = {
  content: string;
  composing: boolean;
  busy: boolean;
  modal: unknown;
  history: unknown;
  session: RefObject<DocumentSession | null>;
  operation: RefObject<boolean>;
  isComposing: RefObject<boolean>;
  syncingRef: RefObject<boolean>;
  vaultRef: RefObject<Vault | null>;
  autoSchedule: RefObject<AutoSyncSchedule>;
  flush: () => Promise<void>;
  updateKnowledge: () => Promise<void>;
  reload: () => Promise<void>;
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  openSearch: () => Promise<void>;
  newNote: () => void;
  setError: (message: string) => void;
  setStatus: (message: string) => void;
};
/** Own the document's timers, close protection and desktop event subscriptions. */
export function useDocumentLifecycle({
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
  flush,
  updateKnowledge,
  reload,
  run,
  openSearch,
  newNote,
  setError,
  setStatus,
}: Options) {
  useEffect(() => {
    if (!session.current?.dirty || composing || busy) return;
    const current = session.current;
    const draftTimer = setTimeout(() => {
      api
        .draft(current.note.path, current.text)
        .catch((e) => setError(t("草稿写入失败：{0}", errorText(e))));
    }, 250);
    const saveTimer = setTimeout(() => {
      void flush().catch(() => {});
    }, 750);
    return () => {
      clearTimeout(draftTimer);
      clearTimeout(saveTimer);
    };
  }, [content, composing, busy, flush]);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => {
      if (disposed) stop();
      else stops.push(stop);
    };
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (syncingRef.current || operation.current || isComposing.current) {
          setError(t("请等待同步、当前操作或中文组合输入结束后再关闭"));
          return;
        }
        try {
          await flush();
          await getCurrentWindow().destroy();
        } catch {
          setError(t("保存未完成，请先协调磁盘版本与恢复草稿"));
        }
      })
      .then(keep);
    listen<{ vaultId: string }>("mcp_note_created", (event) => {
      if (event.payload.vaultId === vaultRef.current?.id) {
        autoSchedule.current.savedAt = Date.now();
        void updateKnowledge().catch((e) => setError(errorText(e)));
      }
    }).then(keep);
    listen<{ vaultId: string; phase: string }>(
      "sync_state_changed",
      (event) => {
        if (event.payload.vaultId === vaultRef.current?.id) {
          const labels: Record<string, string> = {
            committing: t("正在提交"),
            fetching: t("正在获取远程更新"),
            integrating: t("正在合并"),
            pushing: t("正在推送"),
          };
          setStatus(labels[event.payload.phase] ?? event.payload.phase);
        }
      },
    ).then(keep);
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [flush]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!event.isComposing && !operation.current)
          void flush().catch(() => {});
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!event.isComposing && !modal && history === null) void openSearch();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "n" &&
        !event.isComposing
      ) {
        event.preventDefault();
        if (
          !operation.current &&
          !isComposing.current &&
          native &&
          !busy &&
          !modal &&
          history === null
        )
          newNote();
      }
    };
    const hide = () => {
      const current = session.current;
      if (document.hidden && current?.dirty && !operation.current)
        void api.draft(current.note.path, current.text).catch(() => {});
    };
    document.addEventListener("keydown", handler);
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("visibilitychange", hide);
    };
  });
  // Reconcile external edits on focus. Never replace a dirty editor with disk contents.
  useEffect(() => {
    const focus = () => {
      if (
        native &&
        !syncingRef.current &&
        !operation.current &&
        !isComposing.current &&
        !session.current?.dirty
      )
        void run(reload);
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  });
}
