import { Button, ColorSwatchGroup, Field, Heading, Icon, IconButton, Notice, PageHeader, Panel, PanelBody, PanelHeader, RadioGroup, Slider, SocialLinks, Switch, Tabs } from '@egdev/ui';
import type { CSSProperties, MouseEvent } from 'react';
import { useId } from 'react';
import type { HubSettings, Language, SettingsViewProps } from '../model';
import { formatNumber, t, type MessageKey, type Params } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import { ACCENT_PRESETS, DEFAULT_ACCENT, derivePalette, normalizeHex } from './palette';
import { useExternalLinks } from '../apps/details';
import { LocalManagement } from './local-management';
import './settings.css';

const languages = [{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }];
const colorNames: MessageKey[] = ['settings.colorRed', 'settings.colorOrange', 'settings.colorYellow', 'settings.colorGreen', 'settings.colorCyan', 'settings.colorBlue', 'settings.colorPurple', 'settings.colorPink'];

// The previous label included the hint, so clicking that text also activated the switch.
function activateSwitchFromHint(event: MouseEvent<HTMLDivElement>) {
  const control = event.currentTarget.querySelector<HTMLButtonElement>('[role="switch"]');
  const target = event.target;
  if (!control || !(target instanceof Node)) return;
  const descriptions = control.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
  if (descriptions.some(id => control.ownerDocument.getElementById(id)?.contains(target))) control.click();
}

