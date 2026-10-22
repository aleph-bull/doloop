import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { cn } from '../cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** Prevent closing with Escape or backdrop click (e.g. idle prompt). */
  persistent?: boolean;
  className?: string;
  strong?: boolean;
  /**
   * How it sits on a phone-width screen. 'sheet' (the default) rises from the bottom edge,
   * for a question or a short form. 'full' takes the whole screen like a page of its own: the
   * title and a close button in a bar along the top, the body scrolling under it, and the
   * actions pinned to the bottom within reach of a thumb. For forms with more than a few
   * fields. On a computer both are the same centred card.
   */
  phone?: 'sheet' | 'full';
  /**
   * Where focus goes when it opens: the first control (the default, so a keyboard user can
   * type straight away), or the dialog itself. 'dialog' keeps a phone's keyboard down until
   * a field is tapped. On a touch screen a text field is never focused on open either way.
   */
  initialFocus?: 'first' | 'dialog';
  /**
   * A layer over the whole full-screen sheet, title bar and actions included: a page pushed
   * on top of it, such as a picker. It positions and shows itself.
   */
  cover?: ReactNode;
}

const TEXT_ENTRY =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]';

/**
 * Writes the visible part of the screen onto an element as `--vv-height` and `--vv-top`
 * while `on`, so a sheet can size itself to what the on-screen keyboard leaves and keep its
 * pinned actions just above the keys instead of behind them. iOS keeps the layout viewport
 * (and with it every fixed element) its full height under the keyboard, so the visual
 * viewport is measured instead.
 */
export function useVisualViewportFit(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!on || !el || !vv) return;
    const fit = () => {
      el.style.setProperty('--vv-height', `${vv.height}px`);
      el.style.setProperty('--vv-top', `${vv.offsetTop}px`);
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.style.removeProperty('--vv-height');
      el.style.removeProperty('--vv-top');
    };
  }, [ref, on]);
}

/** Native <dialog> based modal on a glass surface. Focus is trapped by the browser. */
export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  persistent = false,
  className,
  strong = true,
  phone = 'sheet',
  initialFocus = 'first',
  cover,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const full = phone === 'full';
  useVisualViewportFit(ref, open && full);

  // Closing plays `modal-out` first and only then closes the dialog, so a score sheet or
  // a form fades rather than vanishes. Under reduced motion the animation is none and the
  // close is immediate. Reopening during the fade cancels it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      el.classList.remove('is-closing');
      if (!el.open) {
        // The browser focuses the first control on its own. On a touch screen a text field
        // there would bring the keyboard up (and on an iPhone zoom the page) before anything
        // was tapped, so the dialog takes focus itself instead.
        const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
        const own = initialFocus === 'dialog' || touch;
        if (own) el.setAttribute('autofocus', '');
        el.showModal();
        el.removeAttribute('autofocus');
        // Browsers that skip a dialog's own autofocus still land on the field: move off it.
        const landed = document.activeElement;
        if (initialFocus === 'dialog' || (touch && landed?.matches(TEXT_ENTRY))) {
          if (landed !== el) el.focus({ preventScroll: true });
        }
        // A sheet that scrolls opens at its top, whatever it showed last time.
        el.scrollTop = 0;
        el.querySelector('.modal-content')?.scrollTo?.(0, 0);
      }
      return;
    }
    if (!el.open) return;
    el.classList.add('is-closing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.classList.remove('is-closing');
      if (el.open) el.close();
    };
    if (getComputedStyle(el).animationName === 'none') {
      finish();
      return;
    }
    el.addEventListener('animationend', finish, { once: true });
    const fallback = window.setTimeout(finish, 600);
    return () => {
      el.removeEventListener('animationend', finish);
      window.clearTimeout(fallback);
      // Unmounted or reopened mid-fade: leave nothing half-closed.
      if (!done) el.classList.remove('is-closing');
    };
    // initialFocus is read at the moment of opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (!persistent) onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (persistent) return;
      if (e.target === el) onClose();
    };
    el.addEventListener('cancel', onCancel);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('click', onClick);
    };
  }, [onClose, persistent]);

  return (
    <dialog
      ref={ref}
      className={cn('modal', full && 'modal-full', className)}
      aria-labelledby={title ? 'modal-title' : undefined}
      tabIndex={-1}
    >
      <div className={cn('glass', strong && 'glass-strong', 'modal-body')}>
        {full ? (
          <>
            <div className="modal-head">
              {title && (
                <h2 id="modal-title" className="modal-title">
                  {title}
                </h2>
              )}
              {!persistent && (
                <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="modal-content">{children}</div>
            {actions && <div className="modal-actions">{actions}</div>}
            {cover}
          </>
        ) : (
          <>
            {title && (
              <h2 id="modal-title" className="modal-title">
                {title}
              </h2>
            )}
            {children}
            {actions && <div className="modal-actions">{actions}</div>}
          </>
        )}
      </div>
    </dialog>
  );
}
