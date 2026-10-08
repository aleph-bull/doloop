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
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // Closing plays `modal-out` first and only then closes the dialog, so a score sheet or
  // a form fades rather than vanishes. Under reduced motion the animation is none and the
  // close is immediate. Reopening during the fade cancels it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      el.classList.remove('is-closing');
      if (!el.open) el.showModal();
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
      className={cn('modal', className)}
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div className={cn('glass', strong && 'glass-strong', 'modal-body')}>
        {title && (
          <h2 id="modal-title" className="modal-title">
            {title}
          </h2>
        )}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </dialog>
  );
}
