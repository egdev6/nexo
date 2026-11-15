import { invoke } from '@tauri-apps/api/core';

export type LocalAppErrorCode = 'nexo.local.missing' | 'nexo.local.notExecutable' | 'nexo.local.refused' | 'nexo.local.notFound' | 'nexo.local.invalidName' | 'nexo.local.dialogFailed' | 'nexo.local.spawnFailed' | 'nexo.local.invalidIcon' | 'nexo.local.iconReadFailed' | 'nexo.local.iconWriteFailed' | 'nexo.local.iconCleanupFailed' | 'nexo.config.save.corrupt' | 'nexo.config.save.unreadable' | 'nexo.config.save.future';
export interface LocalApp { id: string; name: string; executable: string; icon: string | null }
export interface LocalAppSelection { app: LocalApp; duplicate: boolean }

export type LocalAppState = 'ready' | 'missingExecutable';
export type LocalAppOrigin = { kind: 'manual'; id: string };
export interface LocalAppRow {
  /** A stable, namespaced presentation ID, not a launch argument. */
  id: string;
  source: 'local';
  name: string;
  state: LocalAppState;
  origin: LocalAppOrigin;
  /** Owned local file path; it grants no frontend filesystem access. */
  iconPath?: string;
  /** Informational only; opening still uses the opaque origin ID. */
  executable?: string;
  /** Official ID or another namespaced local ID. */
  duplicateOf?: string;
}

/** Read only manual local rows; use the opaque origin ID to launch or repair. */
export async function listLocalApps(): Promise<LocalAppRow[]> {
  const rows = await invoke<LocalAppRow[]>('local_apps_list');
  if (!Array.isArray(rows)) throw new Error('nexo.local.invalidList');
  return rows;
}

export interface ExecutablePick { token: string; path: string; suggestedName: string }
export interface IconPick { token: string; preview: string }
// Paths are display-only. Creation accepts only native-issued, short-lived tokens.
export function pickLocalExecutable(): Promise<ExecutablePick | null> { return invoke('local_app_pick_executable'); }
export function pickLocalIconFile(): Promise<IconPick | null> { return invoke('local_app_pick_icon_file'); }
export function cancelLocalSelection(): Promise<void> { return invoke('local_app_cancel_selection'); }
export function createLocalApp(token: string, name: string, iconToken?: string): Promise<LocalAppSelection> { return invoke('local_app_create', { token, name, iconToken }); }
export function updateLocalApp(id: string, name: string): Promise<LocalAppSelection> { return invoke('local_app_update', { id, name }); }
export function removeLocalApp(id: string): Promise<void> { return invoke('local_app_remove', { id }); }
export function repairLocalApp(id: string): Promise<LocalAppSelection | null> { return invoke('local_app_repair', { id }); }
/** Select and copy an icon locally. The returned icon is an owned identifier, not a filesystem URL. */
export function pickLocalAppIcon(id: string): Promise<LocalAppSelection | null> { return invoke('local_app_pick_icon', { id }); }
/** Read validated local icon data by opaque ID, never by a frontend-supplied path. */
export function localAppIcon(id: string): Promise<string | null> { return invoke('local_app_icon', { id }); }
/** A resolved request means spawn was requested, not that the app is running. */
export function openLocalApp(id: string): Promise<void> { return invoke('local_app_open', { id }); }
