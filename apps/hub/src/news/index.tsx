import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AppIcon, Badge, Button, Carousel, Checkbox, Field, Icon, IconButton, VisuallyHidden } from '@egdev/ui';
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
      <AppIcon size="lg" monogram={(item.appName ?? item.title).trim().charAt(0).toUpperCase()} />}
  </div>;
}

function OpenNews({ items, onClose, dontShow, onDontShowChange, onShown, onCatalog, stale, seenKeys }: Omit<Props, 'open'>) {
  const locale = useLocale();
  const position = (current: number, total: number, label: string) =>
    t(locale, 'news.position', { current: formatNumber(locale, current), total: formatNumber(locale, total), label });
  const messages = {
    previousSlide: t(locale, 'news.previous'), nextSlide: t(locale, 'news.next'),
    carousel: t(locale, 'news.carousel'), slide: t(locale, 'news.slide'), empty: t(locale, 'news.empty'),
    instructions: t(locale, 'news.instructions'), position,
  };
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
  const instructionsId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
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

  function select(index: number) {
    if (index < 0 || index >= displayed.length || index === selected) return;
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

  function slideContent(item: NewsItem, active = true) {
    return <article className="news-slide" aria-hidden={active ? undefined : true} inert={!active}>
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
            <Carousel label={t(locale, 'news.latest')} trackLayout="full-width" messages={messages} value={current?.id}
              onValueChange={value => select(displayed.findIndex(item => item.id === value))}
              items={displayed.map((item, index) => ({ value: item.id, label: item.title, children: slideContent(item, index === selected) }))} />
            <div className="news-indicators" role="group" aria-label={t(locale, 'news.selectSlide')}>
              {displayed.map((item, index) => <IconButton key={item.id} type="button" className="news-indicator" size="sm" variant="ghost"
                label={t(locale, 'news.goTo', { position: position(index + 1, displayed.length, item.title) })}
                aria-current={index === selected ? 'true' : undefined} onClick={() => select(index)}
                icon={<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" /></svg>} />)}
            </div>
            <VisuallyHidden id={instructionsId}>{t(locale, 'news.instructions')}</VisuallyHidden>
          </div>}
      </div>
      {current && <div className="news-action"><Button type="button" size="sm" variant="primary" data-app-id={current.appId}
        aria-label={t(locale, onCatalog ? 'news.catalogCta' : 'news.sampleCta', { cta: cta ?? '', title: current.title })} title={onCatalog ? undefined : t(locale, 'news.sampleAction')}
        onClick={() => onCatalog?.(current.appId)}>{cta}</Button>
        {!onCatalog && <span>{t(locale, 'news.sampleAction')}</span>}</div>}
      <div className="news-preference"><Field layout="choice" label={t(locale, 'news.dontShow')}>
        <Checkbox id={checkboxId} checked={dontShow} onCheckedChange={value => onDontShowChange(value === true)} />
      </Field></div>
    </section>
  </div>;
}

export function NewsPopup({ open, ...props }: Props) {
  return open ? <OpenNews {...props} /> : null;
}
