import { AppIcon } from '@egdev/ui';
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
  return <AppIcon size="lg" monogram={row.name.trim().charAt(0).toUpperCase()} src={icon?.url ?? undefined} />;
}
