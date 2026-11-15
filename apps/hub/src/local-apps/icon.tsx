import { useEffect, useRef, useState } from 'react';
import { localAppIcon, type LocalAppRow } from './index';

type IconEntry = { id: string; path: string | undefined; revision: number; url: string | null };

/** Cache only per mounted row; a changed path or successful picker invalidates the entry. */
function useLocalAppIcon(row: LocalAppRow, revision: number) {
  const id = row.origin.id;
  const path = row.iconPath;
  const cache = useRef(new Map<string, IconEntry>());
  const [result, setResult] = useState<IconEntry | null>(null);

  useEffect(() => {
    const cached = cache.current.get(id);
    if (cached && cached.path === path && cached.revision === revision) {
      setResult(cached);
      return;
    }
    let active = true;
    function finish(value: unknown) {
      if (!active) return;
      // Only the native command's PNG/ICO base64 data can reach an image element.
      const url = typeof value === 'string' && /^data:image\/(?:png|x-icon);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
      const entry = { id, path, revision, url };
      cache.current.set(id, entry);
      setResult(entry);
    }
    void localAppIcon(id).then(finish, () => finish(null));
    return () => { active = false; };
  }, [id, path, revision]);

  return result && result.id === id && result.path === path && result.revision === revision ? result : null;
}

export function LocalAppIcon({ row, revision = 0 }: { row: LocalAppRow; revision?: number }) {
  const icon = useLocalAppIcon(row, revision);
  const [failed, setFailed] = useState<IconEntry | null>(null);
  return <span aria-hidden="true" className="app-icon" style={{ display: 'grid', fontSize: 'var(--space-6)', color: 'var(--color-fg-default)' }}>
    {icon?.url && icon !== failed ? <img src={icon.url} alt="" onError={() => setFailed(icon)} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'inherit' }} /> : row.name[0]}
  </span>;
}
