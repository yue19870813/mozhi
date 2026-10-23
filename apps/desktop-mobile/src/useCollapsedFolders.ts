import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

const key = (vaultId: string) => 'mozhi-collapsed-folders-v1:' + vaultId;
export function readCollapsedFolders(vaultId: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(vaultId)) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string' && path.length > 0) : []);
  } catch { return new Set(); }
}

export function useCollapsedFolders() {
  const [collapsed, update] = useState<Set<string>>(new Set());
  const current = useRef({ vaultId: '', folders: new Set<string>() });
  const restore = useCallback((vaultId: string) => {
    const folders = readCollapsedFolders(vaultId);
    current.current = { vaultId, folders };
    update(folders);
  }, []);
  const setCollapsed: Dispatch<SetStateAction<Set<string>>> = useCallback(action => {
    const state = current.current;
    const folders = typeof action === 'function' ? action(state.folders) : action;
    current.current = { ...state, folders };
    update(folders);
    if (state.vaultId) {
      try { localStorage.setItem(key(state.vaultId), JSON.stringify([...folders])); }
      catch { /* An unavailable preference store must not interrupt navigation. */ }
    }
  }, []);
  return { collapsed, setCollapsed, restore };
}
