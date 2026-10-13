import { invoke, isTauri } from '@tauri-apps/api/core';

export function webUrl(value: string): string | null {
  if (value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value) || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function openWebUrl(url: string): Promise<void> {
  const validated = webUrl(url);
  if (!validated) throw new Error('Invalid web link');
  if (isTauri()) await invoke('open_external_link', { url: validated });
  else window.open(validated, '_blank', 'noopener,noreferrer');
}
