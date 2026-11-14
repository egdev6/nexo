import type { HubApp, HubSettings, NewsItem } from './model';

// Sample data only: replace with the catalog (#5) and hub IPC server (#4).
// The discovery URLs are illustrative, not verified product destinations.
export const sampleApps: HubApp[] = [
  {
    id: 'antena', name: 'Antena', installed: true, running: true,
    integration: 'complete', version: '1.4.0', update: '1.5.0',
    description: 'Panel de control para directos · Integración completa con cierre limpio por plugin.',
    tagline: 'Tu centro de control para directos.', tags: ['Directos', 'Control'],
    links: { github: 'https://github.com/egdev6/antena', youtube: 'https://www.youtube.com/@egdev' },
  },
  {
    id: 'quorb', name: 'Quorb', installed: true, running: false,
    integration: 'updates', description: 'Aplicación egdev con actualizaciones.',
    tagline: 'Tu espacio personalizable.', tags: ['Escritorio', 'Personalización'],
    links: { github: 'https://github.com/egdev6/quorb', youtube: 'https://www.youtube.com/@egdev' },
  },
  {
    id: 'obs', name: 'OBS Studio', installed: true, running: false,
    integration: 'local', description: 'App local · Solo apertura',
  },
  {
    id: 'pizarra', name: 'Pizarra', installed: false, running: false,
    integration: 'catalog', description: 'Disponible en el catálogo oficial.',
    tagline: 'Organiza tus ideas de un vistazo.', tags: ['Ideas', 'Organización'],
    links: { github: 'https://github.com/egdev6/pizarra', youtube: 'https://www.youtube.com/@egdev' },
  },
  {
    id: 'cadencia', name: 'Cadencia', installed: false, running: false,
    integration: 'catalog', description: 'Disponible en el catálogo oficial.',
    tagline: 'Da ritmo a tus proyectos.', tags: ['Planificación', 'Flujo'],
    links: { github: 'https://github.com/egdev6/cadencia', youtube: 'https://www.youtube.com/@egdev' },
  },
];

export const sampleNews: NewsItem[] = [
  { id: 'pizarra-news', appId: 'pizarra', badge: 'Nuevo', title: 'Pizarra', text: 'Disponible en el catálogo oficial.', cta: 'Ver en el catálogo' },
  { id: 'cadencia-news', appId: 'cadencia', badge: 'Destacada', title: 'Cadencia', text: 'Disponible en el catálogo oficial.', cta: 'Ver en el catálogo' },
];

// In-memory preview only; persistence belongs to #16.
export const defaultSettings: HubSettings = {
  language: 'es', startWithWindows: false, showNewsOnOpen: true,
  accent: '#ff0036', compact: false, opacity: 85, blur: 24,
};
