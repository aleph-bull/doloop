/**
 * The Komodon mark: Komodon's face, front-on, with the eyes and nostrils cut out and the
 * jaw drawn as a band beneath.
 *
 * Since 2026-10-30 it comes from the designer's two PNGs in `design/brand` (replacing the
 * `komo3.0.svg` path): `komo3.0.png` for bigger sizes and `komo3.0small.png`, drawn to stay
 * clear when tiny, for anything `LOGO_SMALL_MAX` px or under. Both are white on clear, cut
 * to the square that just holds the face's width. As an icon the mark sits white on the
 * rounded indigo-to-violet tile the app has always used.
 *
 * Everything that draws the mark reads from here: the `LogoMark` component, the timelapse,
 * and the favicons and raster icons written by `scripts/prepare-icons.ts`.
 */
import { LOGO_PNG, LOGO_SMALL_PNG } from './logo-images.generated';

export { LOGO_PNG, LOGO_SMALL_PNG };

/** The largest size, in px, that takes the small mark. */
export const LOGO_SMALL_MAX = 32;

/** The mark as a data URL, the small one at `LOGO_SMALL_MAX` px and under. */
export function logoImage(size: number): string {
  return size <= LOGO_SMALL_MAX ? LOGO_SMALL_PNG : LOGO_PNG;
}
