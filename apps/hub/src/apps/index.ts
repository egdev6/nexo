import { invoke } from '@tauri-apps/api/core';

export interface InstallationObservation {
  id: string;
  state: 'installed' | 'notInstalled' | 'unknown';
  reason: string;
  version: string | null;
  canOpen?: boolean;
  openReason?: string | null;
}

/** Native scans use the validated official catalog and do not accept paths from the webview. */
export async function scanInstallations(): Promise<InstallationObservation[]> {
  const result = await invoke<InstallationObservation[]>('installed_apps');
  if (!Array.isArray(result)) throw new Error('No se pudo comprobar la instalación');
  return result;
}

/** Native code resolves the executable or routes to the connected plugin; only an ID crosses IPC. */
export async function openOfficialApp(id: string): Promise<string> {
  return invoke<string>('open_official_app', { id });
}

/** Requests a plugin's existing graceful quit protocol; it does not terminate a process. */
export async function closeConnectedApp(id: string): Promise<void> {
  await invoke('close_connected_app', { id });
}
