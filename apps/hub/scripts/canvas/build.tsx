import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import App from '../../src/App';
import { defaultSettings } from '../../src/sample';
import type { HubApp, NewsItem } from '../../src/model';
import type { Catalog } from '../../src/catalog/format';
import type { InstallProgress } from '../../src/catalog/install';

// The same IPC boundaries used by the hub tests; all rendered views and controls are real.
const bridge = vi.hoisted(() => ({
  receive: undefined as undefined | ((progress: InstallProgress) => void),
  saved: undefined as any,
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: async (command: string, args?: any) => {
  if (command === 'get_settings') return { state: 'ready', settings: bridge.saved };
  if (command === 'save_settings') { bridge.saved = { ...bridge.saved, ...args?.patch }; return bridge.saved; }
  if (command === 'plugin:autostart|is_enabled') return true;
  if (command === 'get_flyout_state') return { visible: true, sequence: 1, cycle: 1, at: '2026-11-15T10:42:00.000Z' };
  if (command === 'get_flyout_motion') return { phase: 'open', sequence: 1 };
  if (command === 'local_apps_list') return [
    { id: 'local:manual:obs', source: 'local', name: 'OBS Studio', state: 'ready', origin: { kind: 'manual', id: 'obs' } },
    { id: 'local:manual:antena', source: 'local', name: 'Antena local', state: 'ready', origin: { kind: 'manual', id: 'antena' }, duplicateOf: 'antena' },
    { id: 'local:manual:editor', source: 'local', name: 'Editor de vídeo', state: 'missingExecutable', origin: { kind: 'manual', id: 'editor' } },
  ];
  if (command === 'local_catalog_refresh') throw 'nexo.local.catalogUnreadable';
  if (command === 'local_app_icon' || command === 'apply_saved_language') return null;
  throw new Error(`Unexpected canvas bridge command: ${command}`);
} }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('../../src/shell/registry', () => ({
  subscribeRegistry: async (publish: (snapshot: unknown) => void) => {
    publish({ revision: 1, apps: [{ app: { id: 'quorb', name: 'Quorb', version: '1.2.0' }, capabilities: ['show', 'quit'], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] });
    return () => {};
  },
  exitHubOnly: async () => {},
}));
vi.mock('../../src/window', () => ({ backdropAvailable: async () => false, hideFlyout: async () => {} }));
vi.mock('../../src/catalog/install', () => ({
  onInstallProgress: async (receive: (progress: InstallProgress) => void) => { bridge.receive = receive; return () => {}; },
  installApp: () => new Promise(() => {}),
  updateApp: () => new Promise(() => {}),
  cancelInstall: async () => 'cancelled',
}));

const sources = [
  { id: 'official', label: 'Catálogo oficial egdev', kind: 'official' as const },
  { id: 'local-1', label: 'Catálogo de trabajo', kind: 'local' as const, location: 'C:\\Nexo\\catalogo.json' },
];
const apps: HubApp[] = [
  { id: 'antena', name: 'Antena', description: 'Panel de control para directos.', installed: true, running: false, integration: 'complete', source: 'official', statusKnown: true, installationState: 'installed', version: '1.4.0', canOpen: true },
  { id: 'quorb', name: 'Quorb', description: 'Tu espacio personalizable.', installed: true, running: false, integration: 'complete', source: 'official', statusKnown: true, installationState: 'installed', version: '1.2.0', canOpen: true },
  { id: 'pizarra', name: 'Pizarra', description: 'Organiza tus ideas.', tagline: 'Tus ideas de un vistazo.', tags: ['Ideas', 'Organización'], installed: false, running: false, integration: 'catalog', source: 'official', statusKnown: true, installationState: 'notInstalled' },
  { id: 'cadencia', name: 'Cadencia', description: 'Planifica tus proyectos.', tagline: 'Da ritmo a tus proyectos.', tags: ['Planificación'], installed: false, running: false, integration: 'catalog', source: 'official', statusKnown: true, installationState: 'notInstalled' },
  { id: 'archivo', name: 'Archivo', description: 'Organiza tus recursos.', tagline: 'Todos tus recursos a mano.', tags: ['Recursos'], installed: false, running: false, integration: 'catalog', source: 'official', statusKnown: true, installationState: 'notInstalled' },
];
const catalog: Catalog = {
  schemaVersion: 3,
  apps: apps.map(app => ({ id: app.id, name: app.name, tagline: app.tagline ?? app.description, description: app.description, tags: app.tags ?? [], integrationLevel: 'full' as const,
    installerUrl: '', latestJsonUrl: '', releasedAt: '2026-11-01T12:00:00Z', featured: false,
    version: app.id === 'antena' ? '1.5.0' : '1.0.0', updaterPublicKey: app.id === 'archivo' ? undefined : 'validated-fixture-key',
    news: app.id === 'antena' ? [{ id: 'antena-15', title: 'Antena 1.5', text: 'Mejoras de estabilidad y control para tus directos.', publishedAt: '2026-11-14T12:00:00Z', kind: 'update' as const }] : [],
  })),
};
const news: NewsItem[] = [
  { id: 'antena-news', appId: 'antena', badge: 'Actualización', title: 'Antena 1.5', text: 'Más control y estabilidad para tus directos.', cta: 'Ver en el catálogo' },
  { id: 'pizarra-news', appId: 'pizarra', badge: 'Nuevo', title: 'Pizarra', text: 'Organiza tus ideas desde el catálogo.', cta: 'Ver en el catálogo' },
  { id: 'cadencia-news', appId: 'cadencia', badge: 'Destacada', title: 'Cadencia', text: 'Planifica tus proyectos a tu ritmo.', cta: 'Ver en el catálogo' },
];
const root = resolve('../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
// Embed the same WOFF2 sources and font-face declarations as the application.
const fontPath = resolve(root, 'apps/hub/src/fonts.css');
const fontSheet = postcss.parse(readFileSync(fontPath, 'utf8'), { from: fontPath });
let fontCount = 0;
fontSheet.walkAtRules('font-face', face => face.walkDecls('src', declaration => {
  const match = declaration.value.match(/^url\((['"]?)(@fontsource\/[a-z-]+\/files\/[a-z0-9-]+\.woff2)\1\)\s*format\(['"]woff2['"]\)$/);
  if (!match) throw new Error('Expected exactly one bundled WOFF2 font source');
  const data = readFileSync(resolve(root, 'apps/hub/node_modules', match[2])).toString('base64');
  declaration.value = `url(data:font/woff2;base64,${data}) format('woff2')`;
  fontCount += 1;
}));
if (!fontCount) throw new Error('No bundled font faces found');
const fontCss = fontSheet.toString();
const appIcon = read('apps/hub/src-tauri/app-icon.svg');
const trayIcon = read('design/nexo-logo/tray.svg');
const contrastCss = read('apps/hub/scripts/canvas/egdev-family-contrast.css');
const cssPaths = [
  'apps/hub/node_modules/@egdev/tokens/dist/tokens.css', 'apps/hub/node_modules/@egdev/ui/dist/styles.css',
  'apps/hub/src/style.css', 'apps/hub/src/catalog/catalog.css', 'apps/hub/src/news/news.css',
  'apps/hub/src/settings/settings.css', 'apps/hub/src/first-run/first-run.css',
];
const width = JSON.parse(read('apps/hub/src-tauri/tauri.conf.json')).app.windows.find((window: any) => window.label === 'main').width as number;
// The flyout is flush with the right edge and fills the work area height (position.rs); fail if that changes.
const position = read('apps/hub/src-tauri/src/position.rs');
if (!/y: area\.y,/.test(position) || !/height: area\.height,/.test(position)) throw new Error('Cannot determine flyout placement from position.rs');
const margin = 0;
const boardWidth = 786;
const boardHeight = 1080;
const taskbarHeight = 48;
const flyoutHeight = boardHeight - taskbarHeight - margin * 2;

function cssUnescape(value: string) {
  return value.replace(/\\([\da-fA-F]{1,6}\s?|.)/g, (_, escaped: string) => /^[\da-fA-F]/.test(escaped) ? String.fromCodePoint(parseInt(escaped.trim(), 16)) : escaped);
}
function prunedCss(html: string) {
  // Keep element/attribute selectors, nested rules and keyframes conservatively.
  const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap(match => match[1].split(/\s+/)));
  return cssPaths.map(path => {
    const sheet = postcss.parse(read(path), { from: path });
    sheet.walkComments(comment => comment.remove());
    sheet.walkRules(rule => {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
      const selectors = rule.selectors.filter(selector => {
        if (selector.includes('[') || selector.includes(':root') || selector.includes(':host')) return true;
        const found = [...selector.matchAll(/\.((?:\\[\da-fA-F]{1,6}\s?|\\.|[\w-])+)/g)].map(match => cssUnescape(match[1]));
        return found.length === 0 || found.some(name => classes.has(name));
      });
      if (!selectors.length) rule.remove();
      else rule.selectors = selectors;
    });
    return `/* ${path.replace('apps/hub/', '')} */\n${sheet.toString()}`;
  }).join('\n');
}

const bannerPlaceholder = '<svg viewBox="0 0 16 9" preserveAspectRatio="none"><defs><linearGradient id="canvas-banner" x2="1" y2="1"><stop offset="0" stop-color="#3a2a30"/><stop offset="1" stop-color="#16171b"/></linearGradient></defs><rect width="16" height="9" fill="url(#canvas-banner)"/></svg>';

function capture() {
  const original = document.querySelector('main.flyout');
  if (!original) throw new Error('Flyout did not render');
  const copy = original.cloneNode(true) as HTMLElement;
  for (const image of copy.querySelectorAll('img')) {
    if (!image.classList.contains('n-mark') && !image.classList.contains('news-mark')) {
      // Remote catalog banners would break the self-contained capture; keep their box with an inline placeholder.
      if (!/^https?:/.test(image.getAttribute('src') ?? '')) throw new Error(`Unexpected image in canvas fixture: ${image.getAttribute('src')}`);
      const banner = new DOMParser().parseFromString(bannerPlaceholder, 'image/svg+xml').documentElement;
      banner.setAttribute('class', image.className);
      banner.setAttribute('aria-hidden', 'true');
      image.replaceWith(document.importNode(banner, true));
      continue;
    }
    const svg = new DOMParser().parseFromString(appIcon, 'image/svg+xml').documentElement;
    svg.setAttribute('class', image.className);
    svg.setAttribute('aria-hidden', 'true');
    image.replaceWith(document.importNode(svg, true));
  }
  // External links keep their look but must not point outside the self-contained capture.
  for (const link of copy.querySelectorAll('a[href^="http"]')) link.setAttribute('href', '#');
  return copy.outerHTML;
}
function selectTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}
async function mount(firstRun = false, withNews = false) {
  cleanup();
  bridge.receive = undefined;
  bridge.saved = { ...defaultSettings, firstRunComplete: !firstRun, showNewsOnOpen: withNews, startWithWindows: true, sources };
  render(<App apps={apps} news={withNews ? news : []} catalogState={{ status: 'ready', catalog }} onAppsRefresh={() => {}} />);
  await waitFor(() => {
    if (!document.querySelector('.flyout')) throw new Error('Waiting for flyout');
    if (firstRun ? !screen.queryByRole('button', { name: 'Continuar' }) : !screen.queryByRole('button', { name: 'Ajustes', hidden: true })) throw new Error('Waiting for settings');
  });
  if (!firstRun) await waitFor(() => { if (!screen.queryByText('OBS Studio') || !bridge.receive) throw new Error('Waiting for local apps and progress'); });
}

const trayGlyph = (paths: string) => `<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
function wrap(title: string, flyout: string) {
  const css = `${fontCss}\n${prunedCss(flyout)}`;
  if (/https?:\/\//.test(css)) throw new Error('Unexpected URL in inlined CSS');
  const frameCss = `
.desktop { position: relative; width: ${boardWidth}px; height: ${boardHeight}px; overflow: hidden; background: radial-gradient(ellipse at 35% 20%, #687d8e 0%, transparent 47%), radial-gradient(ellipse at 90% 75%, #526775 0%, transparent 48%), linear-gradient(135deg, #273f50, #667887 55%, #293d4c); }
#root.win-frame { position: absolute; top: ${margin}px; right: ${margin}px; width: ${width}px; height: ${flyoutHeight}px; border-radius: 8px; box-shadow: 0 16px 48px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.13); }
.win-frame .flyout { border-radius: 8px; }
.win-taskbar { position: absolute; bottom: 0; left: 0; right: 0; height: ${taskbarHeight}px; display: flex; justify-content: flex-end; align-items: center; gap: 14px; padding: 0 18px; background: rgba(31,36,42,.9); border-top: 1px solid rgba(255,255,255,.12); color: #fff; font: 12px/1.2 'Segoe UI', sans-serif; }
.win-taskbar svg { width: 16px; height: 16px; flex: none; }
.win-clock { text-align: right; line-height: 1.4; font-variant-numeric: tabular-nums; }
`;
  return `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Nexo</title><style>\n${css}\n${frameCss}\n${contrastCss}</style></head><body><div class="desktop"><div id="root" class="win-frame">${flyout}</div><div class="win-taskbar" aria-label="Barra de tareas de Windows">${trayGlyph('<path d="m6 12 4-4 4 4"/>')}${trayIcon}${trayGlyph('<path d="M2 8c4-4 12-4 16 0M5 11c3-3 7-3 10 0M8 14c1-1 3-1 4 0M10 17h.01"/>')}${trayGlyph('<path d="M3 8h3l4-3v10l-4-3H3zM13 7c2 2 2 4 0 6M15 5c3 3 3 7 0 10"/>')}<div class="win-clock">11:42<br>15/11/2026</div></div></div></body></html>\n`;
}

export async function buildArtboards(): Promise<{ file: string; html: string }[]> {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  await mount();
  // Cards start collapsed and only one stays open; open the app with an update so its notes show.
  for (const name of ['Antena']) {
    const trigger = [...document.querySelectorAll<HTMLElement>('.app-card [aria-expanded="false"]')].find(item => item.querySelector('strong')?.textContent === name);
    if (!trigger) throw new Error(`Missing collapsed app card: ${name}`);
    fireEvent.click(trigger);
  }
  const myApps = capture();
  selectTab('Catálogo');
  await waitFor(() => { if ((screen.getByRole('button', { name: 'Instalar Cadencia' }) as HTMLButtonElement).disabled) throw new Error('Waiting for installation connection'); });
  fireEvent.click(screen.getByRole('button', { name: 'Instalar Cadencia' }));
  act(() => bridge.receive!({ id: 'cadencia', phase: 'downloading', received: 60, total: 100 }));
  const catalogue = capture();
  await mount(false, true);
  await screen.findByRole('dialog', { name: 'Novedades' });
  const newsBoard = capture();
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  await screen.findByRole('switch', { name: 'Iniciar con Windows' });
  const snapshots: Record<string, string> = { general: capture() };
  selectTab('Apariencia'); snapshots.appearance = capture();
  selectTab('Apps locales');
  await waitFor(() => { if (!screen.queryByText('Editor de vídeo')) throw new Error('Waiting for local apps'); });
  snapshots.localApps = capture();
  selectTab('Acerca de'); snapshots.about = capture();
  await mount(true);
  const firstRun = capture();
  cleanup();
  vi.unstubAllGlobals();
  return [
    { file: '01-mis-apps.html', html: wrap('Mis apps', myApps) },
    { file: '02-catalogo.html', html: wrap('Catálogo', catalogue) },
    { file: '03-novedades.html', html: wrap('Novedades', newsBoard) },
    { file: '04a-ajustes-general.html', html: wrap('Ajustes · General', snapshots.general) },
    { file: '04b-ajustes-apariencia.html', html: wrap('Ajustes · Apariencia', snapshots.appearance) },
    { file: '04c-ajustes-apps-locales.html', html: wrap('Ajustes · Apps locales', snapshots.localApps) },
    { file: '04d-ajustes-acerca-de.html', html: wrap('Ajustes · Acerca de', snapshots.about) },
    { file: '05-primer-uso.html', html: wrap('Primer uso', firstRun) },
  ];
}
