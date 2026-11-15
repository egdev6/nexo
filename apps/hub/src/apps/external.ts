import { invoke, isTauri } from '@tauri-apps/api/core';

/** The native command owns the allowlist; browser previews never open destinations. */
export function openExternal(url: string): Promise<void> {
  return isTauri() ? invoke('open_external', { url }) : Promise.resolve();
}
