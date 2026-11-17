// Shared hub UI contracts (issue #13). Areas own their folders; App.tsx wires them together.
// Real data arrives with the catalog (#5), hub IPC (#4) and persisted settings (#16).

export type Integration = 'complete' | 'updates' | 'local' | 'catalog';

export interface DiscoveryLinks {
  github?: string;
  youtube?: string;
}

export interface HubApp {
  id: string;
  name: string;
  installed: boolean;
  running: boolean;
  integration: Integration;
  description: string;
  version?: string;
  update?: string;
  /** Catalog visuals (#5 revision): short pitch and tags. */
  tagline?: string;
  tags?: string[];
  links?: DiscoveryLinks;
  /** Official catalog capability is separate from source and installed state. */
  source?: 'official' | 'local';
  catalogIntegration?: 'full' | 'update' | 'launch';
  /** Compatibility flag for installation; running evidence is represented independently. */
  statusKnown?: boolean;
  installationState?: 'installed' | 'notInstalled' | 'unknown';
  installationReason?: string;
  runningState?: 'connected' | 'running' | 'notRunning' | 'unknown';
  canOpen?: boolean;
  openReason?: string;
  iconUrl?: string;
  artUrl?: string;
  catalogVersion?: string;
  releasedAt?: string;
  featured?: boolean;
}

export interface NewsItem {
  id: string;
  appId: string;
  badge: 'Nuevo' | 'Destacada' | 'Actualización';
  title: string;
  text: string;
  cta: string;
  publishedAt?: string;
}

export type Language = 'es' | 'en';

export interface HubSettings {
  language: Language;
  startWithWindows: boolean;
  showNewsOnOpen: boolean;
  hideLocalApps: boolean;
  /** Accent base color as #rrggbb (Quorb-style picker). */
  accent: string;
  compact: boolean;
  /** Panel background opacity, 0-100 (%). */
  opacity: number;
  /** Panel background blur, 0-40 (px). */
  blur: number;
}

// Stored descriptors refer to the official catalog only.
export interface CatalogSource {
  id: string;
  label: string;
  kind: 'official';
  location?: string;
}

export interface NewsVisit {
  lastVisitAt: string;
  seenKeys: string[];
}

export interface StoredSettings extends HubSettings {
  firstRunComplete: boolean;
  sources: CatalogSource[];
  newsVisit?: NewsVisit | null;
}

export interface AutostartViewState {
  confirmed: boolean | null;
  busy: boolean;
  error: string | null;
  change: (value: boolean) => void;
  retry: () => void;
}

export interface CatalogViewProps {
  apps: HubApp[];
  state?: 'loading' | 'ready' | 'empty' | 'offline' | 'error';
  stale?: boolean;
  reason?: 'unconfigured' | 'response' | 'cache';
  installationKnown?: boolean;
  onRetry?: () => void;
  targetAppId?: string | null;
}

export interface NewsPopupProps {
  items: NewsItem[];
  open: boolean;
  onClose: () => void;
  /** "No mostrar al abrir" toggled. */
  onDontShowChange: (dontShow: boolean) => void;
  dontShow: boolean;
  stale?: boolean;
  onShown?: (item: NewsItem) => void;
  onCatalog?: (appId: string) => void;
}

export interface SettingsViewProps {
  settings: HubSettings;
  onChange: (next: HubSettings) => void;
  onClose: () => void;
  sources?: CatalogSource[];
  autostart?: AutostartViewState;
  languagePending?: boolean;
}

export interface FirstRunProps {
  onChoose: (language: Language) => void;
  onPreview?: (language: Language) => void;
}
