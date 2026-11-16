import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Badge, Button, Checkbox, Icon, IconButton, ProgressBar, VisuallyHidden } from '@egdev/ui';
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
  const position = (current: number, total: number, label: string) =>
    t(locale, 'news.position', { current: formatNumber(locale, current), total: formatNumber(locale, total), label });
  // Official news arrives newest-first; the popup always shows at most four items.
  const displayed = items.slice(0, 4);
  const ids = JSON.stringify(displayed.map(item => item.id));
  const [selection, setSelection] = useState({ ids, index: 0 });
  if (selection.ids !== ids) setSelection({ ids, index: 0 });
  const selected = selection.ids === ids ? selection.index : 0;
  const [viewed, setViewed] = useState(() => new Set([...(seenKeys ?? []), ...(displayed[0] ? [displayed[0].id] : [])]));
  const current = displayed[selected];
  const cta = current?.cta === t('es', 'news.viewCatalog') ? t(locale, 'news.viewCatalog') : current?.cta;
  const titleId = useId();
  const checkboxId = useId();
  const trackId = useId();
  const instructionsId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const activeSlideRef = useRef<HTMLDivElement>(null);
  const focusSlide = useRef(false);
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

  useLayoutEffect(() => {
    if (focusSlide.current) {
      activeSlideRef.current?.focus({ preventScroll: true });
      focusSlide.current = false;
    }
  }, [selected, ids]);

  function select(index: number) {
    if (index < 0 || index >= displayed.length || index === selected) return;
    const focused = document.activeElement;
    focusSlide.current = !!activeSlideRef.current?.contains(focused) ||
      (focused === previousRef.current && index === 0) || (focused === nextRef.current && index === displayed.length - 1);
    setSelection({ ids, index });
    setViewed(previous => new Set(previous).add(displayed[index].id));
  }

  function onSliderKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    let index: number;
    switch (event.key) {
      case 'ArrowLeft': index = selected - 1; break;
      case 'ArrowRight': index = selected + 1; break;
      case 'Home': index = 0; break;
      case 'End': index = displayed.length - 1; break;
      default: return;
    }
    event.preventDefault();
    select(index);
  }

  function slideContent(item: NewsItem) {
    return <article className="news-slide">
      <NewsBanner key={item.appId} item={item} />
      <Badge tone="brand">{t(locale, item.badge === t('es', 'news.new') ? 'news.new' : item.badge === t('es', 'news.featured') ? 'news.featured' : 'news.update')}</Badge> {!viewed.has(item.id) && <Badge tone="brand">{t(locale, 'news.unseen')}</Badge>}<h3>{item.title}</h3><p>{item.text}</p>
    </article>;
  }

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
      <div className="news-carousel">
        {displayed.length === 0 ? <p>{t(locale, 'news.empty')}</p> : displayed.length === 1 ? slideContent(displayed[0]) :
          <div role="region" aria-roledescription="carousel" aria-label={t(locale, 'news.latest')} aria-describedby={instructionsId}
            tabIndex={0} onKeyDown={onSliderKeyDown}>
            <div className="news-carousel-header">
              <span className="news-carousel-label">{t(locale, 'news.latest')}</span>
              <div className="news-carousel-controls">
                <span className="news-carousel-counter" aria-hidden="true"><span>{String(selected + 1).padStart(2, '0')}</span> / {String(displayed.length).padStart(2, '0')}</span>
                <IconButton ref={previousRef} type="button" label={t(locale, 'news.previous')} variant="ghost" size="lg"
                  aria-controls={trackId} disabled={selected === 0} onClick={() => select(selected - 1)} icon={<Icon name="arrow-right" className="news-previous-icon" />} />
                <IconButton ref={nextRef} type="button" label={t(locale, 'news.next')} variant="ghost" size="lg"
                  aria-controls={trackId} disabled={selected === displayed.length - 1} onClick={() => select(selected + 1)} icon={<Icon name="arrow-right" />} />
              </div>
            </div>
            <div className="news-viewport"><div id={trackId} className="news-track" style={{ transform: `translateX(-${selected * 100}%)` }}>
              {displayed.map((item, index) => <div key={item.id} ref={index === selected ? activeSlideRef : undefined}
                className="news-slide-frame" role="group" aria-roledescription="slide" aria-label={position(index + 1, displayed.length, item.title)}
                aria-current={index === selected ? 'true' : undefined} aria-hidden={index === selected ? undefined : true}
                inert={index !== selected} tabIndex={index === selected ? 0 : -1}>{slideContent(item)}</div>)}
            </div></div>
            <ProgressBar className="news-progress" value={100 * (selected + 1) / displayed.length} size="sm" />
            <div className="news-indicators" role="group" aria-label={t(locale, 'news.selectSlide')}>
              {displayed.map((item, index) => <IconButton key={item.id} type="button" className="news-indicator" size="sm" variant="ghost"
                label={t(locale, 'news.goTo', { position: position(index + 1, displayed.length, item.title) })}
                aria-current={index === selected ? 'true' : undefined} onClick={() => select(index)}
                icon={<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" /></svg>} />)}
            </div>
            <VisuallyHidden id={instructionsId}>{t(locale, 'news.instructions')}</VisuallyHidden>
            <VisuallyHidden role="status" aria-atomic="true">{current && position(selected + 1, displayed.length, current.title)}</VisuallyHidden>
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
