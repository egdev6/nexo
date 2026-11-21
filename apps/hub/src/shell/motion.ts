import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TransitionEvent } from 'react';

type Phase = 'hidden' | 'waiting' | 'entering' | 'open' | 'exiting';
interface Motion {
  phase: Phase;
  generation: number;
  sequence?: number;
}

export function requestFlyoutHide() {
  if (isTauri()) void invoke('hide_flyout').catch((error) => console.error('No se pudo ocultar el panel de Nexo.', error));
}

// Subscribe before querying so that an event racing the initial snapshot is not lost.
export function useFlyoutMotion() {
  const native = isTauri();
  const [motion, setMotion] = useState<Motion>(() => ({ phase: native ? 'hidden' : 'open', generation: -1, sequence: -1 }));
  const current = useRef(motion);
  const acknowledged = useRef<number | null>(null);
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    function accept(next: Motion | null) {
      if (cancelled || !next || !['hidden', 'waiting', 'entering', 'open', 'exiting'].includes(next.phase) || typeof next.generation !== 'number') return;
      const previous = current.current;
      if (next.sequence !== undefined && previous.sequence !== undefined) {
        if (next.sequence <= previous.sequence) return;
      } else if (next.generation < previous.generation) return;
      current.current = next;
      setMotion(next);
    }
    void (async () => {
      try {
        const stop = await listen<Motion>('flyout-motion', (event) => accept(event.payload));
        if (cancelled) {
          stop();
          return;
        }
        dispose = stop;
        accept(await invoke<Motion>('get_flyout_motion'));
      } catch (error) {
        if (!cancelled) console.error('No se pudo observar el movimiento del panel de Nexo.', error);
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [native]);

  function acknowledge() {
    const active = current.current;
    if (!native || (active.phase !== 'entering' && active.phase !== 'exiting') || acknowledged.current === active.generation) return;
    acknowledged.current = active.generation;
    void invoke('flyout_motion_finished', { generation: active.generation }).catch((error) =>
      console.error('No se pudo confirmar el movimiento del panel de Nexo.', error),
    );
  }

  const sliding = native && (motion.phase === 'waiting' || motion.phase === 'hidden' || motion.phase === 'entering' || motion.phase === 'exiting');
  useLayoutEffect(() => {
    if (sliding) document.body.setAttribute('data-flyout-sliding', '');
    else document.body.removeAttribute('data-flyout-sliding');
    if (reduced) acknowledge();
    return () => {
      document.body.removeAttribute('data-flyout-sliding');
    };
  }, [sliding, reduced, motion.phase, motion.generation]);

  const className = !native
    ? ''
    : motion.phase === 'hidden' || motion.phase === 'waiting'
      ? ' flyout--waiting'
      : !reduced && motion.phase === 'entering'
        ? ' flyout--entering'
        : !reduced && motion.phase === 'exiting'
          ? ' flyout--exiting'
          : '';
  function onTransitionEnd(event: TransitionEvent<HTMLElement>) {
    if (event.target === event.currentTarget && event.propertyName === 'transform') acknowledge();
  }
  return { phase: motion.phase, generation: motion.generation, sliding, className, onTransitionEnd };
}
