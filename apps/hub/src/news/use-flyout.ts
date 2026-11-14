import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';

export interface FlyoutVisibility { visible: boolean; sequence: number; cycle: number; at: string | number; shownAt?: string | number }

/** Subscribe before querying, so a show concurrent with startup cannot be lost. */
export function useFlyoutVisibility(onHide: () => void) {
  const native = isTauri();
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;
  const [visibility, setVisibility] = useState<FlyoutVisibility | null>(() => native ? null :
    { visible: true, sequence: 1, cycle: 1, at: new Date().toISOString() });
  const [error, setError] = useState<string | null>(null);
  const lastShow = useRef<{ cycle: number; at: string | number } | null>(
    visibility?.visible ? { cycle: visibility.cycle, at: visibility.at } : null);
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    let sequence = -1;
    const accept = (next: FlyoutVisibility | null) => {
      if (!cancelled && next && next.sequence > sequence) {
        sequence = next.sequence;
        if (next.visible) lastShow.current = { cycle: next.cycle, at: next.at };
        else {
          if (next.cycle > 0 && next.shownAt !== undefined) lastShow.current = { cycle: next.cycle, at: next.shownAt };
          onHideRef.current();
        }
        setVisibility(next);
      }
    };
    void (async () => {
      try {
        const stop = await listen<FlyoutVisibility>('flyout-visibility', event => accept(event.payload));
        if (cancelled) { stop(); return; }
        dispose = stop;
        accept(await invoke<FlyoutVisibility>('get_flyout_state'));
      } catch (failure) {
        if (!cancelled) setError(String(failure));
      }
    })();
    return () => { cancelled = true; dispose?.(); };
  }, [native]);
  return { visibility, lastShow: lastShow.current, error };
}
