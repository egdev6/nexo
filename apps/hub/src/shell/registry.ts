import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface RegistryItem {
  id: string;
  label: string;
  enabled: boolean;
  checked?: boolean;
}

export interface RegistryApp {
  app: { id: string; name: string; version: string };
  capabilities: string[];
  menu: RegistryItem[];
  unified: boolean;
  responsive: boolean;
  generation: number;
  menu_revision: number;
}

export type NoticeDetail =
  | { kind: 'connectionClosed' }
  | { kind: 'trayFailure' }
  | {
      kind: 'quit';
      all: boolean;
      failures: { app: string; outcome: { kind: 'refused'; reason?: string | null } | { kind: 'timeout' | 'unavailable' | 'disconnected' } }[];
    };

export interface RegistrySnapshot {
  revision: number;
  apps: RegistryApp[];
  notice?: { message: string; hub_only_allowed: boolean; detail?: NoticeDetail | null } | null;
}

export async function exitHubOnly(): Promise<void> {
  if (isTauri()) await invoke('hub_only_exit');
}

// Subscribe before fetching: the caller discards snapshots older than the latest event.
export async function subscribeRegistry(
  onSnapshot: (snapshot: RegistrySnapshot) => void,
  onError: (error: unknown) => void = (error) => console.error('No se pudo leer el registro de Nexo.', error),
): Promise<() => void> {
  if (!isTauri()) return () => {};
  let active = true;
  const unlisten = await listen<RegistrySnapshot>('nexo-registry', (event) => {
    if (active) onSnapshot(event.payload);
  });
  const stop = () => {
    if (active) {
      active = false;
      unlisten();
    }
  };
  // The initial fetch must not delay cleanup if the webview unmounts while it is pending.
  void invoke<RegistrySnapshot>('registry_snapshot')
    .then((snapshot) => {
      if (active) onSnapshot(snapshot);
    })
    .catch((error) => {
      if (active) {
        stop();
        onError(error);
      }
    });
  return stop;
}
