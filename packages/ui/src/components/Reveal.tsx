import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface RevealProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Content that drops down when `open` and folds away when not: a grid row animating
 * between 0fr and 1fr, so the height is never measured and nothing jumps. Closed content
 * stays mounted for the fold but is inert, so it takes no focus and reads to nobody.
 */
export function Reveal({ open, children, className }: RevealProps) {
  return (
    <div className={cn('reveal', open && 'is-open', className)} aria-hidden={!open} inert={!open}>
      <div className="reveal-inner">{children}</div>
    </div>
  );
}
