import { useEffect, useRef, useState, type ReactNode } from 'react';

/** The pop-out's width, as `.popout > .start-pop` in base.css. */
const POP_WIDTH = 250;

/**
 * A pill that pops out its choices under it, like the portal's start card (`Popout` there):
 * the portal's `start-pill` and `start-pop` looks, placed inside the popup. Closes on a click
 * outside or Escape.
 */
export function Popout({
  label,
  trigger,
  children,
  menu = true,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  /** A list of choices (tighter padding) rather than a small form. */
  menu?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** Under the pill's right edge instead, when its left one leaves no room in the popup. */
  const [fromRight, setFromRight] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const toggle = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setFromRight(r.left + POP_WIDTH > window.innerWidth - 12);
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span className="popout" ref={box}>
      <button
        type="button"
        className={`start-pill${open ? ' is-open' : ''}`}
        aria-label={label}
        aria-expanded={open}
        onClick={toggle}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`glass glass-strong start-pop${menu ? ' is-menu' : ''}${fromRight ? ' from-right' : ''}`}
          role="dialog"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}
