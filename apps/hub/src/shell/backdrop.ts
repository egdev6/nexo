import { invoke } from '@tauri-apps/api/core';
import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

interface Clip {
  width: number; height: number;
  x: number; y: number; contentWidth: number; contentHeight: number;
}
interface Request { clip: Clip | null; blur: number; opacity: number; generation: number }

// The foreground paints the tint/opacity; the independent visual only blurs the
// desktop behind the currently visible content, never the header or tab row.
function measure(panel: HTMLElement): Clip | null {
  const area = panel.querySelector<HTMLElement>('.area-scroll, .main-tabs [role="tabpanel"]:not([hidden])');
  const scale = window.devicePixelRatio;
  if (!area || !Number.isFinite(scale) || scale <= 0) return null;
  const outer = panel.getBoundingClientRect();
  const content = area.getBoundingClientRect();
  // The Tabs frame owns side gutters; the native blur still spans the whole flyout.
  const horizontal = area.matches('[role="tabpanel"]') ? area.closest<HTMLElement>('.main-tabs-frame')?.getBoundingClientRect() ?? content : content;
  const width = Math.round(outer.width * scale);
  const height = Math.round(outer.height * scale);
  const x = Math.max(0, Math.ceil((horizontal.left - outer.left) * scale));
  const y = Math.max(0, Math.ceil((content.top - outer.top) * scale));
  const right = Math.min(width, Math.floor((horizontal.right - outer.left) * scale));
  const bottom = Math.min(height, Math.floor((content.bottom - outer.top) * scale));
  if (width <= 0 || height <= 0 || right <= x || bottom <= y) return null;
  return { width, height, x, y, contentWidth: right - x, contentHeight: bottom - y };
}

export function useContentBackdrop(panel: RefObject<HTMLElement | null>, available: boolean, phase: string, generation: number, blur: number, opacity: number) {
  const queue = useRef<{ busy: boolean; pending: Request | null; last: string }>({ busy: false, pending: null, last: '' });
  useLayoutEffect(() => {
    const element = panel.current;
    if (!available || phase !== 'open' || !element) return;
    let cancelled = false;
    let scheduled = false;
    let forceMeasure = false;
    const state = queue.current;
    const submit = (request: Request) => {
      const key = JSON.stringify(request);
      if (key === state.last && !state.pending) return;
      state.pending = request;
      if (state.busy) return;
      state.busy = true;
      void (async () => {
        while (state.pending) {
          const next = state.pending;
          state.pending = null;
          try {
            await invoke('set_surface_clip', { ...next });
            state.last = JSON.stringify(next);
          } catch (error) {
            state.last = '';
            console.warn('No se pudo aplicar el fondo del panel de Nexo.', error);
          }
        }
        state.busy = false;
      })();
    };
    const schedule = (force = false) => {
      forceMeasure ||= force;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (forceMeasure) state.last = '';
        forceMeasure = false;
        if (!cancelled) submit({ clip: measure(element), blur, opacity, generation });
      });
    };
    const onResize = () => schedule(true);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    const observe = () => {
      resize?.disconnect();
      resize?.observe(element);
      element.querySelectorAll<HTMLElement>('.area-scroll, .panel-head, .main-tabs [role="tablist"], .main-tabs [role="tabpanel"]:not([hidden])').forEach(node => resize?.observe(node));
    };
    const mutation = new MutationObserver(() => { observe(); schedule(); });
    mutation.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'data-state'] });
    observe();
    window.addEventListener('resize', onResize);
    schedule();
    return () => {
      cancelled = true;
      state.pending = null;
      mutation.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [panel, available, phase, generation, blur, opacity]);
}
