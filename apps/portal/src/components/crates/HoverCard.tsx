import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The card's width, the gap between it and what it describes, and its margin in the window. */
const WIDTH = 296;
const GAP = 8;
const EDGE = 8;

/**
 * Something that shows a card about itself while hovered or focused (the inventory's tiles).
 * The card is put on the body, fixed to the window, so no fold or scroller around the tile
 * can clip it. It sits beside the tile where there's room, so a tall card has the window's
 * height, else above or below it; it is measured before it paints, and goes on any scroll.
 */
export function HoverCard({
  card,
  className,
  children,
}: {
  card: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    const pop = cardRef.current;
    if (!open || !el || !pop) return;
    const r = el.getBoundingClientRect();
    const h = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampTop = (top: number) => Math.min(Math.max(EDGE, top), vh - h - EDGE);
    let left: number;
    let top: number;
    if (vw - r.right >= WIDTH + GAP + EDGE) {
      left = r.right + GAP;
      top = clampTop(r.top);
    } else if (r.left >= WIDTH + GAP + EDGE) {
      left = r.left - GAP - WIDTH;
      top = clampTop(r.top);
    } else {
      left = Math.min(Math.max(EDGE, r.left + r.width / 2 - WIDTH / 2), vw - WIDTH - EDGE);
      const above = r.top - GAP - h;
      top = above >= EDGE || r.top > vh - r.bottom ? Math.max(EDGE, above) : r.bottom + GAP;
    }
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.visibility = 'visible';
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className={className}
      aria-describedby={open ? id : undefined}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={cardRef}
            id={id}
            role="tooltip"
            className="inv-hover glass glass-strong"
            style={{ width: WIDTH, visibility: 'hidden' }}
          >
            {card}
          </div>,
          document.body,
        )}
    </div>
  );
}
