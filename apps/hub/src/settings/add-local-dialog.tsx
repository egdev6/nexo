import { Button, Dialog, DialogContent, DialogTrigger, Field, FieldMessage, Input, Label, Notice, Stack } from '@egdev/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import { cancelLocalSelection, createLocalApp, pickLocalExecutable, pickLocalIconFile, type ExecutablePick, type IconPick, type LocalAppSelection } from '../local-apps';
import { accentVariables, DEFAULT_ACCENT, normalizeHex } from './palette';

type Props = { accent: string; disabled: boolean; errorKey: (error: unknown) => MessageKey; onAdded: (result: LocalAppSelection) => Promise<void> };

export function AddLocalDialog({ accent, disabled, errorKey, onAdded }: Props) {
  const locale = useLocale();
  const executableId = useId();
  const executableMessageId = useId();
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [cleanupError, setCleanupError] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const busyRef = useRef(false);
  const revokingRef = useRef(false);
  const [executable, setExecutable] = useState<ExecutablePick | null>(null);
  const [icon, setIcon] = useState<IconPick | null>(null);
  const [name, setName] = useState('');
  const [exeError, setExeError] = useState<MessageKey | null>(null);
  const [iconError, setIconError] = useState<MessageKey | null>(null);
  const [saveError, setSaveError] = useState<MessageKey | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  // The body portal can mount after its parent effect. Attach when the dialog
  // itself mounts, before paint, and restore any existing values on unmount.
  const themeRef = useCallback((node: HTMLSpanElement | null) => {
    const dialog = node?.closest<HTMLElement>('.local-app-dialog');
    if (!dialog) return;
    const variables = Object.entries(accentVariables(accent));
    const previous = variables.map(([name]) => [name, dialog.style.getPropertyValue(name), dialog.style.getPropertyPriority(name)] as const);
    variables.forEach(([name, value]) => dialog.style.setProperty(name, String(value)));
    return () => previous.forEach(([name, value, priority]) => {
      if (value) dialog.style.setProperty(name, value, priority);
      else dialog.style.removeProperty(name);
    });
  }, [accent]);

  useEffect(() => () => {
    if (active.current) { active.current = false; void cancelLocalSelection().catch(() => {}); }
  }, []);

  function close() {
    if (!active.current) return;
    active.current = false;
    setOpen(false);
    setExecutable(null); setName(''); setIcon(null);
    setExeError(null); setIconError(null); setSaveError(null); setImageFailed(false);
    revokingRef.current = true; setRevoking(true);
    void cancelLocalSelection().then(() => { setCleanupError(false); }, () => { setCleanupError(true); }).finally(() => {
      revokingRef.current = false; setRevoking(false);
    });
  }
  function changeOpen(next: boolean) {
    if (!next) { if (!busyRef.current) close(); return; }
    if (revokingRef.current || cleanupError) return;
    active.current = true; setOpen(true);
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); } finally { busyRef.current = false; setBusy(false); }
  }
  async function chooseExecutable() {
    await run(async () => {
      try {
        const selected = await pickLocalExecutable();
        if (!active.current || !selected) return;
        setExecutable(selected); setName(selected.suggestedName); setExeError(null); setSaveError(null);
      } catch (error) {
        if (active.current) { setExecutable(null); setExeError(errorKey(error)); }
      }
    });
  }
  async function chooseIcon() {
    await run(async () => {
      try {
        const selected = await pickLocalIconFile();
        if (!active.current || !selected) return;
        setIcon(selected); setImageFailed(false); setIconError(null);
      } catch (error) { if (active.current) setIconError(errorKey(error)); }
    });
  }
  async function create() {
    if (!executable || !name.trim()) return;
    await run(async () => {
      try {
        const result = await createLocalApp(executable.token, name, icon?.token);
        busyRef.current = false; close();
        await onAdded(result);
      } catch (error) {
        if (active.current) {
          const key = errorKey(error);
          if (key === 'localApps.errorMissing' || key === 'localApps.errorNotExecutable' || key === 'localApps.errorRefused') setExeError(key);
          else setSaveError(key);
          // A create attempt may have consumed the native tokens; require re-selection.
          setExecutable(null); setIcon(null);
        }
      }
    });
  }
  const preview = icon && /^data:image\/(?:png|x-icon);base64,[A-Za-z0-9+/]+={0,2}$/.test(icon.preview) && !imageFailed ? icon.preview : null;
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button variant="neutral" size="sm" type="button" disabled={disabled}>{t(locale, 'settingsLocal.addApp')}</Button></DialogTrigger>
      <DialogContent className="local-app-dialog" bodyPadding="default" data-custom-accent={normalizeHex(accent) !== DEFAULT_ACCENT ? '' : undefined} title={t(locale, 'settingsLocal.dialogTitle')} description={t(locale, 'settingsLocal.dialogIntro')} dismissLabel={t(locale, 'settingsLocal.closeDialog')}
        actions={<><Button variant="neutral" labelWrap type="button" disabled={busy} onClick={close}>{t(locale, 'settingsLocal.cancel')}</Button>
          <Button variant="primary" labelWrap type="button" disabled={busy || !executable || !name.trim()} onClick={() => void create()}>{t(locale, 'settingsLocal.add')}</Button></>}>
        <span ref={themeRef} hidden />
        <Stack gap={5}>
          <div className="local-app-field local-app-executable">
            <Label htmlFor={executableId}>{t(locale, 'settingsLocal.executable')}</Label>
            <div className="local-app-row local-app-executable-row">
              <Input className="local-app-executable-input" id={executableId} value={executable?.path ?? ''} readOnly aria-required="true"
                aria-describedby={executableMessageId} aria-invalid={exeError ? true : undefined} style={{ alignSelf: 'stretch' }} />
              <Button variant="neutral" labelWrap type="button" disabled={busy} onClick={() => void chooseExecutable()}>{t(locale, 'settingsLocal.browse')}</Button>
            </div>
            <FieldMessage id={executableMessageId} tone={exeError ? 'error' : 'description'}>{t(locale, exeError ?? 'settingsLocal.executableHint')}</FieldMessage>
          </div>
          <Field className="local-app-field" label={t(locale, 'settingsLocal.name')} hint={t(locale, 'settingsLocal.nameHint')}>
            <Input required value={name} disabled={busy} onChange={event => setName(event.currentTarget.value)} />
          </Field>
          <div className="local-app-field" role="group" aria-label={t(locale, 'settingsLocal.iconLabel')}>
            <span className="local-app-label">{t(locale, 'settingsLocal.iconLabel')}</span>
            <div className="local-app-row">
              <div className="local-app-preview" role="img" aria-label={t(locale, 'settingsLocal.iconPreview')}>
                {preview ? <img src={preview} alt="" onError={() => setImageFailed(true)} /> : <span aria-hidden="true">{initial}</span>}
              </div>
              <Button variant="neutral" labelWrap type="button" disabled={busy} onClick={() => void chooseIcon()}>{t(locale, 'settingsLocal.chooseIcon')}</Button>
              <Button variant="neutral" labelWrap type="button" disabled={busy} onClick={() => { setIcon(null); setIconError(null); }}>{t(locale, 'settingsLocal.clearIcon')}</Button>
            </div>
            <p className="local-app-help">{t(locale, 'settingsLocal.iconHint')}</p>
            {iconError && <Notice tone="danger" size="sm" summary={t(locale, iconError)} />}
          </div>
          {saveError && <Notice tone="danger" size="sm" summary={t(locale, saveError)} />}
        </Stack>
      </DialogContent>
    </Dialog>
    {cleanupError && !revoking && <Notice tone="danger" size="sm" summary={t(locale, 'localApps.errorRefused')} />}
  </>;
}
