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
}

export interface NewsItem {
  id: string;
  appId: string;
  badge: 'Nuevo' | 'Destacada' | 'Actualización';
  title: string;
  text: string;
  cta: string;
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

// #16 stores and displays descriptors; #9 owns creation and consumption.
export interface CatalogSource {
  id: string;
  label: string;
  kind: 'official' | 'local';
  location?: string;
}

export interface StoredSettings extends HubSettings {
  firstRunComplete: boolean;
  sources: CatalogSource[];
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
  sources?: CatalogSource[];
  autostart?: AutostartViewState;
}

export interface FirstRunProps {
  onChoose: (language: Language) => void;
}
