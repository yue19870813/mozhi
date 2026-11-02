import { useEffect, useState } from 'react';
import { native, workspace } from './api';

/** Resolve only relative images inside the vault's attachments directory. */
export function attachmentImagePath(notePath: string, source: string): string | null {
  try {
    const decoded = decodeURIComponent(source);
    if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('/') || /[\\\0?#]/.test(decoded)) return null;
    const parts = notePath.split('/').slice(0, -1);
    for (const part of decoded.split('/')) {
      if (part === '..') {
        if (!parts.length) return null;
        parts.pop();
      } else if (part && part !== '.') parts.push(part);
    }
    const relative = parts.join('/');
    return relative.startsWith('attachments/') ? relative : null;
  } catch { return null; }
}

export function useAttachmentImage(path: string, source: string) {
  const relative = attachmentImagePath(path, source);
  const [loaded, setLoaded] = useState<{ relative: string; url: string } | null>(null);
  useEffect(() => {
    let active = true;
    setLoaded(null);
    if (native && relative) {
      void workspace<string>({ action: 'attachment', path: relative }).then(url => {
        if (active) setLoaded({ relative, url });
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [relative]);
  return loaded?.relative === relative ? loaded?.url ?? '' : '';
}
