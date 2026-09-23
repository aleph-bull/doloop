import { useCallback, useEffect, useState, type RefObject } from 'react';

export interface ScrollEdges {
  /** Content is hidden off the left edge. */
  left: boolean;
  /** Content is hidden off the right edge. */
  right: boolean;
}

/**
 * Which ends of a sideways scroller are hiding something, kept current through scrolling,
 * resizes, children coming and going, and late web fonts. A mouse cannot drag a hidden
 * scrollbar, so callers put an arrow on each side this reports — and only those sides.
 *
 * `active` lets a caller switch the scroller out (a "See all" grid, say); the observers
 * re-attach when it comes back.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>, active = true) {
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!active || !el) {
      setEdges((prev) => (prev.left || prev.right ? { left: false, right: false } : prev));
      return;
    }
    const ro = new ResizeObserver(measure);
    const watch = () => {
      ro.disconnect();
      ro.observe(el);
      for (const child of Array.from(el.children)) ro.observe(child);
    };
    watch();
    // A card added or removed changes the scroll width without resizing the track.
    const mo = new MutationObserver(() => {
      watch();
      measure();
    });
    mo.observe(el, { childList: true });
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    measure();
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [ref, active, measure]);

  /** Move most of a viewport's width, smoothly unless the user asked for less motion. */
  const scrollByPage = useCallback(
    (direction: -1 | 1, fraction = 0.7) => {
      const el = ref.current;
      if (!el) return;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollBy({
        left: direction * Math.max(120, el.clientWidth * fraction),
        behavior: still ? 'auto' : 'smooth',
      });
    },
    [ref],
  );

  return { edges, measure, scrollByPage };
}
