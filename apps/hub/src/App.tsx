import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  AppIcon,
  Button,
  Cluster,
  Collapsible,
  CollapsibleContent,
  CollapsibleHeader,
  CollapsibleTrigger,
  Icon,
  IconButton,
  Notice,
  PageHeader,
  Spinner,
  StatusDot,
  Tabs,
  Text,
} from '@egdev/ui';
import { AppDetails } from './apps/details';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  activateConnectedMenuItem,
  closeConnectedApp,
  closeOfficialApp,
  localizeAppReason,
  openOfficialApp,
  scanInstallations,
  type InstallationObservation,
} from './apps';
import { CatalogView } from './catalog';
import { useCatalogInstalls, type CatalogInstalls } from './catalog/install/use-installs';
import { InstallAction } from './catalog/install/action';
import { availableUpdate } from './catalog/update';
import { diskCache, loadCatalog, OFFICIAL_CATALOG_URL, webFetcher, type CatalogState } from './catalog/loader';
import { projectCatalog } from './catalog/mapping';
import { FirstRun } from './first-run';
import { formatNumber, intlLocale, t } from './i18n';
import { LocaleProvider, localeFrom, useLocale } from './i18n/use-locale';
import { LocalAppsView } from './local-apps/view';
import type { HubApp, HubSettings, Language, NewsItem } from './model';
import { NewsPopup } from './news';
import { selectOfficialNews } from './news/selection';
import { useFlyoutVisibility } from './news/use-flyout';
import { defaultSettings, sampleApps, sampleNews } from './sample';
import { SettingsView } from './settings';
import { useSelfUpdate } from './self-update';
import { accentVariables, DEFAULT_ACCENT, normalizeHex } from './settings/palette';
import { useSettings } from './settings/use-settings';
import { exitHubOnly, subscribeRegistry } from './shell/registry';
import { requestFlyoutHide, useFlyoutMotion } from './shell/motion';
import { useContentBackdrop } from './shell/backdrop';
import { noticeText } from './shell/notice';
import type { RegistryApp, RegistrySnapshot } from './shell/registry';
import { backdropAvailable, hideFlyout } from './window';
import nexoLogo from '../src-tauri/app-icon.svg';
import './style.css';

type Tab = 'apps' | 'catalog';

function MainTabsFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const frame = ref.current;
    const list = frame?.querySelector<HTMLElement>('[role="tablist"]');
    if (!frame || !list) return;
    const measure = () => {
      const bottom = Math.max(0, list.getBoundingClientRect().bottom - frame.getBoundingClientRect().top);
      frame.style.setProperty('--menu-band-bottom', `${bottom}px`);
    };
    measure();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(frame);
    resize?.observe(list);
    window.addEventListener('resize', measure);
    return () => {
      resize?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return (
    <div ref={ref} className="main-tabs-frame">
      {children}
    </div>
  );
}

/** Rescans after an app leaves the registry, measured from its departure. */
const DEPARTURE_RESCAN_DELAYS_MS = [2000, 6000];
/** Rescan cadence while an open or close request waits for the observed state change. */
const PENDING_RESCAN_INTERVAL_MS = 1500;
/** How long an open or close request may wait for its observed state change before warning. */
const PENDING_TIMEOUT_MS = 15000;

type PendingAction = 'opening' | 'closing';
type PendingEntry = { action: PendingAction; name: string };

/** Whether the observed app state shows the pending action has taken effect. */
function pendingSettled(action: PendingAction, app: HubApp | undefined, connected: boolean): boolean {
  if (action === 'opening') return connected || app?.runningState === 'running' || app?.runningState === 'connected';
  return !connected && app?.runningState !== 'running' && app?.runningState !== 'connected';
}

function OpenAction({ app, onOpen, busy, stale }: { app: HubApp; onOpen?: (id: string) => void; busy: boolean; stale: boolean }) {
  const locale = useLocale();
  const enabled = !!onOpen && app.source === 'official' && app.installationState === 'installed' && app.canOpen === true && !busy && !stale;
  const title = stale
    ? t(locale, 'appControl.staleTitle')
    : app.openReason
      ? localizeAppReason(locale, app.openReason)
      : t(locale, enabled ? 'appControl.requestOpen' : 'appControl.openUnavailable');
  return (
    <IconButton
      variant="ghost"
      size="md"
      type="button"
      icon={<Icon name="external-link" />}
      label={t(locale, 'appControl.openFor', { name: app.name })}
      title={title}
      disabled={!enabled}
      onClick={() => onOpen?.(app.id)}
    />
  );
}

function ProcessCloseAction({ app, onClose, busy, stale }: { app: HubApp; onClose?: (id: string) => void; busy: boolean; stale: boolean }) {
  const locale = useLocale();
  const enabled = !!onClose && app.source === 'official' && app.installationState === 'installed' && !busy && !stale;
  return (
    <IconButton
      variant="ghost"
      size="md"
      type="button"
      icon={<Icon name="close" />}
      label={t(locale, 'appControl.closeFor', { name: app.name })}
      title={t(locale, stale ? 'appControl.staleTitle' : 'appControl.requestClose')}
      disabled={!enabled}
      onClick={() => onClose?.(app.id)}
    />
  );
}

