import type { ComponentPropsWithoutRef, ElementType } from 'react';
import { cn } from '../cn';

type PanelProps<T extends ElementType> = {
  as?: T;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className'>;

/** Opaque panel for dense content: task tree, tables, charts. */
export function Panel<T extends ElementType = 'div'>({ as, className, ...rest }: PanelProps<T>) {
  const Tag = (as ?? 'div') as ElementType;
  return <Tag className={cn('panel', className)} {...rest} />;
}
