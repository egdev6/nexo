import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Badge, Button, Carousel, Checkbox, Icon, IconButton } from '@egdev/ui';
import type { NewsItem, NewsPopupProps } from '../model';
import { catalogBannerUrl } from '../catalog';
import { formatNumber, t } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import nexoLogo from '../../src-tauri/app-icon.svg';
import './news.css';

const focusableSelector = 'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = NewsPopupProps & { seenKeys?: ReadonlySet<string> };
type SlideItem = NewsItem & { appName?: string };

function NewsBanner({ item }: { item: SlideItem }) {
  const banner = catalogBannerUrl(item.appId);
  const [failed, setFailed] = useState(false);
  return <div className="news-hero" aria-hidden="true">
    {banner && !failed ? <img src={banner} alt="" onError={() => setFailed(true)} /> :
      <span className="catalog-initial">{(item.appName ?? item.title).trim().charAt(0).toUpperCase()}</span>}
  </div>;
}

function OpenNews({ items, onClose, dontShow, onDontShowChange, onShown, onCatalog, stale, seenKeys }: Omit<Props, 'open'>) {
  const locale = useLocale();
  const messages = {
    previousSlide: t(locale, 'news.previous'), nextSlide: t(locale, 'news.next'),
    carousel: t(locale, 'news.carousel'), slide: t(locale, 'news.slide'), empty: t(locale, 'news.empty'),
    instructions: t(locale, 'news.instructions'),
    position: (current: number, total: number, label: string) => t(locale, 'news.position', { current: formatNumber(locale, current), total: formatNumber(locale, total), label }),
  };
  // Official news arrives newest-first; the popup always shows at most four items.
  const displayed = items.slice(0, 4);
  const [selected, setSelected] = useState(displayed[0]?.id);
  const [viewed, setViewed] = useState(() => new Set([...(seenKeys ?? []), ...(displayed[0] ? [displayed[0].id] : [])]));
  const current = displayed.find(item => item.id === selected) ?? displayed[0];
  const cta = current?.cta === t('es', 'news.viewCatalog') ? t(locale, 'news.viewCatalog') : current?.cta;
  const titleId = useId();
  const checkboxId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const suspendedSelection = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const onShownRef = useRef(onShown);
  onCloseRef.current = onClose;
  onShownRef.current = onShown;

  useLayoutEffect(() => {
    if (current) {
      onShownRef.current?.(current);
      setViewed(previous => previous.has(current.id) ? previous : new Set(previous).add(current.id));
    }
  }, [current?.id]);

  function select(value: string) {
    if (suspendedSelection.current) return;
    setSelected(value);
    setViewed(previous => new Set(previous).add(value));
  }

  function slideContent(item: NewsItem) {
    return <article className="news-slide">
      <NewsBanner key={item.appId} item={item} />
      <Badge tone="brand">{t(locale, item.badge === t('es', 'news.new') ? 'news.new' : item.badge === t('es', 'news.featured') ? 'news.featured' : 'news.update')}</Badge> {!viewed.has(item.id) && <Badge tone="brand">{t(locale, 'news.unseen')}</Badge>}<h3>{item.title}</h3><p>{item.text}</p>
    </article>;
  }

  // A hidden WebView can queue a scroll before layout; do not let it select a slide
  // after the track reappears. Restore the controlled slide before accepting input.
  useLayoutEffect(() => {
    const root = carouselRef.current;
    const track = root?.querySelector<HTMLElement>('.eg-carousel > .overflow-x-auto');
    if (!root || !track) return;
    const hasLayout = () => track.clientWidth > 0 && track.getBoundingClientRect().width > 0;
    let awaitingLayout = !hasLayout();
    const align = () => {
      if (!awaitingLayout || !hasLayout()) return;
      const active = track.querySelector<HTMLElement>('[role="group"][aria-current="true"]');
      if (!active) return;
      const viewport = track.getBoundingClientRect();
      const slide = active.getBoundingClientRect();
      if (!slide.width) return;
      awaitingLayout = false;
      suspendedSelection.current = false;
      const distance = (slide.left + slide.right - viewport.left - viewport.right) / 2;
      if (distance) track.scrollBy?.({ left: distance, behavior: 'instant' });
    };
    const suspend = () => { awaitingLayout = true; suspendedSelection.current = true; };
    const onResize = () => {
      if (!hasLayout()) suspend();
      else align();
    };
    const onScroll = (event: Event) => {
      if (!hasLayout()) suspend();
      if (!awaitingLayout) return;
      event.stopImmediatePropagation();
      align();
    };
    track.addEventListener('scroll', onScroll, true);
    track.addEventListener('scrollend', onScroll, true);
    root.addEventListener('pointerdown', align, true);
    root.addEventListener('click', align, true);
    root.addEventListener('keydown', align, true);
    root.addEventListener('wheel', align, true);
    window.addEventListener('resize', onResize);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onResize);
    observer?.observe(track);
    return () => {
      track.removeEventListener('scroll', onScroll, true);
      track.removeEventListener('scrollend', onScroll, true);
      root.removeEventListener('pointerdown', align, true);
      root.removeEventListener('click', align, true);
      root.removeEventListener('keydown', align, true);
      root.removeEventListener('wheel', align, true);
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
      suspendedSelection.current = false;
    };
  }, [displayed.length === 1]);

  // DialogContent is body-portalled; this modal must stay inside the positioned panel.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const dialog = dialogRef.current;
    if (!layer || !dialog) return;
    const panel = layer.parentElement;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = Array.from(panel?.children ?? []).filter(element => element !== layer);
    const wasInert = siblings.map(element => element.hasAttribute('inert'));
    siblings.forEach(element => element.setAttribute('inert', ''));
    const focusClose = () => closeRef.current?.focus({ preventScroll: true });
    focusClose();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        const stops = Array.from(dialog!.querySelectorAll<HTMLElement>(focusableSelector))
          .filter(element => !element.closest('[hidden], [inert], [aria-hidden="true"]'));
        if (!stops.length) { event.preventDefault(); dialog!.focus(); return; }
        const index = stops.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); stops[stops.length - 1].focus(); }
        else if (!event.shiftKey && (index === -1 || index === stops.length - 1)) { event.preventDefault(); stops[0].focus(); }
      }
    }
    function onFocusIn(event: FocusEvent) {
      if (!dialog!.contains(event.target as Node)) focusClose();
    }
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      siblings.forEach((element, index) => { if (!wasInert[index]) element.removeAttribute('inert'); });
      if (previous && previous !== document.body && previous.isConnected && !previous.closest('[inert], [hidden]')) {
        previous.focus({ preventScroll: true });
      } else {
        panel?.querySelector<HTMLElement>(focusableSelector)?.focus({ preventScroll: true });
      }
    };
  }, []);

  return <div className="news-overlay" ref={layerRef}>
    <div className="news-scrim" aria-hidden="true" />
    <section className="news-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="news-header"><img className="news-mark" src={nexoLogo} alt="" /><h2 id={titleId}>{t(locale, 'news.title')}</h2>
        <IconButton ref={closeRef} type="button" label={t(locale, 'news.close')} title={t(locale, 'news.close')} variant="secondary" size="sm" icon={<Icon name="close" />} onClick={onClose} />
      </header>
      {stale && <p role="status">{t(locale, 'catalog.stale')}</p>}
      <div className="news-carousel" ref={carouselRef}>
        {displayed.length === 1 ? slideContent(displayed[0]) : <Carousel label={t(locale, 'news.latest')} messages={messages} value={current?.id} onValueChange={select}
          items={displayed.map(item => ({ value: item.id, label: item.title, children: slideContent(item) }))} />}
        {displayed.length > 1 && <div className="news-indicators" role="group" aria-label={t(locale, 'news.selectSlide')}>
          {displayed.map((item, index) => <IconButton key={item.id} type="button" className="news-indicator" size="sm" variant="ghost"
            label={t(locale, 'news.goTo', { position: messages.position(index + 1, displayed.length, item.title) })}
            aria-current={current?.id === item.id ? 'true' : undefined} onClick={() => select(item.id)}
            icon={<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" /></svg>} />)}
        </div>}
      </div>
      {current && <div className="news-action"><Button type="button" size="sm" variant="primary" data-app-id={current.appId}
        aria-label={t(locale, onCatalog ? 'news.catalogCta' : 'news.sampleCta', { cta: cta ?? '', title: current.title })} title={onCatalog ? undefined : t(locale, 'news.sampleAction')}
        onClick={() => onCatalog?.(current.appId)}>{cta}</Button>
        {!onCatalog && <span>{t(locale, 'news.sampleAction')}</span>}</div>}
      <div className="news-preference"><Checkbox id={checkboxId} checked={dontShow} onCheckedChange={value => onDontShowChange(value === true)} />
        <label htmlFor={checkboxId}>{t(locale, 'news.dontShow')}</label></div>
    </section>
  </div>;
}

export function NewsPopup({ open, ...props }: Props) {
  return open ? <OpenNews {...props} /> : null;
}
