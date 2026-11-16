import { Button, Field, Icon, IconButton, Notice, Panel, PanelBody, PanelHeader, RadioGroup, Slider, SocialLinks, Switch, Tabs } from '@egdev/ui';
import type { CSSProperties } from 'react';
import { useId } from 'react';
import type { HubSettings, Language, SettingsViewProps } from '../model';
import { formatNumber, t, type MessageKey, type Params } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import { ACCENT_PRESETS, DEFAULT_ACCENT, derivePalette, normalizeHex } from './palette';
import { useExternalLinks } from '../apps/details';
import { LocalManagement } from './local-management';
import './settings.css';

// TODO(egdev-design-system#TBD-panel-compact-heading): Preserve the General heading until the DS offers this size.
// TODO(egdev-design-system#TBD-panel-compact-heading): Preserve the Appearance heading until the DS offers this size.
// TODO(egdev-design-system#TBD-panel-compact-heading): Preserve the About heading until the DS offers this size.
// TODO(egdev-design-system#TBD-panel-compact-heading): Preserve the Author heading until the DS offers this size.
// TODO(egdev-design-system#TBD-panel-accent): Preserve the appearance accent until Panel supports an accent border.
const languages = [{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }];
const colorNames: MessageKey[] = ['settings.colorRed', 'settings.colorOrange', 'settings.colorYellow', 'settings.colorGreen', 'settings.colorCyan', 'settings.colorBlue', 'settings.colorPurple', 'settings.colorPink'];

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
        <PanelHeader><h2 id={`${id}-general`}>{tr('settings.general')}</h2></PanelHeader>
        <PanelBody><div className="settings__rows">
      <div className="settings__row settings__language">
        <div><strong>{tr('settings.language')}</strong><span>{tr('settings.languageHint')}</span>{languagePending && <span role="status">{tr('settings.languageSaving')}</span>}</div>
        <RadioGroup label={tr('settings.language')} orientation="horizontal" options={languages} value={settings.language}
          onValueChange={value => update('language', value as Language)} />
      </div>
      <div className="settings__row">
        <label htmlFor={`${id}-startup`}><strong>{tr('settings.startup')}</strong><span id={`${id}-startup-hint`}>{tr(autostart?.confirmed === null ? 'settings.startupUnknown' : 'settings.startupHint')}</span></label>
        <Switch id={`${id}-startup`} aria-label={tr('settings.startup')} aria-describedby={`${id}-startup-hint`} disabled={autostart ? autostart.busy || autostart.confirmed === null : false} checked={autostart ? autostart.confirmed ?? false : settings.startWithWindows} onCheckedChange={value => autostart ? autostart.change(value) : update('startWithWindows', value)} />
      </div>
      {autostart?.error && <Notice tone="danger" summary={`${autostart.error} `} actions={<Button variant="neutral" size="sm" type="button" onClick={autostart.retry}>{tr('settings.retryStartup')}</Button>} />}
      <div className="settings__row">
        <label htmlFor={`${id}-news`}><strong>{tr('settings.news')}</strong><span id={`${id}-news-hint`}>{tr('settings.newsHint')}</span></label>
        <Switch id={`${id}-news`} aria-label={tr('settings.news')} aria-describedby={`${id}-news-hint`} checked={settings.showNewsOnOpen} onCheckedChange={value => update('showNewsOnOpen', value)} />
      </div>
        </div></PanelBody>
      </Panel>
    </section>
    <p className="settings__foot">{tr('settings.localFoot')}</p>
  </>;

  const appearance = <>
    <section className="settings__group settings__appearance" aria-labelledby={`${id}-appearance`}>
      <Panel variant="banded">
        <PanelHeader><h2 id={`${id}-appearance`}>{tr('settings.appearance')}</h2></PanelHeader>
        <PanelBody><div>
      <fieldset className="settings__colors">
        <legend>{tr('settings.accent')}</legend>
        <div className="settings__swatches" role="group" aria-label={tr('settings.accents')}>
          {ACCENT_PRESETS.map((color, index) => <button className="settings__swatch" type="button" key={color}
            style={{ backgroundColor: color }} aria-label={tr('settings.useColor', { name: tr(colorNames[index]), color })} aria-pressed={selected === color}
            onClick={() => update('accent', color)} />)}
          <label className="settings__swatch settings__custom" title={tr('settings.chooseColor')}>
            <input type="color" aria-label={tr('settings.chooseAccent')} value={selected}
              onChange={event => update('accent', event.currentTarget.value)} />
            <span aria-hidden="true">+</span>
          </label>
        </div>
        <div className="settings__tones" role="group" aria-label={tr('settings.tones')}>
          {tones.map((tone, index) => <span key={index}><i aria-hidden="true" style={{ backgroundColor: tone }} /><code>{tone}</code></span>)}
        </div>
        <Button className="settings__reset" variant="neutral" size="sm" type="button" onClick={() => update('accent', DEFAULT_ACCENT)}>{tr('settings.reset')}</Button>
      </fieldset>
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
      <div className="settings__row">
        <label htmlFor={`${id}-compact`}><strong>{tr('settings.compact')}</strong><span id={`${id}-compact-hint`}>{tr('settings.compactHint')}</span></label>
        <Switch id={`${id}-compact`} aria-label={tr('settings.compact')} aria-describedby={`${id}-compact-hint`} checked={settings.compact} onCheckedChange={value => update('compact', value)} />
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
        <PanelHeader><h2 id={`${id}-about`}>{tr('settings.about')}</h2></PanelHeader>
        <PanelBody><div className="settings__rows">
      <div className="settings__row"><div><strong>Nexo</strong><span className="settings__version">{tr('settings.version', { version: '0.1.0' })}</span></div>
        <Button variant="neutral" size="sm" type="button" disabled>{tr('settings.updates')}</Button></div>
      <p className="settings__hint">{tr('settings.fontCredit')}</p>
        </div></PanelBody>
      </Panel>
    </section>
    <section className="settings__group" aria-labelledby={`${id}-author`}>
      <Panel variant="banded">
        <PanelHeader><h2 id={`${id}-author`}>{tr('settings.author')}</h2></PanelHeader>
        <PanelBody><div>
      <p className="settings__author-name">{tr('settings.authorName')}</p>
      <SocialLinks label={tr('settings.authorLinks')} caption={null} variant="ghost" size="md" onClick={open} items={[
        { id: 'youtube', href: 'https://www.youtube.com/@egdev6', label: tr('app.youtube'), icon: <Icon name="youtube" /> },
        { id: 'twitch', href: 'https://twitch.tv/egdev6', label: tr('settings.twitch'), icon: <Icon name="twitch" /> },
        { id: 'x', href: 'https://x.com/egdev66', label: tr('settings.x'), icon: <Icon name="x" /> },
        { id: 'linkedin', href: 'https://www.linkedin.com/in/egdev6/', label: tr('settings.linkedin'), icon: <Icon name="linkedin" /> },
        { id: 'instagram', href: 'https://www.instagram.com/egdev6/', label: tr('settings.instagram'), icon: <Icon name="instagram" /> },
        { id: 'github', href: 'https://github.com/egdev6', label: tr('app.github'), icon: <Icon name="github" /> },
      ]} />
      {failed && <Notice tone="danger" size="sm" summary={tr('app.externalError')} />}
        </div></PanelBody>
      </Panel>
    </section>
    <p className="settings__foot">{tr('settings.aboutFoot')}</p>
  </>;

  return <section className="settings" aria-label={tr('common.settings')}>
    <header className="settings__header">
      <IconButton label={tr('common.back')} title={tr('common.back')} icon={<Icon name="arrow-right" className="settings__back-icon" />} variant="secondary" onClick={onClose} />
      <div><h1>{tr('common.settings')}</h1><p>{tr('settings.subtitle')}</p></div>
    </header>
    <Tabs className="settings__tabs" variant="segmented" label={tr('settings.sections')} items={[
      { value: 'general', label: tr('settings.general'), content: general },
      { value: 'appearance', label: tr('settings.appearance'), content: appearance },
      { value: 'local-apps', label: tr('localApps.heading'), content: localApps },
      { value: 'about', label: tr('settings.about'), content: about },
    ]} />
  </section>;
}
