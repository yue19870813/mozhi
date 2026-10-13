import { useCallback, useRef, useState, type RefObject } from "react";
import { api, native, errorText } from "./api";
import { DocumentSession } from "./session";
import { t } from "./i18n";
import type { AutoSyncSchedule } from "./auto-sync";

type Options = {
  syncingRef: RefObject<boolean>;
  autoSchedule: RefObject<AutoSyncSchedule>;
  updateKnowledge: () => Promise<void>;
  onLoaded: () => void;
  setError: (message: string) => void;
  setStatus: (message: string) => void;
};
/** Keep the disk snapshot, draft and editor contents in one document session. */
export function useNoteDocument({
  syncingRef,
  autoSchedule,
  updateKnowledge,
  onLoaded,
  setError,
  setStatus,
}: Options) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [saveStatus, setSaveStatus] = useState("已保存到本机");
  const [recovery, setRecovery] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const session = useRef<DocumentSession | null>(null);
  const isComposing = useRef(false);
  const loadNote = useCallback(
    async (next: string) => {
      const note = await api.read(next),
        draft = await api.readDraft(next);
      session.current = new DocumentSession(note, api.save, setError);
      setPath(next);
      setContent(note.content);
      setSaveStatus(native ? "已保存到本机" : "已更新演示内容");
      setRecovery(draft !== null && draft !== note.content ? draft : null);
      setStatus(native ? t("已保存到本机") : t("浏览器内存演示"));
      onLoaded();
      return note;
    },
    [onLoaded, setError, setStatus],
  );
  const flush = useCallback(async () => {
    const current = session.current;
    if (!current?.dirty) return;
    setStatus(t("正在保存…"));
    setSaveStatus("正在保存…");
    try {
      await current.flush();
      if (current === session.current) {
        autoSchedule.current.savedAt = Date.now();
        setStatus(native ? t("已保存到本机") : t("已更新演示内容"));
        setSaveStatus(native ? "已保存到本机" : "已更新演示内容");
        await updateKnowledge();
      }
    } catch (e) {
      setStatus(t("保存未完成"));
      setSaveStatus("保存未完成");
      setError(errorText(e));
      throw e;
    }
  }, [updateKnowledge, autoSchedule, setError, setStatus]);
  function change(value: string) {
    if (!session.current || syncingRef.current) return;
    session.current.text = value;
    setContent(value);
    setSaveStatus(session.current.dirty ? "待保存…" : native ? "已保存到本机" : "已更新演示内容");
    setStatus(
      session.current.dirty
        ? t("待保存…")
        : native
          ? t("已保存到本机")
          : t("浏览器内存演示"),
    );
  }
  function composition(active: boolean) {
    isComposing.current = active;
    setComposing(active);
  }
  return {
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
  };
}
