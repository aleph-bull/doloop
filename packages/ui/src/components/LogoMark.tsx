import { cn } from '../cn';
import { LOGO_PATH, LOGO_VIEWBOX } from '../logo';

export interface LogoMarkProps {
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
  /** Announce as "Doloop"; leave off when a visible wordmark sits next to it. */
  title?: string;
}

/**
 * The bare Doloop mark, inline, in `currentColor`. The portal sets it white on its accent
 * tile (`.brand-mark`); the files that need the tile baked in come from `logoSvg`.
 */
export function LogoMark({ size = 24, className, title }: LogoMarkProps) {
  return (
    <svg
      className={cn('logo-mark', className)}
      viewBox={LOGO_VIEWBOX}
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d={LOGO_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
