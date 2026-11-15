import { useState, type MouseEvent } from 'react';
import { Badge, Icon, SocialLinks, type SocialLinkItem } from '@egdev/ui';
import { t } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import type { HubApp } from '../model';
import { openExternal } from './external';

function releaseUrl(github: string | undefined, version: string): string | undefined {
  const match = github?.match(/^https:\/\/github\.com\/egdev6\/([A-Za-z0-9._-]+)$/);
  return match && match[1] !== '.' && match[1] !== '..' ? `https://github.com/egdev6/${match[1]}/releases/tag/v${encodeURIComponent(version)}` : undefined;
}

/** Open only through the native policy, never via WebView navigation. */
export function AppDetails({ app, version, newVersion }: { app?: HubApp; version?: string; newVersion?: string }) {
  const locale = useLocale();
  const [failed, setFailed] = useState(false);
  function open(event: MouseEvent<HTMLElement>) {
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    event.preventDefault();
    setFailed(false);
    void openExternal(anchor.href).catch(() => setFailed(true));
  }
  const versionLink = (value: string) => {
    const href = releaseUrl(app?.links?.github, value);
    return href ? <a className="version-link" href={href} onClick={open}>{value}</a> : <span>{value}</span>;
  };
  const items: SocialLinkItem[] = [];
  if (app?.links?.github) items.push({ id: 'github', href: app.links.github, label: t(locale, 'app.github'), icon: <Icon name="github" /> });
  if (app?.links?.youtube) items.push({ id: 'youtube', href: app.links.youtube, label: t(locale, 'app.youtube'), icon: <Icon name="youtube" /> });
  return <>
    <p className="meta">{t(locale, 'app.installedVersionLabel')} {version ? versionLink(version) : t(locale, 'appControl.versionUnavailable')}</p>
    {newVersion && <p className="meta update-version"><Badge tone="brand">{t(locale, 'app.newVersion')}</Badge> {versionLink(newVersion)}</p>}
    {items.length > 0 && <SocialLinks items={items} label={t(locale, 'app.socialLinks')} caption={null} variant="ghost" size="md" onClick={open} />}
    {failed && <p role="alert" className="status-warning">{t(locale, 'app.externalError')}</p>}
  </>;
}
