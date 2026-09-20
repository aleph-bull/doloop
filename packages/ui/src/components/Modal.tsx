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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
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
