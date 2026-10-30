import { cn } from '../cn';
import { logoImage } from '../logo';

export interface LogoMarkProps {
  /** Rendered width and height in px. At `LOGO_SMALL_MAX` and under it takes the small mark. */
  size?: number;
  className?: string;
  /** Announce as "Komodon"; leave off when a visible wordmark sits next to it. */
  title?: string;
}

/**
 * The bare Komodon mark, inline, in `currentColor`: the mark's PNG is a mask over the text
 * colour. The portal sets it white on its accent tile (`.brand-mark`); the files that need
 * the tile baked in come from `scripts/prepare-icons.ts`.
 */
export function LogoMark({ size = 24, className, title }: LogoMarkProps) {
  const mask = `url("${logoImage(size)}") center / contain no-repeat`;
  return (
    <span
      className={cn('logo-mark', className)}
      style={{ width: size, height: size, background: 'currentColor', mask }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
