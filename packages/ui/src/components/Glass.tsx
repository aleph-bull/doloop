import type { ComponentPropsWithoutRef, ElementType } from 'react';
import { cn } from '../cn';

type GlassProps<T extends ElementType> = {
  as?: T;
  strong?: boolean;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className'>;

/** Frosted-glass surface. Use for nav, timer, modals, reward overlay, node/quote/highlight cards. */
export function Glass<T extends ElementType = 'div'>({
  as,
  strong = false,
  className,
  ...rest
}: GlassProps<T>) {
  const Tag = (as ?? 'div') as ElementType;
  return <Tag className={cn('glass', strong && 'glass-strong', className)} {...rest} />;
}
