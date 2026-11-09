import { useEffect, useRef, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errorText, native, workspace } from "./api";
import { t } from "./i18n";
import type { DocumentSession } from "./session";

type Options = {
  vaultId?: string;
  busy?: boolean;
  session: RefObject<DocumentSession | null>;
  operation: RefObject<boolean>;
  syncingRef: RefObject<boolean>;
  isComposing: RefObject<boolean>;
  reload: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<unknown>;
  setError: (message: string) => void;
};

/** Metadata changes request a refresh; only a changed disk note conflicts with a draft. */
export function useVaultFileChanges(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const { vaultId } = options;
    if (!native || !vaultId) return;
    let disposed = false;
    let checking = false;
    let requested = false;
    let pendingRefresh = false;
    let last: string | undefined;
    let checkedAt = 0;
    let stop: (() => void) | undefined;
    const blocked = () => {
      const { session, operation, syncingRef, isComposing } = latest.current;
      return disposed || document.hidden || latest.current.busy || operation.current || syncingRef.current ||
        isComposing.current || session.current?.saving;
    };
    async function check() {
      if (checking || blocked()) return;
      const readyToRefresh = pendingRefresh && !latest.current.session.current?.dirty;
      if (!requested && !readyToRefresh && last !== undefined && Date.now() - checkedAt < 5000) return;
      checking = true;
      requested = false;
      try {
        const fingerprint = await workspace<string>({ action: "fingerprint" });
        if (blocked()) return;
        if (last !== undefined && last !== fingerprint) {
          pendingRefresh = true;
          const current = latest.current.session.current;
          if (current?.dirty) {
            const snapshot = current.note;
            const disk = await api.read(snapshot.path);
            // A save or navigation during the read invalidates this comparison.
            if (blocked() || latest.current.session.current !== current || current.note !== snapshot) return;
            if (current.dirty && disk.contentHash !== snapshot.contentHash) {
              latest.current.setError(t("检测到外部文件修改。当前草稿已保留，请保存时协调版本。"));
            }
          }
        }
        // Acknowledge even while dirty, so the same change cannot repeat its warning.
        last = fingerprint;
        checkedAt = Date.now();
        if (pendingRefresh && !latest.current.session.current?.dirty && !blocked()) {
          await latest.current.run(latest.current.reload);
          if (!disposed) pendingRefresh = false;
        }
      } catch (e) {
        if (!disposed) latest.current.setError(errorText(e));
      } finally {
        checking = false;
      }
    }
    listen<{ vaultId: string }>("vault_files_changed", (event) => {
      if (event.payload.vaultId === vaultId) requested = true;
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    void check();
    const timer = setInterval(() => void check(), 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
      stop?.();
    };
  }, [options.vaultId]);
}
