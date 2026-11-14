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
  /** When false, installed/running are compatibility placeholders, not observed state. */
  statusKnown?: boolean;
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
  /** Accent base color as #rrggbb (Quorb-style picker). */
  accent: string;
  compact: boolean;
  /** Panel background opacity, 0-100 (%). */
  opacity: number;
  /** Panel background blur, 0-40 (px). */
  blur: number;
}

export interface CatalogViewProps {
  apps: HubApp[];
  state?: 'loading' | 'ready' | 'empty' | 'offline' | 'error';
  stale?: boolean;
  reason?: 'unconfigured' | 'response' | 'cache';
  installationKnown?: boolean;
  onRetry?: () => void;
}

export interface NewsPopupProps {
  items: NewsItem[];
  open: boolean;
  onClose: () => void;
  /** "No mostrar al abrir" toggled. */
  onDontShowChange: (dontShow: boolean) => void;
  dontShow: boolean;
}

export interface SettingsViewProps {
  settings: HubSettings;
  onChange: (next: HubSettings) => void;
  onClose: () => void;
}

export interface FirstRunProps {
  onChoose: (language: Language) => void;
}
