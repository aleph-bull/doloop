import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface PopoutProps {
  /** What the button shows. */
  trigger: ReactNode;
  triggerClassName: string;
  /** Names the pop-out for screen readers. */
  label: string;
  /** Its width in pixels; without one it is as wide as the button. */
  width?: number;
  /** Room it wants below the button before it opens above instead. */
  room?: number;
  className?: string;
  /** The content, given the function that puts it away. */
  children: (close: () => void) => ReactNode;
}

/**
 * A button that pops a panel out under it. The panel is a popover in the browser's top
 * layer, because inside a modal dialog nothing else can float: anything outside the dialog
 * is inert and the dialog clips what is inside it. Escape and a click anywhere else close
 * it; focus goes to its first control on opening and back to the button on closing. Each
 * opening starts afresh.
 */
export function Popout({
  trigger,
  triggerClassName,
  label,
  width,
  room = 320,
  className,
  children,
}: PopoutProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /** Bumped on each close, so the next opening is fresh. */
  const [round, setRound] = useState(0);

  useEffect(() => {
    const button = buttonRef.current;
    const pop = popRef.current;
    if (!button || !pop) return;
    // Under the button, or above it when there is more room there; never off the sides.
    // Whatever scrolls inside gives up height before the panel runs off the window.
    const place = () => {
      const r = button.getBoundingClientRect();
      const w = Math.min(width ?? r.width, window.innerWidth - 16);
      const below = window.innerHeight - r.bottom - 14;
      const above = r.top - 14;
      const up = below < room && above > below;
      pop.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - w - 8)}px`;
      pop.style.width = `${w}px`;
      pop.style.top = up ? 'auto' : `${r.bottom + 6}px`;
      pop.style.bottom = up ? `${window.innerHeight - r.top + 6}px` : 'auto';
      pop.style.maxHeight = `${up ? above : below}px`;
    };
    const onBefore = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') place();
    };
    const onToggle = (e: Event) => {
      const opened = (e as ToggleEvent).newState === 'open';
      setOpen(opened);
      if (opened) pop.querySelector<HTMLElement>('input, button')?.focus();
      else setRound((n) => n + 1);
    };
    const follow = () => {
      if (pop.matches(':popover-open')) place();
    };
    pop.addEventListener('beforetoggle', onBefore);
    pop.addEventListener('toggle', onToggle);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      pop.removeEventListener('beforetoggle', onBefore);
      pop.removeEventListener('toggle', onToggle);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [width, room]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${triggerClassName}${open ? ' is-open' : ''}`}
        popoverTarget={id}
        aria-haspopup="dialog"
      >
        {trigger}
      </button>
      <div
        ref={popRef}
        id={id}
        popover="auto"
        className={`glass glass-strong start-pop${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-label={label}
      >
        <Fragment key={round}>
          {children(() => document.getElementById(id)?.hidePopover())}
        </Fragment>
      </div>
    </>
  );
}
