import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Stay opaque until the native window reports focus, including on first reveal.
export function observeFlyoutFocus(onFocus: (focused: boolean) => void): () => void {
  if (!isTauri()) return () => {};
  let active = true;
  let unlisten: (() => void) | undefined;
  void (async () => {
    try {
      const stop = await getCurrentWindow().onFocusChanged((event) => {
        if (active) onFocus(event.payload);
      });
      if (active) unlisten = stop;
      else stop();
    } catch (error) {
      if (active) console.error('No se pudo observar el foco del panel de Nexo.', error);
    }
  })();
  return () => {
    active = false;
    unlisten?.();
  };
}