function Status({ app, pending }: { app: HubApp; pending?: PendingAction }) {
  const locale = useLocale();
  if (pending)
    return (
      <Text asChild variant="body" foreground="secondary">
        <span>
          <Spinner size="sm" /> {t(locale, pending === 'opening' ? 'appControl.opening' : 'appControl.closing')}
        </span>
      </Text>
    );
  if (app.installationState === 'installed') {
    if (app.runningState === 'running')
      return (
        <span>
          <StatusDot state="running" /> {t(locale, 'appControl.running')}
        </span>
      );
    if (app.runningState === 'notRunning')
      return (
        <Text asChild variant="body" foreground="secondary">
          <span>{t(locale, 'appControl.notRunning')}</span>
        </Text>
      );
    return (
      <Text asChild variant="body" foreground="secondary">
        <span>{t(locale, 'appControl.runningUnknown')}</span>
      </Text>
    );
  }
  if (app.integration === 'local')
    return (
      <Text asChild variant="body" foreground="secondary">
        <span>{t(locale, app.source === 'official' ? 'app.officialLaunch' : 'app.localUnknown')}</span>
      </Text>
    );
  return (
    <Text asChild variant="body" foreground="secondary">
      <span>
        {t(locale, 'app.unknown')}
        {app.update && (
          <>
            {' '}
            ·{' '}
            <Text asChild variant="body" foreground="warning">
              <span>{t(locale, 'app.updateSample')}</span>
            </Text>
          </>
        )}
      </span>
    </Text>
  );
}

function updateRunning(installs: CatalogInstalls, id: string): boolean {
  const entry = installs.entries.get(id);
  return entry?.operation === 'update' && entry.status === 'running';
}

function UpdateControl({
  app,
  catalogState,
  installs,
  part = 'action',
}: {
  app: HubApp;
  catalogState?: CatalogState;
  installs: CatalogInstalls;
  part?: 'action' | 'feedback';
}) {
  const update = availableUpdate(app, catalogState?.catalog);
  const entry = installs.entries.get(app.id);
  if (update?.status !== 'available' && entry?.operation !== 'update') return null;
  const unverifiable = update?.status === 'unverifiable';
  const reason = unverifiable
    ? catalogState?.stale
      ? 'update.unverifiableStale'
      : 'update.unverifiable'
    : catalogState?.stale
      ? 'update.stale'
      : catalogState?.status !== 'ready'
        ? 'update.unavailable'
        : installs.connection !== 'ready'
          ? 'update.progressUnavailable'
          : undefined;
  return (
    <InstallAction
      app={app}
      installs={installs}
      mode="update"
      version={update?.status === 'available' ? update.version : undefined}
      reason={reason}
      unverifiable={unverifiable}
      compact
      part={part}
    />
  );
}

function UpdateNotes({ app, catalogState }: { app: HubApp; catalogState?: CatalogState }) {
  const notes = availableUpdate(app, catalogState?.catalog)?.notes;
  return notes ? (
    <Text asChild variant="body" foreground="secondary" className="meta">
      <div>
        <div className="update-notes">
          <strong>{notes.title}</strong>
          <p>{notes.text}</p>
        </div>
      </div>
    </Text>
  ) : null;
}

