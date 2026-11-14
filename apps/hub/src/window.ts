import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Browser previews and jsdom do not have the Tauri bridge.
export async function backdropAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('backdrop_available');
  } catch (error) {
    console.error('No se pudo comprobar el fondo del panel de Nexo.', error);
    return false;
  }
}

export async function hideFlyout(): Promise<void> {
  if (!isTauri()) return;
  try {
    await getCurrentWindow().hide();
  } catch (error) {
    console.error('No se pudo ocultar el panel de Nexo.', error);
  }
}

export async function resizeFlyout(contentHeight: number): Promise<void> {
  if (!isTauri() || !Number.isFinite(contentHeight) || contentHeight <= 0) return;
  try {
    await invoke('resize_flyout', { contentHeight });
  } catch (error) {
    console.error('No se pudo ajustar el panel de Nexo.', error);
  }
}
