import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import type { AnimationEvent } from 'react';

type Phase = 'hidden' | 'enter' | 'exit' | 'open';
interface FlyoutMotion { phase: Phase; sequence: number }

// The native snapshot closes the gap between showing the window and subscribing.
export function useFlyoutMotion() {
  const native = isTauri();
  const [motion, setMotion] = useState<FlyoutMotion>(() => ({ phase: native ? 'hidden' : 'enter', sequence: -1 }));
  const current = useRef(motion);
  const finished = useRef(-1);

  function finishExit() {
    const { phase, sequence } = current.current;
    if (!native || phase !== 'exit' || finished.current === sequence) return;
    finished.current = sequence;
    void invoke('finish_flyout_hide', { sequence }).catch(error => console.error('No se pudo ocultar el panel de Nexo.', error));
  }

  useEffect(() => {
    if (!native) return;
    let active = true;
    let stop: (() => void) | undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onPreferenceChange = () => { if (reduced?.matches) finishExit(); };
    reduced?.addEventListener?.('change', onPreferenceChange);
    const accept = (next: FlyoutMotion | null) => {
      if (!active || !next || next.sequence <= current.current.sequence) return;
      current.current = next;
      setMotion(next);
      if (next.phase === 'exit' && reduced?.matches) finishExit();
    };
    void (async () => {
      try {
        const unlisten = await listen<FlyoutMotion>('flyout-motion', event => accept(event.payload));
        if (!active) { unlisten(); return; }
        stop = unlisten;
        accept(await invoke<FlyoutMotion>('get_flyout_motion'));
      } catch (error) {
        console.error('No se pudo escuchar el movimiento del panel de Nexo.', error);
        if (active) setMotion({ phase: 'open', sequence: current.current.sequence });
      }
    })();
    return () => { active = false; stop?.(); reduced?.removeEventListener?.('change', onPreferenceChange); };
  }, [native]);

  function onAnimationEnd(event: AnimationEvent<HTMLElement>) {
    if (event.target === event.currentTarget && event.animationName === 'flyout-exit') finishExit();
  }

  return { className: `flyout--${motion.phase}`, onAnimationEnd };
}
