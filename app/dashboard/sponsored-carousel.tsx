"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { defaultHomepageSlideIndex, type HomepageSlide } from "@/lib/homepage-banners";
import { safeBannerUrl } from "@/lib/announcements";

function slideName(slide: HomepageSlide) {
  return slide.gameweekLabel ? `${slide.title} ${slide.gameweekLabel}` : slide.title;
}

function Sponsor({ slide, first, linked }: { slide: HomepageSlide; first: boolean; linked: boolean }) {
  const [failed, setFailed] = useState(false);
  const locked = slide.state === "upcoming";
  const showLogo = Boolean(!locked && slide.imageUrl && !failed);
  const headline = locked ? null : slide.cta_label ?? (linked && (slide.sponsor || slide.description || slide.imageUrl) ? "Discover prize" : null);
  const description = locked ? null : slide.description;
  const status = locked ? "Locked · Coming soon"
    : slide.state === "previous" ? "Awaiting winner confirmation"
      : slide.state === "refreshing" ? "Updating results"
        : slide.state === "live" ? "Entries closed" : null;
  return <div className="sponsored-brand flex min-w-0 items-center gap-3">
    {showLogo ? (
      // Reuse the existing private artwork field for a compact, uncropped sponsor logo.
      // eslint-disable-next-line @next/next/no-img-element
      <span className="sponsored-logo"><img alt={slide.image_alt ?? slide.sponsor ?? "Sponsor logo"} src={slide.imageUrl} loading={first ? "eager" : "lazy"} onError={() => setFailed(true)} ref={(image) => {
        // An eager server-rendered image can fail before hydration attaches onError.
        if (image?.complete && image.naturalWidth === 0) setFailed(true);
      }} className="max-h-8 w-auto max-w-full object-contain" /></span>
    ) : null}
    <div className="min-w-0 flex-1 space-y-0.5 text-sm font-bold leading-4 text-[var(--pf-text)]">
      {headline ? <p className="sponsored-discover line-clamp-1 break-words">{headline}</p> : null}
      {description ? <p className="line-clamp-1 break-words">{description}</p> : null}
      {status ? <p className="flex items-center gap-1.5 text-xs">
        {locked ? <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" className="h-3.5 w-3.5 shrink-0"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg> : null}
        <span className="line-clamp-1">{status}</span>
      </p> : null}
      {!headline && !description && !status ? <p className="line-clamp-1 break-words">Competition details coming soon</p> : null}
    </div>
  </div>;
}

export function SponsoredCarousel({ slides }: { slides: HomepageSlide[] }) {
  const defaultIndex = defaultHomepageSlideIndex(slides);
  const [selected, setSelected] = useState(() => defaultHomepageSlideIndex(slides));
  const initialSelection = useRef(defaultHomepageSlideIndex(slides));
  const track = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const trackId = useId();
  const multiple = slides.length > 1;
  const active = Math.max(0, Math.min(selected, slides.length - 1));

  // Entry only: never depend on active or refreshed props, which would interrupt
  // browsing. Route unmount/re-entry (including restored React effects) resets
  // the native track; its scroll event keeps the existing selection state aligned.
  useLayoutEffect(() => {
    function selectInitial() {
      const element = track.current;
      if (element) element.scrollTo({ left: initialSelection.current * element.clientWidth, behavior: "instant" });
    }
    selectInitial();
    // Returning from a prize destination can restore the entire document from
    // the browser's back/forward cache without mounting React again.
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) selectInitial();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    const list = pages.current;
    const dot = list?.children[active];
    // Keep the selected dot visible on phones even with a full season of slides.
    if (list && dot instanceof HTMLElement) {
      list.scrollTo({ left: dot.offsetLeft - (list.clientWidth - dot.clientWidth) / 2, behavior: "instant" });
    }
  }, [active]);

  if (!slides.length) return null;

  function goTo(index: number) {
    const element = track.current;
    if (!element) return;
    const next = (index + slides.length) % slides.length;
    if (document.activeElement !== element && element.contains(document.activeElement)) {
      element.focus({ preventScroll: true });
    }
    element.scrollTo({ left: next * element.clientWidth });
  }

  return (
    <section
      aria-label="Gameweek highlights" aria-roledescription="carousel"
      className="sponsored-carousel relative min-w-0"
      onKeyDown={(event) => {
        if (!multiple || event.altKey || event.ctrlKey || event.metaKey) return;
        const next = event.key === "ArrowRight" ? active + 1 : event.key === "ArrowLeft" ? active - 1
          : event.key === "Home" ? 0 : event.key === "End" ? slides.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        goTo(next);
      }}
    >
      <div className="sponsored-frame overflow-hidden rounded-xl border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)]">
        <div
          id={trackId} ref={track} tabIndex={multiple ? 0 : undefined}
          aria-label={multiple ? "Slides. Use left and right arrow keys to browse." : undefined}
          className="sponsored-track flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--pf-brand-blue-hover)]"
          onScroll={() => {
            const element = track.current;
            if (element?.clientWidth) setSelected(Math.max(0, Math.min(slides.length - 1, Math.round(element.scrollLeft / element.clientWidth))));
          }}
        >
          {slides.map((slide, index) => {
            const locked = slide.state === "upcoming";
            const destination = locked ? undefined : safeBannerUrl(slide.cta_url);
            const season = slide.kind === "season";
            const content = <>
              <div className={`flex min-w-0 flex-col gap-2 ${destination ? "pr-10" : ""}`}>
                <div className="flex items-start gap-2.5">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-1 h-5 w-5 shrink-0 text-[var(--pf-logo-gold)]">
                    <path d={season ? "m3 6 5 4 4-6 4 6 5-4-2 12H5L3 6Zm3 15h12" : "M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 13v5m-4 3h8m-6-3h4l1 3H9l1-3Z"} />
                  </svg>
                  <h2 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 break-words text-xl font-bold leading-snug tracking-tight text-[var(--pf-text)] sm:text-2xl">
                    <span>{slide.title}</span>
                    {slide.gameweekLabel ? <> <span className="shrink-0 whitespace-nowrap rounded-full border border-[var(--pf-brand-blue-hover)]/30 bg-[var(--pf-brand-blue-hover)]/10 px-2 text-[10px] font-bold leading-5 tracking-wide text-[var(--pf-text)]">{slide.gameweekLabel}</span></> : null}
                  </h2>
                </div>
                <Sponsor key={slide.imageUrl} slide={slide} first={index === defaultIndex} linked={Boolean(destination)} />
              </div>
              {destination ? <span className="sponsored-hint absolute right-4 top-1/2 flex h-11 w-8 -translate-y-1/2 items-center justify-center text-[var(--pf-logo-gold)] sm:right-6">
                <span className="sr-only">View competition</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="sponsored-hint-arrow h-8 w-8">
                  <path d="m9 5 7 7-7 7" />
                </svg>
              </span> : null}
            </>;
            const contentClass = "sponsored-content relative z-10 flex h-full min-h-28 min-w-0 flex-col justify-center px-4 py-2.5 sm:px-6 sm:py-3";
            return (
              <article
                key={slide.id} inert={index !== active} aria-hidden={index !== active}
                role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${slides.length}: ${slideName(slide)}`}
                className={`sponsored-slide relative w-full shrink-0 snap-start ${season ? "sponsored-slide-season" : ""}`}
              >
                {destination ? <Link prefetch={false} href={destination} className={`${contentClass} sponsored-link focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--pf-logo-gold)]`}>
                  {content}
                </Link> : <div className={contentClass}>{content}</div>}
              </article>
            );
          })}
        </div>
        {multiple ? <div className="sponsored-pagination flex items-center justify-center gap-2 px-2 sm:justify-between sm:px-4">
          <button type="button" aria-label="Previous highlight" aria-controls={trackId} className="sponsored-control" onClick={() => goTo(active - 1)}><span aria-hidden="true">←</span></button>
          <div ref={pages} className="sponsored-pages relative flex min-w-0 overflow-x-auto" role="group" aria-label="Choose a highlight">
            {slides.map((slide, index) => <button type="button" key={slide.id} aria-label={`Show highlight ${index + 1}: ${slideName(slide)}`} aria-current={index === active ? "true" : undefined} aria-controls={trackId} className="sponsored-dot flex h-6 w-8 shrink-0 items-center justify-center rounded-md hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pf-brand-blue-hover)]" onClick={() => goTo(index)}>
              <span aria-hidden="true" className={`h-1 rounded-full transition-all motion-reduce:transition-none ${index === active ? "w-4 bg-[var(--pf-brand-blue-hover)]" : "w-1 bg-[var(--pf-text-muted)]"}`} />
            </button>)}
          </div>
          <button type="button" aria-label="Next highlight" aria-controls={trackId} className="sponsored-control" onClick={() => goTo(active + 1)}><span aria-hidden="true">→</span></button>
        </div> : null}
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">Highlight {active + 1} of {slides.length}: {slideName(slides[active])}</p>
    </section>
  );
}
