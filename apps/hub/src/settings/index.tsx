import { Button, Field, Icon, IconButton, RadioGroup, Slider, Switch, Tabs } from '@egdev/ui';
import type { CSSProperties } from 'react';
import { useId } from 'react';
import type { HubSettings, Language, SettingsViewProps } from '../model';
import { ACCENT_PRESETS, DEFAULT_ACCENT, derivePalette, normalizeHex } from './palette';
import './settings.css';

const languages = [{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }];
const colorNames = ['rojo', 'naranja', 'amarillo', 'verde', 'cian', 'azul', 'morado', 'rosa'];

export function SettingsView({ settings, onChange, onClose, sources: configuredSources, autostart }: SettingsViewProps) {
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
      <h2 id={`${id}-general`}>General</h2>
      <div className="settings__row settings__language">
        <div><strong>Idioma</strong><span>También se elige en el primer uso</span></div>
        <RadioGroup label="Idioma" orientation="horizontal" options={languages} value={settings.language}
          onValueChange={value => update('language', value as Language)} />
      </div>
      <div className="settings__row">
        <label htmlFor={`${id}-startup`}><strong>Iniciar con Windows</strong><span id={`${id}-startup-hint`}>{autostart?.confirmed === null ? 'Estado del sistema desconocido' : 'Se comprueba con el sistema'}</span></label>
        <Switch id={`${id}-startup`} aria-label="Iniciar con Windows" aria-describedby={`${id}-startup-hint`} disabled={autostart ? autostart.busy || autostart.confirmed === null : false} checked={autostart ? autostart.confirmed ?? false : settings.startWithWindows} onCheckedChange={value => autostart ? autostart.change(value) : update('startWithWindows', value)} />
      </div>
      {autostart?.error && <div className="settings__foot" role="alert">{autostart.error} <Button variant="neutral" size="sm" type="button" onClick={autostart.retry}>Reintentar inicio automático</Button></div>}
      <div className="settings__row">
        <label htmlFor={`${id}-news`}><strong>Mostrar novedades al abrir</strong><span id={`${id}-news-hint`}>Puedes volver a verlas en Mis apps</span></label>
        <Switch id={`${id}-news`} aria-label="Mostrar novedades al abrir" aria-describedby={`${id}-news-hint`} checked={settings.showNewsOnOpen} onCheckedChange={value => update('showNewsOnOpen', value)} />
      </div>
    </section>
    <p className="settings__foot">Las preferencias se guardan localmente en este equipo.</p>
  </>;

  const appearance = <>
    <section className="settings__group settings__appearance" aria-labelledby={`${id}-appearance`}>
      <h2 id={`${id}-appearance`}>Apariencia</h2>
      <fieldset className="settings__colors">
        <legend>Color de acento</legend>
        <div className="settings__swatches" role="group" aria-label="Colores de acento">
          {ACCENT_PRESETS.map((color, index) => <button className="settings__swatch" type="button" key={color}
            style={{ backgroundColor: color }} aria-label={`Usar ${colorNames[index]} ${color}`} aria-pressed={selected === color}
            onClick={() => update('accent', color)} />)}
          <label className="settings__swatch settings__custom" title="Elegir cualquier color">
            <input type="color" aria-label="Elegir cualquier color de acento" value={selected}
              onChange={event => update('accent', event.currentTarget.value)} />
            <span aria-hidden="true">+</span>
          </label>
        </div>
        <div className="settings__tones" role="group" aria-label="Tonos derivados">
          {tones.map((tone, index) => <span key={index}><i aria-hidden="true" style={{ backgroundColor: tone }} /><code>{tone}</code></span>)}
        </div>
        <Button className="settings__reset" variant="neutral" size="sm" type="button" onClick={() => update('accent', DEFAULT_ACCENT)}>Restablecer rojo egdev</Button>
      </fieldset>
      <Field className="settings__range" label="Opacidad del fondo" readout={`${settings.opacity} %`}>
        <Slider label="Opacidad del fondo" min={0} max={100} step={1} value={settings.opacity}
          valueText={value => `${value} %`} onValueChange={value => update('opacity', value)} />
      </Field>
      <Field className="settings__range" label="Desenfoque del fondo" readout={`${settings.blur} px`}>
        <Slider label="Desenfoque del fondo" min={0} max={40} step={1} value={settings.blur}
          valueText={value => `${value} px`} onValueChange={value => update('blur', value)} />
      </Field>
      <div className="settings__preview" role="img" aria-label="Vista previa de apariencia" style={previewStyle}>
        <div className="settings__preview-panel" aria-hidden="true"><strong>Vista previa</strong><span>Panel de Nexo</span></div>
      </div>
      <p className="settings__hint">El desenfoque afecta a las capas CSS del panel, no controla el desenfoque del escritorio. Sin Mica o acrílico, el escritorio puede verse transparente y nítido. La transparencia reducida del sistema tiene prioridad.</p>
      <div className="settings__row">
        <label htmlFor={`${id}-compact`}><strong>Interfaz compacta</strong><span id={`${id}-compact-hint`}>Reduce el espacio entre secciones</span></label>
        <Switch id={`${id}-compact`} aria-label="Interfaz compacta" aria-describedby={`${id}-compact-hint`} checked={settings.compact} onCheckedChange={value => update('compact', value)} />
      </div>
    </section>
    <p className="settings__foot">La apariencia se aplica al panel y se guarda en este equipo.</p>
  </>;

  const sources = <>
    <section className="settings__group" aria-labelledby={`${id}-sources`}>
      <h2 id={`${id}-sources`}>Fuentes del catálogo</h2>
      {(configuredSources ?? [{ id: 'official', label: 'Catálogo oficial egdev', kind: 'official' as const }]).map(source => <div className="settings__row" key={source.id}><div><strong>{source.label}</strong><span>{source.kind === 'official' ? 'Fuente oficial' : 'Fuente local configurada'}</span></div></div>)}
      <Button variant="neutral" size="sm" type="button" disabled>Añadir fuente local</Button>
    </section>
    <p className="settings__foot">Añadir y utilizar fuentes locales aún no está disponible.</p>
  </>;

  const about = <>
    <section className="settings__group" aria-labelledby={`${id}-about`}>
      <h2 id={`${id}-about`}>Acerca de</h2>
      <div className="settings__row"><div><strong>Nexo</strong><span className="settings__version">Versión 0.1.0</span></div>
        <Button variant="neutral" size="sm" type="button" disabled>Buscar actualizaciones</Button></div>
    </section>
    <p className="settings__foot">Muestra de diseño · búsqueda de actualizaciones aún no disponible.</p>
  </>;

  return <section className="settings" aria-label="Ajustes">
    <header className="settings__header">
      <IconButton label="Volver" title="Volver" icon={<Icon name="arrow-right" className="settings__back-icon" />} variant="secondary" onClick={onClose} />
      <div><h1>Ajustes</h1><p>Nexo · Preferencias del hub</p></div>
      <IconButton label="Cerrar ajustes" title="Cerrar ajustes" icon={<Icon name="close" />} variant="secondary" onClick={onClose} />
    </header>
    <Tabs className="settings__tabs" variant="segmented" label="Secciones de ajustes" items={[
      { value: 'general', label: 'General', content: general },
      { value: 'appearance', label: 'Apariencia', content: appearance },
      { value: 'sources', label: 'Fuentes del catálogo', content: sources },
      { value: 'about', label: 'Acerca de', content: about },
    ]} />
  </section>;
}