function ConnectedRow({
  app,
  official,
  onClose,
  onOpen,
  onMenuAction,
  busy,
  pending,
  catalogState,
  installs,
  open,
  onOpenChange,
}: {
  app: RegistryApp;
  pending?: PendingAction;
  official?: HubApp;
  onClose?: (id: string) => void;
  onOpen?: (id: string) => void;
  onMenuAction?: (app: RegistryApp, itemId: string) => void;
  busy: boolean;
  catalogState?: CatalogState;
  installs: CatalogInstalls;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const locale = useLocale();
  const update = official && availableUpdate(official, catalogState?.catalog);
  const canShow = !!onOpen && !!official && app.responsive && app.capabilities.includes('show') && !busy && !updateRunning(installs, app.app.id);
  return (
    <Collapsible className="app-card" open={open} onOpenChange={onOpenChange}>
      <CollapsibleHeader
        actions={
          <>
            {official && <UpdateControl app={official} catalogState={catalogState} installs={installs} />}
            <IconButton
              type="button"
              variant="ghost"
              icon={<Icon name="external-link" />}
              label={t(locale, 'appControl.openFor', { name: app.app.name })}
              title={t(locale, canShow ? 'appControl.requestOpen' : 'appControl.showUnavailable')}
              disabled={!canShow}
              onClick={() => onOpen?.(app.app.id)}
            />
          </>
        }
      >
        <CollapsibleTrigger motion="none">
          <span className="row-label">
            <AppIcon size="lg" monogram={app.app.name.trim().charAt(0).toUpperCase()} src={official?.iconUrl} />
            <span className="app-info">
              <strong>{app.app.name}</strong>
              {pending ? (
                <Text asChild variant="body" foreground="secondary">
                  <span>
                    <Spinner size="sm" /> {t(locale, pending === 'opening' ? 'appControl.opening' : 'appControl.closing')}
                  </span>
                </Text>
              ) : app.responsive ? (
                <span>
                  <StatusDot state="running" /> {t(locale, 'app.connected')}
                </span>
              ) : (
                <Text asChild variant="body" foreground="secondary">
                  <span>{t(locale, 'app.unresponsive')}</span>
                </Text>
              )}
            </span>
          </span>
        </CollapsibleTrigger>
      </CollapsibleHeader>
      {official && <UpdateControl app={official} catalogState={catalogState} installs={installs} part="feedback" />}
      <CollapsibleContent padding="sm" presence="unmount">
        <div className="detail-inner">
          <AppDetails
            app={official}
            version={official?.installationState === 'installed' ? official.version : undefined}
            newVersion={update?.status === 'available' ? update.version : undefined}
            showInstalledVersion={official?.installationState !== 'unknown'}
          />
          {update?.status === 'unverifiable' && (
            <Text variant="body" foreground="secondary" className="meta">
              {t(locale, catalogState?.stale ? 'update.unverifiableStale' : 'update.unverifiable')}
            </Text>
          )}
          {official && <UpdateNotes app={official} catalogState={catalogState} />}
          <Text variant="body" foreground="secondary" className="meta">
            {t(locale, 'app.reportedVersion', { version: app.app.version, tray: t(locale, app.unified ? 'app.unified' : 'app.ownIcon') })}
          </Text>
          {onClose &&
            (app.responsive && app.capabilities.includes('quit') ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label={t(locale, 'appControl.closeFor', { name: app.app.name })}
                disabled={busy && pending !== 'closing'}
                loading={pending === 'closing'}
                onClick={() => onClose(app.app.id)}
              >
                {t(locale, 'common.close')}
              </Button>
            ) : (
              <Text variant="body" foreground="secondary" className="meta">
                {t(locale, 'appControl.closeUnavailable')}
              </Text>
            ))}
          {app.menu.length > 0 && (
            <>
              <Text variant="body" foreground="secondary" className="meta">
                {t(locale, 'app.reportedMenu')}
              </Text>
              <Cluster asChild gap={1} alignItems="stretch">
                <ul className="registry-menu">
                  {app.menu.map((item, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Connected apps can supply duplicate menu IDs; keep the existing composite key.
                    <li key={`${item.id}-${index}`}>
                      <Button
                        className="registry-menu__action"
                        type="button"
                        size="sm"
                        variant="neutral"
                        labelWrap
                        disabled={!onMenuAction || !app.responsive || !item.enabled || !app.capabilities.includes('menu')}
                        onClick={() => onMenuAction?.(app, item.id)}
                      >
                        {item.label}
                        {!item.enabled && t(locale, 'app.disabled')}
                        {item.checked === true && t(locale, 'app.checked')}
                        {item.checked === false && t(locale, 'app.unchecked')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Cluster>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AppRow({
  app,
  onOpen,
  onClose,
  busy,
  pending,
  stale,
  catalogState,
  installs,
  open,
  onOpenChange,
}: {
  app: HubApp;
  onOpen?: (id: string) => void;
  onClose?: (id: string) => void;
  busy: boolean;
  pending?: PendingAction;
  stale: boolean;
  catalogState?: CatalogState;
  installs: CatalogInstalls;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const locale = useLocale();
  const update = availableUpdate(app, catalogState?.catalog);
  return (
    <Collapsible className="app-card" open={open} onOpenChange={onOpenChange}>
      <CollapsibleHeader
        actions={
          <>
            <UpdateControl app={app} catalogState={catalogState} installs={installs} />
            {app.source === 'official' && app.runningState === 'running' ? (
              <ProcessCloseAction app={app} onClose={onClose} busy={busy || updateRunning(installs, app.id)} stale={stale} />
            ) : (
              <OpenAction app={app} onOpen={onOpen} busy={busy || updateRunning(installs, app.id)} stale={stale} />
            )}
          </>
        }
      >
        <CollapsibleTrigger motion="none">
          <span className="row-label">
            <AppIcon size="lg" monogram={app.name.trim().charAt(0).toUpperCase()} src={app.iconUrl} />
            <span className="app-info">
              <strong>{app.name}</strong>
              <Status app={app} pending={pending} />
            </span>
          </span>
        </CollapsibleTrigger>
      </CollapsibleHeader>
      <UpdateControl app={app} catalogState={catalogState} installs={installs} part="feedback" />
      <CollapsibleContent padding="sm" presence="unmount">
        <div className="detail-inner">
          <AppDetails app={app} version={app.version} newVersion={update?.status === 'available' ? update.version : undefined} />
          {update?.status === 'unverifiable' && (
            <Text variant="body" foreground="secondary" className="meta">
              {t(locale, catalogState?.stale ? 'update.unverifiableStale' : 'update.unverifiable')}
            </Text>
          )}
          <UpdateNotes app={app} catalogState={catalogState} />
          <Text variant="body" foreground="secondary" className="meta">
            {app.description}
          </Text>
          {onOpen && !app.canOpen && (
            <Text variant="body" foreground="secondary" className="meta">
              {t(locale, 'appControl.openUnavailableDetail', {
                reason: app.openReason ? localizeAppReason(locale, app.openReason) : t(locale, 'appControl.executableUnchecked'),
              })}
            </Text>
          )}
          {onOpen && stale && (
            <Text variant="body" foreground="secondary" className="meta">
              {t(locale, 'appControl.staleOpenDetail')}
            </Text>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function isInstalled(app: HubApp) {
  return app.statusKnown !== false && app.installed && app.installationState !== 'unknown' && app.installationState !== 'notInstalled';
}

function InstalledPanel({
  apps,
  connected,
  selectCatalog,
  installedStateKnown,
  onRefresh,
  onClose,
  onProcessClose,
  onOpen,
  onMenuAction,
  pending,
  stale,
  hideLocalApps,
  localCycle,
  catalogState,
  installs,
}: {
  apps: HubApp[];
  connected: RegistryApp[];
  selectCatalog: () => void;
  installedStateKnown: boolean;
  onRefresh?: () => void;
  onClose?: (id: string) => void;
  onMenuAction?: (app: RegistryApp, itemId: string) => void;
  onProcessClose?: (id: string) => void;
  onOpen?: (id: string) => void;
  pending: Readonly<Record<string, PendingEntry>>;
  stale: boolean;
  hideLocalApps: boolean;
  localCycle?: number;
  catalogState?: CatalogState;
  installs: CatalogInstalls;
}) {
  const locale = useLocale();
  const ids = new Set(connected.map((entry) => entry.app.id));
  const allInstalled = apps.filter(isInstalled);
  const installed = allInstalled.filter((app) => !ids.has(app.id));
  const [openRow, setOpenRow] = useState<string | null>(null);
  const disclosure = (id: string) => ({
    open: openRow === id,
    onOpenChange: (open: boolean) => setOpenRow((current) => (open ? id : current === id ? null : current)),
  });
  /** Closing an app also collapses its row, whichever close control was used. */
  const collapseThen = (close?: (id: string) => void) =>
    close &&
    ((id: string) => {
      setOpenRow((current) => (current === `official:${id}` || current === `connected:${id}` ? null : current));
      close(id);
    });
  const closeConnected = collapseThen(onClose);
  const closeProcess = collapseThen(onProcessClose);
  return (
    <>
      {connected.length > 0 && (
        <section aria-label={t(locale, 'app.connectedPlural')}>
          <div className="apps-section-header">
            <PageHeader level={2} title={t(locale, 'app.connectedPlural')} />
          </div>
          {connected.map((app) => (
            <ConnectedRow
              key={app.app.id}
              app={app}
              official={apps.find((item) => item.source === 'official' && item.id === app.app.id)}
              onClose={closeConnected}
              onOpen={onOpen}
              onMenuAction={onMenuAction}
              busy={!!pending[app.app.id]}
              pending={pending[app.app.id]?.action}
              catalogState={catalogState}
              installs={installs}
              {...disclosure(`connected:${app.app.id}`)}
            />
          ))}
        </section>
      )}
      <div className="apps-section-header">
        <PageHeader
          level={2}
          title={t(locale, 'app.installed')}
          actions={
            onRefresh && (
              <Button variant="neutral" size="sm" onClick={onRefresh}>
                {t(locale, 'appControl.refresh')}
              </Button>
            )
          }
        />
      </div>
      {installed.length ? (
        installed.map((app) => (
          <AppRow
            key={app.id}
            app={app}
            onOpen={onOpen}
            onClose={closeProcess}
            busy={!!pending[app.id]}
            pending={pending[app.id]?.action}
            stale={stale}
            catalogState={catalogState}
            installs={installs}
            {...disclosure(`official:${app.id}`)}
          />
        ))
      ) : (
        <div className="empty-state">
          <p>{allInstalled.length ? t(locale, 'appControl.connectedAbove') : t(locale, installedStateKnown ? 'app.empty' : 'app.installationUnknown')}</p>
          <Button variant="neutral" size="sm" onClick={selectCatalog}>
            {t(locale, 'app.viewCatalog')}
          </Button>
        </div>
      )}
      {apps
        .filter((app) => !isInstalled(app) && !ids.has(app.id) && installs.entries.get(app.id)?.operation === 'update')
        .map((app) => (
          <UpdateControl key={app.id} app={app} catalogState={catalogState} installs={installs} part="feedback" />
        ))}
      {!hideLocalApps && (
        <LocalAppsView
          names={[...apps.map((app) => ({ id: app.id, name: app.name })), ...connected.map((entry) => entry.app)]}
          cycle={localCycle}
          openId={openRow}
          onDisclosureChange={(id, open) => disclosure(`local:${id}`).onOpenChange(open)}
        />
      )}
      {!(onRefresh && hideLocalApps) && (
        <Text variant="body" foreground="muted" className="foot">
          {t(locale, onRefresh ? 'appControl.officialCloseFoot' : installedStateKnown ? 'app.sampleFoot' : 'app.managementUnavailable')}
        </Text>
      )}
    </>
  );
}

interface FlyoutProps {
  apps?: HubApp[];
  news?: NewsItem[];
  catalogState?: CatalogState;
  onCatalogRetry?: () => void;
  installedStateKnown?: boolean;
  onAppsRefresh?: () => void;
  onCatalogOpen?: () => void;
  onCatalogRefresh?: () => void;
  validNewsKeys?: ReadonlySet<string>;
}

export function FlyoutPanel({
  apps = sampleApps,
  news = sampleNews,
  catalogState,
  onCatalogRetry,
  installedStateKnown = true,
  onAppsRefresh,
  onCatalogOpen,
  onCatalogRefresh,
  validNewsKeys,
}: FlyoutProps) {
  const [active, setActive] = useState<Tab>('apps');
  const store = useSettings();
  const settings = store.settings;
  const locale = localeFrom(settings);
  const [previewLanguage, setPreviewLanguage] = useState<Language>('es');
  const shown = settings ?? defaultSettings;
  const firstRun = !settings?.firstRunComplete;
  const usable = store.fileState === 'ready' || store.fileState === 'missing';
  const native = isTauri();
  const selfUpdate = useSelfUpdate(native, store.flush);
  const motion = useFlyoutMotion();
  const {
    visibility,
    lastShow,
    error: visibilityError,
  } = useFlyoutVisibility(() => {
    finishNews();
  });
  const refreshAppsRef = useRef(onAppsRefresh);
  refreshAppsRef.current = onAppsRefresh;
  const installs = useCatalogInstalls(native && !!onAppsRefresh, apps, onAppsRefresh);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each visibility cycle must refresh apps even when the visible flag stays true.
  useEffect(() => {
    if (visibility?.visible) refreshAppsRef.current?.();
  }, [visibility?.cycle, visibility?.visible]);
  const catalogOpenRef = useRef(onCatalogOpen);
  catalogOpenRef.current = onCatalogOpen;
  const catalogCycle = useRef<number | null>(null);
  useEffect(() => {
    if (visibility?.visible && catalogCycle.current !== visibility.cycle) {
      catalogCycle.current = visibility.cycle;
      catalogOpenRef.current?.();
    }
  }, [visibility?.cycle, visibility?.visible]);
  const openedCycle = useRef(0);
  const visitedCycle = useRef(0);
  const viewed = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState<{ items: NewsItem[]; at: string; stale: boolean; cycle: number; seenKeys: ReadonlySet<string> } | null>(null);
  const newsOpen = !!settings && usable && !firstRun && !!snapshot;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [targetAppId, setTargetAppId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hasBackdrop, setHasBackdrop] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  useContentBackdrop(panelRef, native && hasBackdrop, motion.phase, motion.generation, shown.blur, shown.opacity);
  const [registry, setRegistry] = useState<RegistrySnapshot>({ revision: 0, apps: [] });
  const [registryFailed, setRegistryFailed] = useState(false);
  const [pending, setPending] = useState<Readonly<Record<string, PendingEntry>>>({});
  const pendingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingToken = useRef(0);
  /** Latest request token per app; a response superseded by a newer request is ignored. */
  const pendingTokens = useRef(new Map<string, number>());
  const [actionMessage, setActionMessage] = useState<{
    error: boolean;
    warning?: boolean;
    text: string;
    localize?: boolean;
    key?: 'appControl.quitAccepted' | 'appControl.confirmTimeout';
    params?: Record<string, string>;
  } | null>(null);
  const observed = useRef({ apps, registry });
  observed.current = { apps, registry };
  function endPending(id: string) {
    clearTimeout(pendingTimers.current.get(id));
    pendingTimers.current.delete(id);
    setPending((current) => {
      if (!current[id]) return current;
      const { [id]: _done, ...rest } = current;
      return rest;
    });
  }
  /** Starts waiting for an app's state change and returns a check that the request is still the latest one. */
  function startPending(id: string, action: PendingAction): () => boolean {
    const name =
      observed.current.apps.find((app) => app.id === id)?.name ?? observed.current.registry.apps.find((entry) => entry.app.id === id)?.app.name ?? id;
    const token = ++pendingToken.current;
    pendingTokens.current.set(id, token);
    clearTimeout(pendingTimers.current.get(id));
    pendingTimers.current.set(
      id,
      setTimeout(() => {
        endPending(id);
        setActionMessage({ error: false, warning: true, text: '', key: 'appControl.confirmTimeout', params: { name } });
      }, PENDING_TIMEOUT_MS),
    );
    setPending((current) => ({ ...current, [id]: { action, name } }));
    setActionMessage(null);
    return () => pendingTokens.current.get(id) === token;
  }
  /** Ends the wait when the app state cannot be observed, so no confirmation could ever arrive. */
  function endPendingIfUnobservable(id: string) {
    const { apps: currentApps, registry: currentRegistry } = observed.current;
    const connected = currentRegistry.apps.some((entry) => entry.app.id === id);
    if (!connected && currentApps.find((app) => app.id === id)?.runningState === 'unknown') endPending(id);
  }
  function openApp(id: string) {
    const latest = startPending(id, 'opening');
    void openOfficialApp(id)
      .then((text) => {
        if (!latest()) return;
        setActionMessage({ error: false, text, localize: true });
        endPendingIfUnobservable(id);
      })
      .catch((error) => {
        if (!latest()) return;
        endPending(id);
        setActionMessage({ error: true, text: String(error), localize: true });
      })
      .finally(() => onAppsRefresh?.());
  }
  function closeApp(id: string) {
    const latest = startPending(id, 'closing');
    void closeConnectedApp(id)
      .then(() => {
        if (latest()) setActionMessage({ error: false, text: '', key: 'appControl.quitAccepted' });
      })
      .catch((error) => {
        if (!latest()) return;
        endPending(id);
        setActionMessage({ error: true, text: String(error) });
      })
      .finally(() => onAppsRefresh?.());
  }
  function runMenuItem(app: RegistryApp, itemId: string) {
    setActionMessage(null);
    void activateConnectedMenuItem(app.app.id, app.generation, app.menu_revision, itemId).catch((error) =>
      setActionMessage({ error: true, text: String(error) }),
    );
  }
  function closeProcessApp(id: string) {
    const latest = startPending(id, 'closing');
    void closeOfficialApp(id)
      .then((result) => {
        if (!latest()) return;
        if (result.status === 'stillRunning') endPending(id);
        else endPendingIfUnobservable(id);
        setActionMessage({ error: false, warning: result.status === 'stillRunning', text: result.message });
      })
      .catch((error) => {
        if (!latest()) return;
        endPending(id);
        setActionMessage({ error: true, text: String(error), localize: true });
      })
      .finally(() => onAppsRefresh?.());
  }
  const installed = apps.filter(isInstalled);
  const installedCount = installed.length;
  const sampleInstalled = installed.some((app) => app.source !== 'official');

  // Settle each pending request once the observed state shows it took effect.
  useEffect(() => {
    const connected = new Set(registry.apps.map((entry) => entry.app.id));
    for (const [id, entry] of Object.entries(pending))
      if (
        pendingSettled(
          entry.action,
          apps.find((app) => app.id === id),
          connected.has(id),
        )
      )
        endPending(id);
  });
  // No event reports a process start or exit, so rescan while a request waits for its effect.
  const waiting = Object.keys(pending).length > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => refreshAppsRef.current?.(), PENDING_RESCAN_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  useEffect(() => {
    const timers = pendingTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const failed = (error: unknown) => {
      console.error('No se pudo leer el registro de Nexo.', error);
      if (mounted) setRegistryFailed(true);
    };
    // An app that leaves the registry (for example after an accepted quit) may still be exiting:
    // rescan now and twice more so its card does not keep a stale «running» state.
    const rescans: ReturnType<typeof setTimeout>[] = [];
    let latest = -1;
    let ids = new Set<string>();
    void subscribeRegistry((next) => {
      if (!mounted || next.revision < latest) return;
      latest = next.revision;
      const nextIds = new Set(next.apps.map((entry) => entry.app.id));
      const left = [...ids].some((id) => !nextIds.has(id));
      ids = nextIds;
      setRegistry((current) => (next.revision >= current.revision ? next : current));
      if (left) {
        refreshAppsRef.current?.();
        for (const delay of DEPARTURE_RESCAN_DELAYS_MS)
          rescans.push(
            setTimeout(() => {
              if (mounted) refreshAppsRef.current?.();
            }, delay),
          );
      }
    }, failed)
      .then((stop) => {
        if (mounted) unlisten = stop;
        else stop();
      })
      .catch(failed);
    return () => {
      mounted = false;
      unlisten?.();
      rescans.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void backdropAvailable().then((available) => {
      if (mounted) setHasBackdrop(available);
    });
    return () => {
      mounted = false;
    };
  }, []);

  function finishNews() {
    const open = snapshotRef.current;
    if (!open) return;
    snapshotRef.current = null;
    store.recordVisit(open.at, Array.from(viewed.current));
    viewed.current.clear();
    setSnapshot(null);
  }

  function hidePanel() {
    finishNews();
    if (native) requestFlyoutHide();
    else void hideFlyout();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Visit and finish callbacks are recreated each render; rerunning would repeat cycle-based news effects.
  useEffect(() => {
    if (!visibility || !usable || !settings) return;
    if (lastShow && visitedCycle.current !== lastShow.cycle) {
      visitedCycle.current = lastShow.cycle;
      const shownAt = typeof lastShow.at === 'string' ? lastShow.at : new Date(lastShow.at || Date.now()).toISOString();
      store.recordVisit(shownAt, []);
    }
    if (!visibility.visible) {
      finishNews();
      return;
    }
    const at = typeof visibility.at === 'string' ? visibility.at : new Date(visibility.at || Date.now()).toISOString();
    if (validNewsKeys && catalogState && !catalogState.stale && catalogState.status !== 'loading') {
      store.recordVisit(at, [], validNewsKeys);
    }
    if (!settings.firstRunComplete) return;
    if (!settings.showNewsOnOpen) {
      openedCycle.current = visibility.cycle;
      return;
    }
    if (openedCycle.current === visibility.cycle) return;
    if (!news.length) return;
    openedCycle.current = visibility.cycle;
    viewed.current.clear();
    const next = { items: news.slice(0, 4), at, stale: !!catalogState?.stale, cycle: visibility.cycle, seenKeys: new Set(store.getVisit()?.seenKeys ?? []) };
    snapshotRef.current = next;
    setTargetAppId(null);
    setSnapshot(next);
  }, [visibility, lastShow, usable, settings, news, validNewsKeys, catalogState]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The Escape listener changes with the news snapshot, not each recreated hidePanel callback.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented && !snapshot) {
        event.preventDefault();
        hidePanel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [snapshot]);

  const panelStyle = {
    ...accentVariables(shown.accent),
    '--hub-density': shown.compact ? '0.8' : '1',
    '--hub-opacity': String(shown.opacity / 100),
    '--hub-blur': `${shown.blur}px`,
  } as CSSProperties;

  function updateSettings(next: HubSettings) {
    if (!settings) return;
    const displayed = { ...settings, language: store.languageDraft ?? settings.language };
    const patch = Object.fromEntries(
      (Object.keys(next) as (keyof HubSettings)[]).filter((key) => key !== 'startWithWindows' && next[key] !== displayed[key]).map((key) => [key, next[key]]),
    );
    store.change(patch);
  }
  const errorLocale = usable && firstRun ? previewLanguage : locale;
  const plural = new Intl.PluralRules(intlLocale(locale)).select(installedCount);

  return (
    <LocaleProvider locale={locale}>
      <main
        ref={panelRef}
        className={`flyout${hasBackdrop ? ' has-native-backdrop' : ''}${motion.className}`}
        data-backdrop={motion.sliding ? 'opaque' : undefined}
        data-news-open={newsOpen ? '' : undefined}
        data-custom-accent={normalizeHex(shown.accent) !== DEFAULT_ACCENT ? '' : undefined}
        aria-labelledby="panel-title"
        style={panelStyle}
        onTransitionEnd={motion.onTransitionEnd}
      >
        <header className="panel-head">
          <div className="heading">
            <img className="n-mark" src={nexoLogo} alt="" />
            <h1 id="panel-title">Nexo</h1>
            <p>
              ·{' '}
              {installedStateKnown
                ? `${t(locale, plural === 'one' ? 'app.headerOne' : 'app.headerOther', { count: formatNumber(locale, installedCount) })}${sampleInstalled ? ` (${t(locale, 'common.sample')})` : ''}`
                : t(locale, 'app.headerUnknown')}
            </p>
            <div className="head-actions">
              {usable && !firstRun && !showSettings && (
                <IconButton
                  label={t(locale, 'common.settings')}
                  title={t(locale, 'common.settings')}
                  variant="ghost"
                  icon={<Icon name="settings" />}
                  onClick={() => setShowSettings(true)}
                />
              )}
              <IconButton
                label={t(locale, 'app.closePanel')}
                title={t(locale, 'app.closePanel')}
                variant="ghost"
                icon={<Icon name="close" />}
                onClick={hidePanel}
              />
            </div>
          </div>
        </header>
        <div className="panel-notices">
          {!showSettings && (selfUpdate.state.phase === 'available' || selfUpdate.state.phase === 'installing') && (
            <Notice
              tone="info"
              summary={t(locale, 'selfUpdate.available', { version: selfUpdate.state.update.version })}
              actions={
                <Button variant="neutral" size="sm" type="button" disabled={selfUpdate.state.phase === 'installing'} onClick={selfUpdate.install}>
                  {t(locale, selfUpdate.state.phase === 'installing' ? 'selfUpdate.installing' : 'common.install')}
                </Button>
              }
            />
          )}
          {!showSettings && selfUpdate.state.phase === 'error' && (
            <Notice
              tone="danger"
              summary={t(locale, selfUpdate.state.operation === 'check' ? 'selfUpdate.checkError' : 'selfUpdate.installError')}
              actions={
                <Button variant="neutral" size="sm" type="button" onClick={selfUpdate.check}>
                  {t(locale, 'common.retry')}
                </Button>
              }
            />
          )}
          {visibilityError && <Notice tone="danger" summary={t(locale, 'app.visibilityError', { error: visibilityError })} />}
          {registryFailed && <Notice tone="danger" summary={t(locale, 'app.registryError')} />}
          {actionMessage && (
            <Notice
              size="sm"
              tone={actionMessage.error ? 'danger' : actionMessage.warning ? 'warning' : 'success'}
              summary={
                actionMessage.key
                  ? t(locale, actionMessage.key, actionMessage.params)
                  : actionMessage.localize
                    ? localizeAppReason(locale, actionMessage.text)
                    : actionMessage.text
              }
            />
          )}
          {registry.notice && (
            <Notice
              tone="danger"
              summary={noticeText(locale, registry.notice)}
              actions={
                registry.notice.hub_only_allowed && (
                  <Button
                    variant="neutral"
                    size="sm"
                    onClick={() =>
                      void (async () => {
                        if (await store.flush()) await exitHubOnly();
                      })().catch((error) => console.error('No se pudo cerrar solo Nexo.', error))
                    }
                  >
                    {t(locale, 'app.hubOnly')}
                  </Button>
                )
              }
            />
          )}
          {store.nativeError && (
            <Notice
              tone="danger"
              summary={`${t(locale, 'native.refreshError', { error: store.nativeError })} `}
              actions={
                <Button variant="neutral" size="sm" onClick={store.retryNative}>
                  {t(locale, 'native.refreshRetry')}
                </Button>
              }
            />
          )}
          {store.error && (
            <Notice
              tone="danger"
              lang={errorLocale}
              summary={`${t(errorLocale, store.error.key, { error: store.error.detailKey ? t(errorLocale, store.error.detailKey) : (store.error.detail ?? '') })} `}
              actions={
                <Button
                  variant="neutral"
                  size="sm"
                  onClick={!usable ? store.reload : firstRun && store.error.key === 'settings.saveError' ? () => store.choose(previewLanguage) : store.retry}
                >
                  {t(errorLocale, 'common.retry')}
                </Button>
              }
            />
          )}
        </div>
        {store.fileState === null ? (
          <p role="status" className="settings__foot">
            {t(locale, 'app.loadingSettings')}
          </p>
        ) : !usable ? (
          <div className="settings__foot">
            {!store.error && <p role="alert">{t(locale, store.fileState === 'future' ? 'app.futureSettings' : 'app.unreadableSettings')}</p>}
            {store.fileState !== 'future' && (
              <Button variant="neutral" size="sm" onClick={store.recover}>
                {t(locale, 'app.recoverSettings')}
              </Button>
            )}
            <Button variant="neutral" size="sm" onClick={store.reload}>
              {t(locale, 'app.retryRead')}
            </Button>
          </div>
        ) : firstRun ? (
          <div className="area-scroll">
            <FirstRun
              onChoose={store.choose}
              onPreview={(language) => {
                setPreviewLanguage(language);
                store.previewChoice(language);
              }}
            />
          </div>
        ) : settings && showSettings ? (
          <div className="area-scroll">
            <SettingsView
              settings={{ ...settings, language: store.languageDraft ?? settings.language }}
              languagePending={store.languageDraft !== null}
              sources={settings.sources}
              autostart={store.autostart}
              selfUpdate={selfUpdate}
              onChange={updateSettings}
              onClose={() => setShowSettings(false)}
            />
          </div>
        ) : (
          <MainTabsFrame>
            <Tabs
              className="main-tabs"
              variant="outline"
              fullWidth
              fill
              label={t(locale, 'app.sections')}
              value={active}
              onValueChange={(value) => setActive(value as Tab)}
              items={[
                {
                  value: 'apps',
                  label: t(locale, 'app.myApps'),
                  content: (
                    <div className="main-tab-content">
                      <InstalledPanel
                        apps={apps}
                        connected={registry.apps}
                        installedStateKnown={installedStateKnown}
                        onRefresh={
                          onAppsRefresh &&
                          (() => {
                            onAppsRefresh();
                            onCatalogRefresh?.();
                          })
                        }
                        onClose={onAppsRefresh ? closeApp : undefined}
                        onMenuAction={onAppsRefresh ? runMenuItem : undefined}
                        onProcessClose={onAppsRefresh ? closeProcessApp : undefined}
                        onOpen={onAppsRefresh ? openApp : undefined}
                        pending={pending}
                        stale={catalogState?.stale === true || (!!catalogState && catalogState.status !== 'ready' && catalogState.status !== 'empty')}
                        hideLocalApps={settings.hideLocalApps}
                        localCycle={visibility?.visible ? visibility.cycle : undefined}
                        catalogState={catalogState}
                        installs={installs}
                        selectCatalog={() => setActive('catalog')}
                      />
                    </div>
                  ),
                },
                {
                  value: 'catalog',
                  label: t(locale, 'common.catalog'),
                  content: (
                    <div className="main-tab-content">
                      <CatalogView
                        apps={apps}
                        state={catalogState?.status}
                        stale={catalogState?.stale}
                        reason={catalogState?.reason}
                        installationKnown={installedStateKnown}
                        onRetry={onCatalogRetry}
                        targetAppId={targetAppId}
                        catalog={catalogState?.catalog}
                        installs={installs}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </MainTabsFrame>
        )}
        {settings && (
          <NewsPopup
            key={snapshot?.cycle}
            items={snapshot?.items ?? []}
            seenKeys={snapshot?.seenKeys}
            open={newsOpen}
            onClose={finishNews}
            dontShow={!settings.showNewsOnOpen}
            stale={snapshot?.stale}
            onShown={(item) => viewed.current.add(item.id)}
            onCatalog={(appId) => {
              finishNews();
              setShowSettings(false);
              setTargetAppId(appId);
              setActive('catalog');
            }}
            onDontShowChange={(dontShow) => store.change({ showNewsOnOpen: !dontShow })}
          />
        )}
      </main>
    </LocaleProvider>
  );
}

const CATALOG_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export default function App(props: FlyoutProps) {
  const native = isTauri();
  const liveCatalog = native && props.apps === undefined;
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' });
  const [installations, setInstallations] = useState<InstallationObservation[] | null>(null);
  const requestId = useRef(0);
  const platformKey = useRef<Promise<string | null> | null>(null);
  const catalogInFlight = useRef(false);
  const catalogActive = useRef(false);
  const lastCatalogSuccess = useRef<number | null>(null);
  const scanId = useRef(0);

  function refreshApps() {
    if (!liveCatalog || !catalogState.catalog || catalogState.reason === 'cache') return;
    const id = ++scanId.current;
    // Keep the last observation on screen while rescanning; clearing it would blank every card.
    void scanInstallations()
      .then((result) => {
        if (id === scanId.current) setInstallations(result);
      })
      .catch(() => {
        if (id === scanId.current) setInstallations(null);
      });
  }

  function retry() {
    if (catalogInFlight.current) return;
    catalogInFlight.current = true;
    const id = ++requestId.current;
    setCatalogState((current) => (current.catalog ? current : { ...current, status: 'loading' }));
    platformKey.current ??= invoke<string | null>('platform_key').catch(() => null);
    void platformKey.current
      .then((key) => loadCatalog(OFFICIAL_CATALOG_URL, diskCache, webFetcher, key))
      .then(
        (result) => {
          if (!catalogActive.current || id !== requestId.current) return;
          if ((result.status === 'ready' || result.status === 'empty') && result.catalog) lastCatalogSuccess.current = Date.now();
          setCatalogState((current) =>
            (result.status === 'error' || result.status === 'offline') && current.catalog ? { ...result, catalog: current.catalog, stale: true } : result,
          );
        },
        () => {
          if (catalogActive.current && id === requestId.current)
            setCatalogState((current) => ({ status: 'offline', catalog: current.catalog, stale: !!current.catalog }));
        },
      )
      .finally(() => {
        catalogInFlight.current = false;
      });
  }
  function refreshCatalogOnOpen() {
    if (lastCatalogSuccess.current === null || Date.now() - lastCatalogSuccess.current > CATALOG_REFRESH_INTERVAL_MS) retry();
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry is recreated each render; catalog loading and cleanup are tied to liveCatalog only.
  useEffect(() => {
    catalogActive.current = liveCatalog;
    if (liveCatalog) retry();
    return () => {
      catalogActive.current = false;
    };
  }, [liveCatalog]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The catalog and cache reason govern scans; refreshApps is recreated on every render.
  useEffect(() => {
    setInstallations(null);
    if (liveCatalog && catalogState.catalog) refreshApps();
    function onFocus() {
      refreshApps();
    }
    window.addEventListener('focus', onFocus);
    return () => {
      scanId.current++;
      window.removeEventListener('focus', onFocus);
    };
  }, [liveCatalog, catalogState.catalog, catalogState.reason]);

  if (!liveCatalog) return <FlyoutPanel {...props} news={props.news ?? (native ? [] : sampleNews)} />;
  const byId = new Map((installations ?? []).map((item) => [item.id, item]));
  const known = Object.fromEntries(
    (installations ?? [])
      .filter((item) => item.state !== 'unknown')
      .map((item) => [
        item.id,
        {
          installed: item.state === 'installed',
          running: item.runningState === 'running' || item.runningState === 'connected',
          version: item.version ?? undefined,
        },
      ]),
  );
  const catalog = catalogState.catalog;
  const projected = catalog ? projectCatalog(catalog, known) : { apps: [] };
  const selection = catalog ? selectOfficialNews(catalog) : { items: [], validKeys: undefined };
  const apps = projected.apps.map((app) => ({
    ...app,
    installationState: byId.get(app.id)?.state ?? ('unknown' as const),
    installationReason: byId.get(app.id)?.reason,
    runningState: byId.get(app.id)?.runningState ?? ('unknown' as const),
    canOpen: byId.get(app.id)?.canOpen === true,
    openReason: byId.get(app.id)?.openReason ?? undefined,
  }));
  const installedStateKnown = installations !== null && apps.every((app) => app.installationState !== 'unknown');
  return (
    <FlyoutPanel
      {...props}
      apps={apps}
      news={selection.items}
      validNewsKeys={selection.validKeys}
      catalogState={catalogState}
      onCatalogRetry={retry}
      onAppsRefresh={refreshApps}
      onCatalogOpen={refreshCatalogOnOpen}
      onCatalogRefresh={retry}
      installedStateKnown={installedStateKnown}
    />
  );
}
