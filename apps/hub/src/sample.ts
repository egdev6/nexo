export type Integration = 'complete' | 'updates' | 'local' | 'catalog';

export interface HubApp {
  id: string;
  name: string;
  installed: boolean;
  running: boolean;
  integration: Integration;
  description: string;
  version?: string;
  update?: string;
  news?: 'Nuevo' | 'Destacada';
}

// Sample data only: replace with the catalog (#5) and hub IPC server (#4).
export const sampleApps: HubApp[] = [
  {
    id: 'antena', name: 'Antena', installed: true, running: true,
    integration: 'complete', version: '1.4.0', update: '1.5.0',
    description: 'Panel de control para directos · Integración completa con cierre limpio por plugin.',
  },
  {
    id: 'quorb', name: 'Quorb', installed: true, running: false,
    integration: 'updates', description: 'Aplicación egdev con actualizaciones.',
  },
  {
    id: 'obs', name: 'OBS Studio', installed: true, running: false,
    integration: 'local', description: 'App local · Solo apertura',
  },
  {
    id: 'pizarra', name: 'Pizarra', installed: false, running: false,
    integration: 'catalog', description: 'Disponible en el catálogo oficial.', news: 'Nuevo',
  },
  {
    id: 'cadencia', name: 'Cadencia', installed: false, running: false,
    integration: 'catalog', description: 'Disponible en el catálogo oficial.', news: 'Destacada',
  },
];
