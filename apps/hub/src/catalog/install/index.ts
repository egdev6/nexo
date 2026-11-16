import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type InstallPhase = 'fetching' | 'awaitingApproval' | 'downloading' | 'verifying' | 'closing' | 'installing' | 'detecting';
export interface InstallProgress { id: string; phase: InstallPhase; received?: number; total?: number; cleanupFailed?: true }
export type InstallError =
  | { status: 'alreadyInstalled' | 'busy' | 'cancelled' | 'feedFailed' | 'notAvailable' | 'detectionUnknown' | 'releaseChanged' | 'downloadFailed' | 'urlNotAllowed' | 'hostNotAllowed' | 'redirectLimit' | 'networkFailed' | 'connectTimedOut' | 'downloadTimedOut' | 'tooLarge' | 'lengthMismatch' | 'storageFailed' | 'keyMissing' | 'keyInvalid' | 'signatureMalformed' | 'signatureUnsupported' | 'signatureInvalid' | 'assetNotAllowed' | 'cleanupFailed' | 'spawnFailed' | 'monitorFailed' | 'timeout' | 'notDetected' }
  | { status: 'installerFailed'; code: number };
export type InstallResult = { status: 'installed'; version: string | null } | { status: 'installedUnverified' } | InstallError;
export type UpdateResult = { status: 'updated'; version: string } | { status: 'upToDate'; version: string } | { status: 'versionMismatch'; version: string } | { status: 'appStillRunning' } | InstallError;
export type CancelResult = 'cancelled' | 'tooLate' | 'notRunning' | 'cleanupFailed';

export function installApp(id: string): Promise<InstallResult> { return invoke<InstallResult>('install_app', { id }); }
export function updateApp(id: string): Promise<UpdateResult> { return invoke<UpdateResult>('update_app', { id }); }
export function cancelInstall(id: string): Promise<CancelResult> { return invoke<CancelResult>('cancel_install', { id }); }
export function onInstallProgress(cb: (progress: InstallProgress) => void): Promise<UnlistenFn> {
  return listen<InstallProgress>('install-progress', event => cb(event.payload));
}
