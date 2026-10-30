import { cn } from '@komogon/ui';
import type { CSSProperties } from 'react';
import { petScale } from '../../lib/crates';
import { PET_SPRITES } from '../../lib/pet-sprites';

/**
 * A pet facing left, in whole pixels, as big as fits `box` (up to `max` times). It stands on
 * its first frame and walks on the spot while its tile is hovered, or always with `walking`.
 */
export function PetSprite({
  id,
  box = [96, 76],
  max = 3,
  walking = false,
  className,
}: {
  id: string;
  box?: readonly [number, number];
  max?: number;
  walking?: boolean;
  className?: string;
}) {
  const s = PET_SPRITES[id];
  if (!s) return null;
  const [w, h, frames] = s;
  const k = petScale(id, box, max);
  return (
    <span
      className={cn('pet-sprite', walking && 'is-walking', className)}
      style={
        {
          '--pet-w': `${w * k}px`,
          '--pet-h': `${h * k}px`,
          '--pet-strip': `${w * k * frames}px`,
          '--pet-frames': frames,
          backgroundImage: `url(/pets/${id}.png)`,
        } as CSSProperties
      }
      aria-hidden
    />
  );
}
