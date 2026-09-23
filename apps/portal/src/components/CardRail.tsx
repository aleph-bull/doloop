import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Children, isValidElement, useRef, useState, type ReactNode } from 'react';
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
        <div className="card-grid">{items}</div>
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
