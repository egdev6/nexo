import { invoke } from '@tauri-apps/api/core';
import { t, type MessageKey } from '../i18n';
import messages from '../i18n/messages.json';
import type { Language } from '../model';

/** Re-render hub-owned native messages in the current locale; preserve external diagnostics. */
export function localizeAppReason(locale: Language, value: string): string {
  const keys = Object.keys(messages.es.native).filter(key => key.startsWith('app')) as (keyof typeof messages.es.native)[];
  for (const key of keys) {
    for (const template of [messages.es.native[key], messages.en.native[key]]) {
      if (template === value) return t(locale, `native.${key}` as MessageKey);
      const [prefix, suffix] = template.split('{error}');
      if (suffix !== undefined && value.startsWith(prefix) && value.endsWith(suffix) && value.length >= prefix.length + suffix.length) {
        return t(locale, `native.${key}` as MessageKey, { error: value.slice(prefix.length, value.length - suffix.length) });
      }
    }
  }
  return value;
}

export interface InstallationObservation {
  id: string;
  state: 'installed' | 'notInstalled' | 'unknown';
  runningState?: 'connected' | 'running' | 'notRunning' | 'unknown';
  reason: string;
  version: string | null;
  canOpen?: boolean;
  openReason?: string | null;
}

/** Native scans use the validated official catalog and do not accept paths from the webview. */
export async function scanInstallations(): Promise<InstallationObservation[]> {
  const result = await invoke<InstallationObservation[]>('installed_apps');
  if (!Array.isArray(result)) throw new Error('nexo.apps.invalidScan');
  return result;
}

/** Native code resolves the executable or routes to the connected plugin; only an ID crosses IPC. */
export async function openOfficialApp(id: string): Promise<string> {
  return invoke<string>('open_official_app', { id });
}

/** Resolves the official executable natively and requests a normal window close. */
export async function closeOfficialApp(id: string): Promise<{ status: 'closed' | 'stillRunning'; message: string }> {
  return invoke('close_official_app', { id });
}

/** Requests a plugin's existing graceful quit protocol; it does not terminate a process. */
export async function closeConnectedApp(id: string): Promise<void> {
  await invoke('close_connected_app', { id });
}
