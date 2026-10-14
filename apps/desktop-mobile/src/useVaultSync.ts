import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api, errorText, native, workspace, type SyncConfig } from "./api";
import {
  AutoSyncSchedule,
  defaultAutoSync,
  readAutoSync,
  writeAutoSync,
  type AutoSyncSettings,
} from "./auto-sync";
import { requireSshSync } from "./sync-settings";
import { t } from "./i18n";
import type { DocumentSession } from "./session";

type Options = {
  vaultId?: string;
  busy: boolean;
  blocked: boolean;
  operation: RefObject<boolean>;
  isComposing: RefObject<boolean>;
  syncingRef: RefObject<boolean>;
  session: RefObject<DocumentSession | null>;
  schedule: RefObject<AutoSyncSchedule>;
  trayHidden: RefObject<boolean>;
  flush: () => Promise<void>;
  reload: () => Promise<void>;
  setBusy: (value: boolean) => void;
  setError: (value: string) => void;
  setStatus: (value: string) => void;
};

/** Own sync progress and scheduling; the app retains the shared operation guard. */
export function useVaultSync(options: Options) {
  const {
    vaultId,
    busy,
    blocked,
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
  } = options;
  const [autoSync, setAutoSync] = useState(defaultAutoSync);
  const [autoPaused, setAutoPaused] = useState(false);
  const [syncRevision, setSyncRevision] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [sshAgentError, setSshAgentError] = useState("");
  const handledTrayRevision = useRef(0);
  const trayRunning = useRef(false);

  function configureAutoSync(settings: AutoSyncSettings) {
    if (!vaultId) return;
    try {
      writeAutoSync(localStorage, vaultId, settings);
      setAutoSync(settings);
      autoSchedule.current.paused = false;
      setAutoPaused(false);
    } catch {
      setError(t("无法保存自动同步设置"));
    }
  }
  async function refreshAfterSync() {
    while (operation.current)
      await new Promise((resolve) => setTimeout(resolve, 10));
    operation.current = true;
    setBusy(true);
    try {
      await reload();
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function syncNow(automatic = false) {
    const schedule = autoSchedule.current;
    if (syncingRef.current || operation.current || isComposing.current || busy)
      return;
    syncingRef.current = true;
    if (automatic) {
      try {
        requireSshSync(await workspace<SyncConfig | null>({ action: "config" }));
      } catch (error) {
        schedule.paused = true;
        setAutoPaused(true);
        setError(errorText(error));
        setStatus(t("同步未完成"));
        syncingRef.current = false;
        return;
      }
      try {
        const agent = await api.checkSshAgent();
        if (agent.keyCount === 0)
          throw new Error(t("SSH Agent 尚未加载密钥，请选择 SSH 私钥"));
      } catch (error) {
        schedule.paused = true;
        setAutoPaused(true);
        setSshAgentError(errorText(error));
        setStatus(t("同步未完成"));
        syncingRef.current = false;
        return;
      }
    }
    setSshAgentError("");
    setSyncing(true);
    let success = false;
    try {
      operation.current = true;
      setBusy(true);
      try {
        await flush();
      } finally {
        operation.current = false;
        setBusy(false);
      }
      try {
        requireSshSync(
          await workspace<SyncConfig | null>({ action: "config" }),
        );
        const result = await workspace<{
          state: { phase: string; message: string };
        }>({ action: "sync" });
        await refreshAfterSync();
        setSyncRevision((value) => value + 1);
        if (result.state.phase === "conflict")
          throw new Error(t("Git 同步发生冲突，请在同步设置中处理"));
        schedule.succeeded(Date.now());
        setAutoPaused(false);
        setStatus(t("同步完成"));
        success = true;
      } catch (error) {
        schedule.paused = true;
        setAutoPaused(true);
        setSyncRevision((value) => value + 1);
        try {
          await refreshAfterSync();
        } catch {
          /* Preserve the original sync error. */
        }
        throw error;
      }
    } catch (error) {
      setError(errorText(error));
      setStatus(t("同步未完成"));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
    if (automatic && !success) {
      schedule.paused = true;
      setAutoPaused(true);
    }
  }
  async function loadSshKeyAndSync() {
    try {
      const result = await api.selectSshKey();
      if (!result) return;
      setSshAgentError("");
      await syncNow();
    } catch (error) {
      setSshAgentError(errorText(error));
    }
  }
  useEffect(() => {
    if (!vaultId) return;
    handledTrayRevision.current = 0;
    setAutoSync(readAutoSync(localStorage, vaultId));
    autoSchedule.current = new AutoSyncSchedule(Date.now());
    setAutoPaused(false);
    setSshAgentError("");
  }, [vaultId, autoSchedule]);
  const checkTraySync = useRef<() => Promise<void>>(async () => {});
  checkTraySync.current = async () => {
    if (!native || !vaultId) return;
    const status = await invoke<{
      vaultId: string; running: boolean; revision: number;
      lastSyncAt: number; lastError: string | null; completed: boolean;
    } | null>("tray_sync_status");
    if (!status || status.vaultId !== vaultId) return;
    if (status.running) {
      trayRunning.current = true;
      syncingRef.current = true;
      setSyncing(true);
      return;
    }
    if (trayRunning.current) {
      trayRunning.current = false;
      syncingRef.current = false;
      setSyncing(false);
    }
    if (!status.completed || status.revision <= handledTrayRevision.current) return;
    handledTrayRevision.current = status.revision;
    setSyncRevision(value => value + 1);
    if (status.lastError) {
      autoSchedule.current.paused = true;
      setAutoPaused(true);
      setError(status.lastError);
      setStatus(t("同步未完成"));
    } else {
      autoSchedule.current.succeeded(status.lastSyncAt);
      setAutoPaused(false);
      setStatus(t("同步完成"));
      if (!session.current?.dirty) await refreshAfterSync();
    }
  };
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    const check = () => { void checkTraySync.current().catch(error => setError(errorText(error))); };
    const focus = () => {
      void checkTraySync.current()
        .catch(error => setError(errorText(error)))
        .finally(() => { trayHidden.current = false; });
    };
    listen("tray_sync_started", check).then(keep);
    listen("tray_sync_finished", check).then(keep);
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      stops.forEach(stop => stop());
      window.removeEventListener("focus", focus);
    };
  }, []);
  const automaticTick = useRef(() => {});
  automaticTick.current = () => {
    const unavailable =
      !native ||
      !vaultId ||
      blocked ||
      syncingRef.current ||
      operation.current ||
      isComposing.current ||
      trayHidden.current ||
      document.hidden ||
      !!session.current?.dirty;
    if (autoSchedule.current.due(autoSync, Date.now(), unavailable))
      void syncNow(true);
  };
  useEffect(() => {
    const timer = setInterval(() => automaticTick.current(), 1000);
    return () => clearInterval(timer);
  }, []);
  return {
    autoSync,
    autoPaused,
    syncing,
    sshAgentError,
    syncRevision,
    configureAutoSync,
    syncNow,
    loadSshKeyAndSync,
  };
}
