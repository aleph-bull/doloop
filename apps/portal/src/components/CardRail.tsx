import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useScrollEdges } from '../lib/scroll-edges';

export interface CardRailProps {
  /** Names the section for assistive tech. */
  label: string;
  heading: ReactNode;
  /** Links beside the heading, e.g. "Manage". */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * A row of cards that stays one line tall. When they do not all fit, the row scrolls
 * sideways, with an arrow on each side that hides a card, and "See all" unfolds it into
 * a wrapping grid so everything is visible at once.
 */
export function CardRail({ label, heading, actions, children }: CardRailProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { edges, scrollByPage } = useScrollEdges(trackRef, !expanded);
  const items = Children.toArray(children);
  const overflowing = edges.left || edges.right;

  // The row fades out at a side that hides a card. A mask on the row itself would make it
  // the backdrop for the glass cards inside, and they would lose their blur, so each card
  // carries its own share of the fade, worked out from where it sits in the row.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (expanded || !track) return;
    const cards = () =>
      Array.from(track.children)
        .map((item) => item.firstElementChild)
        .filter((card): card is HTMLElement => card instanceof HTMLElement);
    let frame = 0;
    const paint = () => {
      frame = 0;
      const box = track.getBoundingClientRect();
      const fade = parseFloat(getComputedStyle(track).getPropertyValue('--edge-fade')) || 96;
      const fadeLeft = track.scrollLeft > 1;
      const fadeRight = track.scrollLeft + track.clientWidth < track.scrollWidth - 1;
      const alpha = (x: number) =>
        Math.max(
          0,
          Math.min(1, fadeLeft ? (x - box.left) / fade : 1, fadeRight ? (box.right - x) / fade : 1),
        );
      // The fade bends only at these points, so stops there draw it exactly.
      const bends = [
        box.left,
        box.left + fade,
        (box.left + box.right) / 2,
        box.right - fade,
        box.right,
      ];
      for (const card of cards()) {
        const r = card.getBoundingClientRect();
        const points = [r.left, ...bends.filter((x) => x > r.left && x < r.right), r.right];
        const stops = points.map((x) => [x - r.left, alpha(x)] as const);
        if (stops.every(([, a]) => a > 0.999)) {
          card.style.removeProperty('mask-image');
          continue;
        }
        const gradient = stops
          .map(([x, a]) => `rgb(0 0 0 / ${a.toFixed(3)}) ${x.toFixed(1)}px`)
          .join(', ');
        card.style.setProperty('mask-image', `linear-gradient(to right, ${gradient})`);
        card.style.setProperty('mask-repeat', 'no-repeat');
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    track.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      for (const card of cards()) {
        card.style.removeProperty('mask-image');
        card.style.removeProperty('mask-repeat');
      }
    };
  }, [expanded, items.length]);

  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        {heading}
        <div className="flex items-baseline gap-4">
          {(expanded || overflowing) && (
            <button
              type="button"
              className="rail-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Show less' : `See all ${items.length}`}
            </button>
          )}
          {actions}
        </div>
      </div>

      {expanded ? (
        <div className="card-grid rail-expanded">{items}</div>
      ) : (
        <div
          className={`rail scroll-edges${edges.left ? ' can-left' : ''}${
            edges.right ? ' can-right' : ''
          }`}
        >
          {edges.left && (
            <button
              type="button"
              className="scroll-arrow scroll-arrow-left"
              tabIndex={-1}
              aria-hidden
              title="Previous"
              onClick={() => scrollByPage(-1, 0.9)}
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
          )}
          <div ref={trackRef} className="rail-track scroll-edges-track">
            {items.map((item, i) => (
              <div
                key={isValidElement(item) && item.key !== null ? item.key : i}
                className="rail-item"
              >
                {item}
              </div>
            ))}
          </div>
          {edges.right && (
            <button
              type="button"
              className="scroll-arrow scroll-arrow-right"
              tabIndex={-1}
              aria-hidden
              title="Next"
              onClick={() => scrollByPage(1, 0.9)}
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
