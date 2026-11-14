import { invoke } from '@tauri-apps/api/core';

export type LocalAppErrorCode = 'nexo.local.missing' | 'nexo.local.notExecutable' | 'nexo.local.refused' | 'nexo.local.notFound' | 'nexo.local.invalidName' | 'nexo.local.dialogFailed' | 'nexo.local.spawnFailed' | 'nexo.config.save.corrupt' | 'nexo.config.save.unreadable' | 'nexo.config.save.future';
export interface LocalApp { id: string; name: string; executable: string; icon: string | null }
export interface LocalAppSelection { app: LocalApp; duplicate: boolean }

// Only native pickers can select executables; callers pass opaque IDs, never paths.
export function addLocalApp(): Promise<LocalAppSelection | null> { return invoke('local_app_add'); }
export function updateLocalApp(id: string, name: string): Promise<LocalAppSelection> { return invoke('local_app_update', { id, name }); }
export function removeLocalApp(id: string): Promise<void> { return invoke('local_app_remove', { id }); }
export function repairLocalApp(id: string): Promise<LocalAppSelection | null> { return invoke('local_app_repair', { id }); }
/** A resolved request means spawn was requested, not that the app is running. */
export function openLocalApp(id: string): Promise<void> { return invoke('local_app_open', { id }); }
