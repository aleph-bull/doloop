import { useId } from 'react';
import { cn } from '../cn';
import { LOGO_PATH, LOGO_SHADE, LOGO_VIEWBOX } from '../logo';

export interface LogoMarkProps {
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
  /** Announce as "Doloop"; leave off when a visible wordmark sits next to it. */
  title?: string;
}

/**
 * The Doloop mark, inline. The ribbon takes `currentColor`, so it follows the text on
 * whatever glass it sits on; the shade at the crossing takes `--logo-shade`, which leans
 * toward the surface behind it — darker under a light mark, lighter under a dark one.
 */
export function LogoMark({ size = 24, className, title }: LogoMarkProps) {
  const id = useId().replace(/:/g, '');
  const s = LOGO_SHADE;
  const stops = s.stops.map(([offset, opacity]) => (
    <stop
      key={offset}
      offset={offset}
      style={{ stopColor: 'var(--logo-shade, #000)', stopOpacity: opacity }}
    />
  ));
  const h = s.bottom - s.top;

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
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={LOGO_PATH} clipRule="evenodd" />
        </clipPath>
        <radialGradient
          id={`${id}-l`}
          cx={s.stemLeft}
          cy={s.cy}
          r={s.r}
          gradientUnits="userSpaceOnUse"
        >
          {stops}
        </radialGradient>
        <radialGradient
          id={`${id}-r`}
          cx={s.stemRight}
          cy={s.cy}
          r={s.r}
          gradientUnits="userSpaceOnUse"
        >
          {stops}
        </radialGradient>
      </defs>
      <path d={LOGO_PATH} fill="currentColor" fillRule="evenodd" />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x={0} y={s.top} width={s.stemLeft} height={h} fill={`url(#${id}-l)`} />
        <rect
          x={s.stemRight}
          y={s.top}
          width={100 - s.stemRight}
          height={h}
          fill={`url(#${id}-r)`}
        />
      </g>
    </svg>
  );
}
