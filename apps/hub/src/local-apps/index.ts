import { invoke } from '@tauri-apps/api/core';

export type LocalAppErrorCode = 'nexo.local.missing' | 'nexo.local.notExecutable' | 'nexo.local.refused' | 'nexo.local.notFound' | 'nexo.local.invalidName' | 'nexo.local.dialogFailed' | 'nexo.local.spawnFailed' | 'nexo.local.invalidIcon' | 'nexo.local.iconReadFailed' | 'nexo.local.iconWriteFailed' | 'nexo.local.iconCleanupFailed' | 'nexo.config.save.corrupt' | 'nexo.config.save.unreadable' | 'nexo.config.save.future';
export interface LocalApp { id: string; name: string; executable: string; icon: string | null }
export interface LocalAppSelection { app: LocalApp; duplicate: boolean }

// Only native pickers can select executables; callers pass opaque IDs, never paths.
export function addLocalApp(): Promise<LocalAppSelection | null> { return invoke('local_app_add'); }
export function updateLocalApp(id: string, name: string): Promise<LocalAppSelection> { return invoke('local_app_update', { id, name }); }
export function removeLocalApp(id: string): Promise<void> { return invoke('local_app_remove', { id }); }
export function repairLocalApp(id: string): Promise<LocalAppSelection | null> { return invoke('local_app_repair', { id }); }
/** Select and copy an icon locally. The returned icon is an owned identifier, not a filesystem URL. */
export function pickLocalAppIcon(id: string): Promise<LocalAppSelection | null> { return invoke('local_app_pick_icon', { id }); }
/** A resolved request means spawn was requested, not that the app is running. */
export function openLocalApp(id: string): Promise<void> { return invoke('local_app_open', { id }); }

export interface LocalEntryKey { sourceId: string; appId: string }
export interface LocalCatalogEntry { key: LocalEntryKey; source: 'local'; name: string; tagline: string; description: string; tags: string[] }
export interface LocalCatalogSnapshot { sourceId: string; entries: LocalCatalogEntry[] }
export interface LocalBinding { sourceId: string; appId: string; executable: string }
export type LocalCatalogErrorCode = LocalAppErrorCode | 'nexo.local.catalogUnreadable' | 'nexo.local.catalogInvalid' | 'nexo.local.catalogLaunchOnly' | 'nexo.local.unbound';

/** Choose a local JSON file; an existing source ID replaces that source. */
export function setLocalCatalog(sourceId?: string): Promise<LocalCatalogSnapshot | null> { return invoke('local_catalog_set', { sourceId: sourceId ?? null }); }
export function refreshLocalCatalog(sourceId: string): Promise<LocalCatalogSnapshot> { return invoke('local_catalog_refresh', { sourceId }); }
export function clearLocalCatalog(sourceId: string): Promise<void> { return invoke('local_catalog_clear', { sourceId }); }
/** Choose the executable natively; the frontend never sends a path. */
export function bindLocalCatalogEntry(key: LocalEntryKey): Promise<LocalBinding | null> { return invoke('local_catalog_bind', { key }); }
export function unbindLocalCatalogEntry(key: LocalEntryKey): Promise<void> { return invoke('local_catalog_unbind', { key }); }
/** Spawn is a request, not proof the app is running. */
export function openLocalCatalogEntry(key: LocalEntryKey): Promise<void> { return invoke('local_catalog_open', { key }); }
