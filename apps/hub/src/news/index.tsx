import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Badge, Button, Carousel, Checkbox, Icon, IconButton } from '@egdev/ui';
import type { NewsPopupProps } from '../model';
import { formatNumber, t } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import nexoLogo from '../../src-tauri/app-icon.svg';
import './news.css';

const focusableSelector = 'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function OpenNews({ items, onClose, dontShow, onDontShowChange, onShown, onCatalog, stale }: Omit<NewsPopupProps, 'open'>) {
  const locale = useLocale();
  const messages = {
    previousSlide: t(locale, 'news.previous'), nextSlide: t(locale, 'news.next'),
    carousel: t(locale, 'news.carousel'), slide: t(locale, 'news.slide'), empty: t(locale, 'news.empty'),
    instructions: t(locale, 'news.instructions'),
    position: (current: number, total: number, label: string) => t(locale, 'news.position', { current: formatNumber(locale, current), total: formatNumber(locale, total), label }),
  };
  const [selected, setSelected] = useState(items[0]?.id);
  const [viewed, setViewed] = useState(() => new Set(items[0] ? [items[0].id] : []));
  const current = items.find(item => item.id === selected) ?? items[0];
  const cta = current?.cta === t('es', 'news.viewCatalog') ? t(locale, 'news.viewCatalog') : current?.cta;
  const titleId = useId();
  const checkboxId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const onShownRef = useRef(onShown);
  onCloseRef.current = onClose;
  onShownRef.current = onShown;

  useLayoutEffect(() => {
    if (current) onShownRef.current?.(current);
  }, [current?.id]);

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
        <Carousel label={t(locale, 'news.latest')} messages={messages} value={current?.id} onValueChange={value => {
          setSelected(value);
          setViewed(previous => new Set(previous).add(value));
        }}
          items={items.map(item => ({ value: item.id, label: item.title, children: <article className="news-slide">
            <div className="news-hero" aria-hidden="true"><div className="news-hero-window"><span>{item.title.trim().charAt(0).toUpperCase()}</span><i /><i /><i /></div></div>
            <Badge tone="brand">{t(locale, item.badge === t('es', 'news.new') ? 'news.new' : item.badge === t('es', 'news.featured') ? 'news.featured' : 'news.update')}</Badge> {!viewed.has(item.id) && <Badge tone="brand">{t(locale, 'news.unseen')}</Badge>}<h3>{item.title}</h3><p>{item.text}</p>
          </article> }))} />
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

export function NewsPopup({ open, ...props }: NewsPopupProps) {
  return open ? <OpenNews {...props} /> : null;
}
