import { invoke, isTauri } from '@tauri-apps/api/core';

// Native code owns the window animation and hides it without a webview acknowledgement.
export function requestFlyoutHide() {
  if (isTauri()) void invoke('hide_flyout').catch(error => console.error('No se pudo ocultar el panel de Nexo.', error));
}
