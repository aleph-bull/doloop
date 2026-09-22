import { backgroundById } from '../backgrounds';
import { cn } from '../cn';
import type { ResolvedTheme } from '../theme';

export interface BackgroundThumbProps {
  id: string;
  theme: ResolvedTheme;
  /** What the label says; falls back to the background's own name. */
  label?: string;
  selected?: boolean;
  disabled?: boolean;
  /** Announced instead of the label when the background is locked. */
  ariaLabel?: string;
  title?: string;
  /** Corner marker, e.g. what unlocks a locked background. */
  badge?: string;
  /** Origin the photo paths resolve against; empty means the app's own. */
  assetBase?: string;
  className?: string;
  onClick?: () => void;
}

/**
 * One background in a picker. A gradient paints from its CSS. A photograph paints its
 * inlined 20px placeholder straight away, with the 640px thumbnail loaded lazily on top —
 * the placeholder alone is a smear at tile size, and the full 2560px image is only fetched
 * once one is chosen.
 */
export function BackgroundThumb({
  id,
  theme,
  label,
  selected,
  disabled,
  ariaLabel,
  title,
  badge,
  assetBase = '',
  className,
  onClick,
}: BackgroundThumbProps) {
  const def = backgroundById(id);
  const variant = theme === 'dark' ? def.dark : def.light;
  const style = def.photo
    ? {
        backgroundImage: `url("${def.photo.lqip}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { background: variant.css };

  return (
    <button
      type="button"
      className={cn('bg-thumb', className)}
      aria-pressed={selected}
      aria-label={ariaLabel ?? label ?? def.name}
      title={title}
      disabled={disabled}
      style={{ ...style, opacity: disabled ? 0.5 : 1 }}
      onClick={onClick}
    >
      {def.photo && (
        <img
          className="bg-thumb-img"
          src={`${assetBase}/${def.photo.thumb}`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}
      <span className="bg-thumb-label">{label ?? def.name}</span>
      {badge && <span className="bg-thumb-badge">{badge}</span>}
    </button>
  );
}
