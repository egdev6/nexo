import { Button, Field, Icon, IconButton, RadioGroup, Slider, Switch, Tabs } from '@egdev/ui';
import type { CSSProperties } from 'react';
import { useId } from 'react';
import type { HubSettings, Language, SettingsViewProps } from '../model';
import { formatNumber, t, type MessageKey, type Params } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import { ACCENT_PRESETS, DEFAULT_ACCENT, derivePalette, normalizeHex } from './palette';
import { LocalManagement } from './local-management';
import './settings.css';

const languages = [{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }];
const colorNames: MessageKey[] = ['settings.colorRed', 'settings.colorOrange', 'settings.colorYellow', 'settings.colorGreen', 'settings.colorCyan', 'settings.colorBlue', 'settings.colorPurple', 'settings.colorPink'];

export function SettingsView({ settings, onChange, onClose, sources: configuredSources, autostart, languagePending }: SettingsViewProps) {
  const locale = useLocale();
  const tr = (key: MessageKey, params?: Params) => t(locale, key, params);
  const id = useId();
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
      <h2 id={`${id}-general`}>{tr('settings.general')}</h2>
      <div className="settings__row settings__language">
        <div><strong>{tr('settings.language')}</strong><span>{tr('settings.languageHint')}</span>{languagePending && <span role="status">{tr('settings.languageSaving')}</span>}</div>
        <RadioGroup label={tr('settings.language')} orientation="horizontal" options={languages} value={settings.language}
          onValueChange={value => update('language', value as Language)} />
      </div>
      <div className="settings__row">
        <label htmlFor={`${id}-startup`}><strong>{tr('settings.startup')}</strong><span id={`${id}-startup-hint`}>{tr(autostart?.confirmed === null ? 'settings.startupUnknown' : 'settings.startupHint')}</span></label>
        <Switch id={`${id}-startup`} aria-label={tr('settings.startup')} aria-describedby={`${id}-startup-hint`} disabled={autostart ? autostart.busy || autostart.confirmed === null : false} checked={autostart ? autostart.confirmed ?? false : settings.startWithWindows} onCheckedChange={value => autostart ? autostart.change(value) : update('startWithWindows', value)} />
      </div>
      {autostart?.error && <div className="settings__foot" role="alert">{autostart.error} <Button variant="neutral" size="sm" type="button" onClick={autostart.retry}>{tr('settings.retryStartup')}</Button></div>}
      <div className="settings__row">
        <label htmlFor={`${id}-news`}><strong>{tr('settings.news')}</strong><span id={`${id}-news-hint`}>{tr('settings.newsHint')}</span></label>
        <Switch id={`${id}-news`} aria-label={tr('settings.news')} aria-describedby={`${id}-news-hint`} checked={settings.showNewsOnOpen} onCheckedChange={value => update('showNewsOnOpen', value)} />
      </div>
    </section>
    <p className="settings__foot">{tr('settings.localFoot')}</p>
  </>;

  const appearance = <>
    <section className="settings__group settings__appearance" aria-labelledby={`${id}-appearance`}>
      <h2 id={`${id}-appearance`}>{tr('settings.appearance')}</h2>
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
    </section>
    <p className="settings__foot">{tr('settings.appearanceFoot')}</p>
  </>;

  const sources = <LocalManagement initialSources={configuredSources} />;

  const about = <>
    <section className="settings__group" aria-labelledby={`${id}-about`}>
      <h2 id={`${id}-about`}>{tr('settings.about')}</h2>
      <div className="settings__row"><div><strong>Nexo</strong><span className="settings__version">{tr('settings.version', { version: '0.1.0' })}</span></div>
        <Button variant="neutral" size="sm" type="button" disabled>{tr('settings.updates')}</Button></div>
      <p className="settings__hint">{tr('settings.fontCredit')}</p>
    </section>
    <p className="settings__foot">{tr('settings.aboutFoot')}</p>
  </>;

  return <section className="settings" aria-label={tr('common.settings')}>
    <header className="settings__header">
      <IconButton label={tr('common.back')} title={tr('common.back')} icon={<Icon name="arrow-right" className="settings__back-icon" />} variant="secondary" onClick={onClose} />
      <div><h1>{tr('common.settings')}</h1><p>{tr('settings.subtitle')}</p></div>
      <IconButton label={tr('settings.close')} title={tr('settings.close')} icon={<Icon name="close" />} variant="secondary" onClick={onClose} />
    </header>
    <Tabs className="settings__tabs" variant="segmented" label={tr('settings.sections')} items={[
      { value: 'general', label: tr('settings.general'), content: general },
      { value: 'appearance', label: tr('settings.appearance'), content: appearance },
      { value: 'sources', label: tr('settings.sources'), content: sources },
      { value: 'about', label: tr('settings.about'), content: about },
    ]} />
  </section>;
}
