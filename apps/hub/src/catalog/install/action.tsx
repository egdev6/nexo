import { useId } from 'react';
import { Button, ProgressBar } from '@egdev/ui';
import type { HubApp } from '../../model';
import { formatNumber, t, type MessageKey, type Params } from '../../i18n';
import { useLocale } from '../../i18n/use-locale';
import { compareSemver } from '../format';
import type { CatalogInstalls } from './use-installs';

/** Shared presentation for the native install and update transaction. */
export function InstallAction({ app, reason, installs, focused = false, mode = 'install', version, unverifiable = false }: { app: HubApp; reason?: MessageKey; installs?: CatalogInstalls; focused?: boolean; mode?: 'install' | 'update'; version?: string; unverifiable?: boolean }) {
  const locale = useLocale();
  const id = useId();
  const current = installs?.entries.get(app.id);
  const entry = current?.operation === mode ? current : undefined;
  if (entry?.status === 'running') {
    const { progress, cancelling, cancelError } = entry;
    const afterSpawn = progress.phase === 'installing' || progress.phase === 'detecting';
    const percent = progress.phase === 'downloading' && progress.total !== undefined && progress.total > 0 && progress.received !== undefined
      ? Math.max(0, Math.min(100, Math.round(progress.received / progress.total * 100))) : undefined;
    return <div className="catalog-install">
      <div role="status" className="catalog-install-status">{t(locale, `install.phase.${progress.phase}`)}
        {afterSpawn && <span>{t(locale, 'install.cancelUnavailable')}</span>}</div>
      {progress.phase === 'downloading' && <div className="catalog-progress"><ProgressBar size="lg" value={percent ?? NaN} label={t(locale, 'install.downloadFor', { name: app.name })} />
        {percent !== undefined && <span>{t(locale, 'install.percent', { percent: formatNumber(locale, percent) })}</span>}</div>}
      {cancelError && <div role="alert" className="catalog-install-error">{t(locale, `install.error.${cancelError}`)}</div>}
      {entry.cleanupFailed && cancelError !== 'cleanupFailed' && <div role="alert" className="catalog-install-error">{t(locale, 'install.error.cleanupFailed')}</div>}
      {!afterSpawn && <Button type="button" size="sm" variant="neutral" disabled={cancelling} aria-label={t(locale, 'install.cancelFor', { name: app.name })} onClick={() => installs?.cancel(app.id)}>{t(locale, 'install.cancel')}</Button>}
    </div>;
  }
  const error = entry?.status === 'error' ? entry.error : undefined;
  const params: Params | undefined = error?.status === 'installerFailed' ? { code: error.code } : error?.status === 'versionMismatch' ? { version: error.version } : undefined;
  const message = error ? t(locale, `install.error.${error.status}`, params) : undefined;
  const result = entry?.status === 'updated' || entry?.status === 'upToDate' ? entry : undefined;
  const canOffer = mode === 'install' || (!!version && (!result || compareSemver(result.version, version) === -1));
  const retry = !!error && !unverifiable;
  if (mode === 'update' && !canOffer && !entry) return null;
  return <div className="catalog-install">
    {message && <div role="alert" className="catalog-install-error">{message}</div>}
    {result && <div role="status" className="catalog-install-status">{t(locale, `update.${result.status}`, { version: result.version })}</div>}
    {entry?.status === 'error' && entry.cleanupFailed && error?.status !== 'cleanupFailed' && <div role="alert" className="catalog-install-error">{t(locale, 'install.error.cleanupFailed')}</div>}
    {reason && canOffer && <div id={id} className="catalog-install-reason">{t(locale, reason)}</div>}
    {canOffer && (!focused || !reason) && <Button type="button" size="sm" variant="primary" disabled={!!reason || !installs} aria-describedby={reason ? id : undefined}
      aria-label={retry ? t(locale, 'install.retryFor', { name: app.name }) : mode === 'update' ? t(locale, 'update.actionFor', { name: app.name, version: version! }) : t(locale, 'install.installFor', { name: app.name })}
      onClick={() => mode === 'update' ? installs?.startUpdate(app.id) : installs?.start(app.id)}>{retry ? t(locale, 'common.retry') : mode === 'update' ? t(locale, 'update.action', { version: version! }) : t(locale, 'common.install')}</Button>}
    {installs?.connection === 'error' && (reason === 'install.progressUnavailable' || reason === 'update.progressUnavailable') && <Button type="button" size="sm" variant="neutral" onClick={installs.retryConnection}>{t(locale, 'common.retry')}</Button>}
  </div>;
}
