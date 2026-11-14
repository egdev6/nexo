import { t } from '../i18n';
import type { Language } from '../model';
import type { RegistrySnapshot } from './registry';

export function noticeText(locale: Language, notice: NonNullable<RegistrySnapshot['notice']>): string {
  const detail = notice.detail;
  if (!detail) return notice.message;
  if (detail.kind === 'connectionClosed') return t(locale, 'native.connectionClosed');
  if (detail.kind === 'trayFailure') return t(locale, 'native.trayFailure');
  const failures = detail.failures.map(({ app, outcome }) => {
    const reason = outcome.kind === 'refused' ? outcome.reason ?? t(locale, 'native.refused') :
      t(locale, outcome.kind === 'timeout' ? 'native.timeout' : outcome.kind === 'unavailable' ? 'native.unavailable' : 'native.disconnected');
    return `${app}: ${reason}`;
  }).join('; ');
  return detail.all ? t(locale, 'native.staysOpen', { details: failures }) : failures;
}
