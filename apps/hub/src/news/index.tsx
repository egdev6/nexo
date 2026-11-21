import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AppIcon, Badge, Button, Carousel, Checkbox, Dialog, DialogContent, Field, VisuallyHidden } from '@egdev/ui';
import type { NewsItem, NewsPopupProps } from '../model';
import { catalogBannerUrl } from '../catalog';
import { formatNumber, t } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import './news.css';

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = NewsPopupProps & { seenKeys?: ReadonlySet<string> };
type SlideItem = NewsItem & { appName?: string };

function NewsBanner({ item }: { item: SlideItem }) {
  const banner = catalogBannerUrl(item.appId);
  const [failed, setFailed] = useState(false);
  return (
    <div className="news-hero" aria-hidden="true">
      {banner && !failed ? (
        <img src={banner} alt="" onError={() => setFailed(true)} />
      ) : (
        <AppIcon size="lg" monogram={(item.appName ?? item.title).trim().charAt(0).toUpperCase()} />
      )}
    </div>
  );
}

function OpenNews({ items, onClose, dontShow, onDontShowChange, onShown, onCatalog, stale, seenKeys }: Omit<Props, 'open'>) {
  const locale = useLocale();
  const position = (current: number, total: number, label: string) =>
    t(locale, 'news.position', { current: formatNumber(locale, current), total: formatNumber(locale, total), label });
  const messages = {
    previousSlide: t(locale, 'news.previous'),
    nextSlide: t(locale, 'news.next'),
    carousel: t(locale, 'news.carousel'),
    slide: t(locale, 'news.slide'),
    empty: t(locale, 'news.empty'),
    instructions: t(locale, 'news.instructions'),
    position,
  };
  // Official news arrives newest-first; the popup always shows at most four items.
  const displayed = items.slice(0, 4);
  const ids = JSON.stringify(displayed.map((item) => item.id));
  const [selection, setSelection] = useState({ ids, index: 0 });
  if (selection.ids !== ids) setSelection({ ids, index: 0 });
  const selected = selection.ids === ids ? selection.index : 0;
  const [viewed, setViewed] = useState(() => new Set([...(seenKeys ?? []), ...(displayed[0] ? [displayed[0].id] : [])]));
  const current = displayed[selected];
  const cta = current?.cta === t('es', 'news.viewCatalog') ? t(locale, 'news.viewCatalog') : current?.cta;
  const checkboxId = useId();
  const instructionsId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  // The dialog focuses the carousel on open; keep its ring hidden until the keyboard is used or focus leaves.
  const [entryFocus, setEntryFocus] = useState(true);
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;

  useLayoutEffect(() => {
    setContainer(anchorRef.current?.parentElement ?? null);
  }, []);

  // Automatic news has no DialogTrigger; restore focus after the DS releases its focus scope.
  useLayoutEffect(() => {
    if (!container) return;
    return () => {
      setTimeout(() => {
        if (!container.isConnected || document.activeElement !== document.body || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        const previous = previousFocus.current;
        const fallback = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).find(
          (element) => !element.closest('[inert], [hidden], [aria-hidden="true"]'),
        );
        const target =
          previous && previous !== document.body && previous.isConnected && !previous.closest('[inert], [hidden], [aria-hidden="true"]') ? previous : fallback;
        target?.focus({ preventScroll: true });
      }, 0);
    };
  }, [container]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Mark a slide shown only when its ID changes, not when its item object is recreated.
  useLayoutEffect(() => {
    if (current) {
      onShownRef.current?.(current);
      setViewed((previous) => (previous.has(current.id) ? previous : new Set(previous).add(current.id)));
    }
  }, [current?.id]);

  function select(index: number) {
    if (index < 0 || index >= displayed.length || index === selected) return;
    setSelection({ ids, index });
    setViewed((previous) => new Set(previous).add(displayed[index].id));
  }

  function onSliderKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    let index: number;
    switch (event.key) {
      case 'ArrowLeft':
        index = selected - 1;
        break;
      case 'ArrowRight':
        index = selected + 1;
        break;
      case 'Home':
        index = 0;
        break;
      case 'End':
        index = displayed.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(index);
  }

  function slideContent(item: NewsItem, active = true) {
    return (
      <article className="news-slide" aria-hidden={active ? undefined : true} inert={!active}>
        <NewsBanner key={item.appId} item={item} />
        <Badge tone="brand">
          {t(locale, item.badge === t('es', 'news.new') ? 'news.new' : item.badge === t('es', 'news.featured') ? 'news.featured' : 'news.update')}
        </Badge>{' '}
        {!viewed.has(item.id) && <Badge tone="brand">{t(locale, 'news.unseen')}</Badge>}
        <h3>{item.title}</h3>
        <p>{item.text}</p>
      </article>
    );
  }

  return (
    <>
      <span ref={anchorRef} hidden />
      {container && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) onClose();
          }}
        >
          <DialogContent container={container} overlayScope="container" title={t(locale, 'news.title')} dismissLabel={t(locale, 'news.close')}>
            {stale && <p role="status">{t(locale, 'catalog.stale')}</p>}
            <div className="news-carousel">
              {displayed.length === 0 ? (
                <p>{t(locale, 'news.empty')}</p>
              ) : displayed.length === 1 ? (
                slideContent(displayed[0])
              ) : (
                // biome-ignore lint/a11y/useSemanticElements: The explicit region preserves existing carousel styles.
                <div
                  role="region"
                  aria-roledescription="carousel"
                  aria-label={t(locale, 'news.latest')}
                  aria-describedby={instructionsId}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: The dialog focuses this region for keyboard carousel navigation.
                  tabIndex={0}
                  data-entry-focus={entryFocus || undefined}
                  onBlur={() => setEntryFocus(false)}
                  onKeyDown={(event) => {
                    setEntryFocus(false);
                    onSliderKeyDown(event);
                  }}
                >
                  <Carousel
                    label={t(locale, 'news.latest')}
                    trackLayout="full-width"
                    messages={messages}
                    value={current?.id}
                    onValueChange={(value) => select(displayed.findIndex((item) => item.id === value))}
                    items={displayed.map((item, index) => ({ value: item.id, label: item.title, children: slideContent(item, index === selected) }))}
                  />
                  <VisuallyHidden id={instructionsId}>{t(locale, 'news.instructions')}</VisuallyHidden>
                </div>
              )}
            </div>
            {current && (
              <div className="news-action">
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  data-app-id={current.appId}
                  aria-label={t(locale, onCatalog ? 'news.catalogCta' : 'news.sampleCta', { cta: cta ?? '', title: current.title })}
                  title={onCatalog ? undefined : t(locale, 'news.sampleAction')}
                  onClick={() => onCatalog?.(current.appId)}
                >
                  {cta}
                </Button>
                {!onCatalog && <span>{t(locale, 'news.sampleAction')}</span>}
              </div>
            )}
            <div className="news-preference">
              <Field layout="choice" label={t(locale, 'news.dontShow')}>
                <Checkbox id={checkboxId} checked={dontShow} onCheckedChange={(value) => onDontShowChange(value === true)} />
              </Field>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function NewsPopup({ open, ...props }: Props) {
  return open ? <OpenNews {...props} /> : null;
}