export function SettingsView({ settings, onChange, onClose, autostart, languagePending }: SettingsViewProps) {
  const locale = useLocale();
  const tr = (key: MessageKey, params?: Params) => t(locale, key, params);
  const id = useId();
  const { open, failed } = useExternalLinks();
  const selected = normalizeHex(settings.accent);
  const tones = derivePalette(selected);
  const update = <K extends keyof HubSettings>(key: K, value: HubSettings[K]) => onChange({ ...settings, [key]: value });
  const previewStyle = {
    '--settings-preview-opacity': `${settings.opacity}%`,
    '--settings-preview-blur': `${settings.blur}px`,
    '--settings-preview-accent': tones[0],
  } as CSSProperties;

  const general = <>
    <section className="settings__group" aria-labelledby={`${id}-general`}>
      <Panel variant="banded">
        <PanelHeader><Heading level={2} variant="compact" foreground="default" id={`${id}-general`}>{tr('settings.general')}</Heading></PanelHeader>
        <PanelBody><div className="settings__rows">
      <div className="settings__row settings__language">
        <div><strong>{tr('settings.language')}</strong><span>{tr('settings.languageHint')}</span>{languagePending && <span role="status">{tr('settings.languageSaving')}</span>}</div>
        <RadioGroup label={tr('settings.language')} orientation="horizontal" options={languages} value={settings.language}
          onValueChange={value => update('language', value as Language)} />
      </div>
      <div className="settings__choice" onClick={activateSwitchFromHint}>
        <Field layout="choice-trailing" label={tr('settings.startup')} hint={tr(autostart?.confirmed === null ? 'settings.startupUnknown' : 'settings.startupHint')}>
          <Switch id={`${id}-startup`} disabled={autostart ? autostart.busy || autostart.confirmed === null : false} checked={autostart ? autostart.confirmed ?? false : settings.startWithWindows} onCheckedChange={value => autostart ? autostart.change(value) : update('startWithWindows', value)} />
        </Field>
      </div>
      {autostart?.error && <Notice tone="danger" summary={`${autostart.error} `} actions={<Button variant="neutral" size="sm" type="button" onClick={autostart.retry}>{tr('settings.retryStartup')}</Button>} />}
      <div className="settings__choice" onClick={activateSwitchFromHint}>
        <Field layout="choice-trailing" label={tr('settings.news')} hint={tr('settings.newsHint')}>
          <Switch id={`${id}-news`} checked={settings.showNewsOnOpen} onCheckedChange={value => update('showNewsOnOpen', value)} />
        </Field>
      </div>
      <div className="settings__choice" onClick={activateSwitchFromHint}>
        <Field layout="choice-trailing" label={tr('settings.hideLocalApps')} hint={tr('settings.hideLocalAppsHint')}>
          <Switch id={`${id}-hide-local`} checked={settings.hideLocalApps} onCheckedChange={value => update('hideLocalApps', value)} />
        </Field>
      </div>
        </div></PanelBody>
      </Panel>
    </section>
    <p className="settings__foot">{tr('settings.localFoot')}</p>
  </>;

  const appearance = <>
    <section className="settings__group" aria-labelledby={`${id}-appearance`}>
      <Panel variant="banded" accentEdge="start">
        <PanelHeader><Heading level={2} variant="compact" foreground="default" id={`${id}-appearance`}>{tr('settings.appearance')}</Heading></PanelHeader>
        <PanelBody><div className="settings__options">
      <ColorSwatchGroup label={tr('settings.accent')}
        options={ACCENT_PRESETS.map((value, index) => ({ value, label: tr(colorNames[index]) }))}
        value={selected} onValueChange={color => update('accent', color)} customLabel={tr('settings.chooseAccent')} />
      <div className="settings__tones" role="group" aria-label={tr('settings.tones')}>
        {tones.map((tone, index) => <span key={index}><i aria-hidden="true" style={{ backgroundColor: tone }} /><code>{tone}</code></span>)}
      </div>
      <Button className="settings__reset" variant="neutral" size="sm" type="button" onClick={() => update('accent', DEFAULT_ACCENT)}>{tr('settings.reset')}</Button>
      <Field className="settings__range" label={tr('settings.opacity')} readout={`${formatNumber(locale, settings.opacity)} %`}>
        <Slider label={tr('settings.opacity')} min={0} max={100} step={1} value={settings.opacity}
          valueText={value => `${formatNumber(locale, value)} %`} onValueChange={value => update('opacity', value)} />
      </Field>
      <Field className="settings__range" label={tr('settings.blur')} readout={`${formatNumber(locale, settings.blur)} px`}>
        <Slider label={tr('settings.blur')} min={0} max={40} step={1} value={settings.blur}
          valueText={value => `${formatNumber(locale, value)} px`} onValueChange={value => update('blur', value)} />
      </Field>
      <div className="settings__preview" role="img" aria-label={tr('settings.previewAria')} style={previewStyle}>
        <div className="settings__preview-panel" aria-hidden="true"><strong>{tr('settings.preview')}</strong><span>{tr('settings.panel')}</span></div>
      </div>
      <p className="settings__hint">{tr('settings.blurHint')}</p>
      <div className="settings__choice" onClick={activateSwitchFromHint}>
        <Field layout="choice-trailing" label={tr('settings.compact')} hint={tr('settings.compactHint')}>
          <Switch id={`${id}-compact`} checked={settings.compact} onCheckedChange={value => update('compact', value)} />
        </Field>
      </div>
        </div></PanelBody>
      </Panel>
    </section>
    <p className="settings__foot">{tr('settings.appearanceFoot')}</p>
  </>;

  const localApps = <LocalManagement accent={selected} />;

  const about = <>
    <section className="settings__group" aria-labelledby={`${id}-about`}>
      <Panel variant="banded">
        <PanelHeader><Heading level={2} variant="compact" foreground="default" id={`${id}-about`}>{tr('settings.about')}</Heading></PanelHeader>
        <PanelBody><div className="settings__rows">
      <div className="settings__row"><div><strong>Nexo</strong><span className="settings__version">{tr('settings.version', { version: '0.1.0' })}</span></div>
        <Button variant="neutral" size="sm" type="button" disabled>{tr('settings.updates')}</Button></div>
      <p className="settings__hint">{tr('settings.fontCredit')}</p>
        </div></PanelBody>
      </Panel>
    </section>
    <section className="settings__group" aria-labelledby={`${id}-author`}>
      <Panel variant="banded">
        <PanelHeader><Heading level={2} variant="compact" foreground="default" id={`${id}-author`}>{tr('settings.author')}</Heading></PanelHeader>
        <PanelBody><div>
      <p className="settings__author-name">{tr('settings.authorName')}</p>
      <SocialLinks label={tr('settings.authorLinks')} caption={null} inline gap={2} variant="outline" size="md" onClick={open} items={[
        { id: 'youtube', href: 'https://www.youtube.com/@egdev6', label: tr('app.youtube'), icon: <Icon name="youtube" color="var(--color-fg-brand-default)" /> },
        { id: 'twitch', href: 'https://twitch.tv/egdev6', label: tr('settings.twitch'), icon: <Icon name="twitch" color="var(--color-fg-brand-default)" /> },
        { id: 'x', href: 'https://x.com/egdev66', label: tr('settings.x'), icon: <Icon name="x" color="var(--color-fg-brand-default)" /> },
        { id: 'linkedin', href: 'https://www.linkedin.com/in/egdev6/', label: tr('settings.linkedin'), icon: <Icon name="linkedin" color="var(--color-fg-brand-default)" /> },
        { id: 'instagram', href: 'https://www.instagram.com/egdev6/', label: tr('settings.instagram'), icon: <Icon name="instagram" color="var(--color-fg-brand-default)" /> },
        { id: 'github', href: 'https://github.com/egdev6', label: tr('app.github'), icon: <Icon name="github" color="var(--color-fg-brand-default)" /> },
      ]} />
      {failed && <Notice tone="danger" size="sm" summary={tr('app.externalError')} />}
        </div></PanelBody>
      </Panel>
    </section>
    <p className="settings__foot">{tr('settings.aboutFoot')}</p>
  </>;

  return <section className="settings" aria-label={tr('common.settings')}>
    <div className="settings__header">
      <PageHeader title={tr('common.settings')} lede={tr('settings.subtitle')} leadingAction={
        <IconButton label={tr('common.back')} title={tr('common.back')} icon={<Icon name="arrow-right" className="settings__back-icon" />} variant="secondary" onClick={onClose} />
      } />
    </div>
    <Tabs className="settings__tabs" variant="outline" fullWidth label={tr('settings.sections')} items={[
      { value: 'general', label: tr('settings.general'), content: general },
      { value: 'appearance', label: tr('settings.appearance'), content: appearance },
      { value: 'local-apps', label: tr('localApps.heading'), content: localApps },
      { value: 'about', label: tr('settings.about'), content: about },
    ]} />
  </section>;
}
