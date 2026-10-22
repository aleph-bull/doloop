import { useEffect, useMemo, useState } from 'react';
import { backgroundById, photoScrimCss } from '../backgrounds';
import { adaptToPhoto, chooseGlass, THEME_GLASS, type GlassChoice, type RGB } from '../contrast';
import type { ResolvedTheme } from '../theme';

export interface BackdropProps {
  backgroundId: string;
  theme: ResolvedTheme;
  /** Custom image URL (Advanced). When set, it replaces the curated background. */
  customImageUrl?: string | null;
  /**
   * Prefix for a shipped photograph's path. The portal serves them from its own root, so
   * it passes nothing; the extension passes the portal origin.
   */
  assetBase?: string;
  /** Someone's own glass colour and weight (Appearance › Advanced). */
  glass?: GlassChoice;
}

/** The wash over a photo that keeps text straight on the backdrop readable. */
interface PageWash {
  color: RGB;
  alpha: number;
}

/** Every token `applyGlass` may set inline, so a plain gradient can clear them all. */
const ADAPTED_TOKENS = [
  '--glass-fill',
  '--glass-fill-strong',
  '--chrome-fill',
  '--fg-on-backdrop',
  '--accent-text-backdrop',
  '--backdrop-halo',
  '--fg-on-glass',
  '--accent-text-glass',
];

const rgba = (rgb: RGB, alpha: number) => `rgb(${rgb.join(' ')} / ${alpha.toFixed(2)})`;

/**
 * Someone's own glass colour and weight, laid over what `applyGlass` set. `own` is the glass
 * the theme and photo asked for. A colour that wants the other text (dark glass in light mode,
 * say) turns the text on all glass round, and pins the page's own text on a gradient, which
 * otherwise follows the glass's.
 */
function applyChosenGlass(
  glass: GlassChoice | undefined,
  avg: RGB | null,
  theme: ResolvedTheme,
  own: { alpha: number; strongAlpha: number; chromeAlpha: number },
): void {
  const chosen = glass ? chooseGlass(glass, theme, avg, own) : null;
  if (!chosen) return;
  const root = document.documentElement;
  root.style.setProperty('--glass-fill', rgba(chosen.fill, chosen.alpha));
  root.style.setProperty('--glass-fill-strong', rgba(chosen.fill, chosen.strongAlpha));
  root.style.setProperty('--chrome-fill', rgba(chosen.chrome, own.chromeAlpha));
  if (chosen.lightText === (theme === 'dark')) return;
  const fg = chosen.lightText ? '#f4f5f9' : '#0f1220';
  const accent = chosen.lightText ? 'var(--accent-text-on-dark)' : 'var(--accent-text-on-light)';
  root.style.setProperty('--fg-on-glass', fg);
  root.style.setProperty('--accent-text-glass', accent);
  if (!avg) {
    const pageFg = theme === 'dark' ? '#f4f5f9' : '#0f1220';
    root.style.setProperty('--fg-on-backdrop', pageFg);
    root.style.setProperty(
      '--accent-text-backdrop',
      theme === 'dark' ? 'var(--accent-text-on-dark)' : 'var(--accent-text-on-light)',
    );
  }
}

/**
 * Push the adapted tokens onto <html>, or clear them for a plain gradient. Returns the page
 * wash the photo needs, if any.
 *
 * Panels keep the theme's own colours: a photo can only make their glass thicker. The text
 * that sits straight on the photo is the one thing that switches, to black or white.
 */
function applyGlass(
  avg: RGB | null,
  theme: ResolvedTheme,
  kind: 'photo' | 'solid' = 'photo',
  chosen?: GlassChoice,
): PageWash | null {
  const root = document.documentElement;
  if (!avg) {
    for (const v of ADAPTED_TOKENS) root.style.removeProperty(v);
    delete root.dataset.backdrop;
    applyChosenGlass(chosen, null, theme, THEME_GLASS[theme]);
    return null;
  }
  const a = adaptToPhoto(avg, theme);
  // Lets text that sits straight on a photo pick up a soft halo (see styles.css). A flat
  // colour has no busy patches to cover, so it gets none.
  root.dataset.backdrop = kind;
  root.style.setProperty('--glass-fill', rgba(a.fill, a.alpha));
  root.style.setProperty('--glass-fill-strong', rgba(a.fill, a.strongAlpha));
  root.style.setProperty('--chrome-fill', rgba(THEME_GLASS[theme].chrome, a.chromeAlpha));
  root.style.removeProperty('--fg-on-glass');
  root.style.removeProperty('--accent-text-glass');

  const lightPage = a.pageFg[0] > 128;
  root.style.setProperty('--fg-on-backdrop', `rgb(${a.pageFg.join(' ')})`);
  root.style.setProperty(
    '--accent-text-backdrop',
    lightPage ? 'var(--accent-text-on-dark)' : 'var(--accent-text-on-light)',
  );
  root.style.setProperty('--backdrop-halo', lightPage ? 'rgb(26 28 40)' : 'rgb(246 247 250)');
  applyChosenGlass(chosen, avg, theme, a);
  return a.pageScrim > 0 ? { color: a.pageWash, alpha: a.pageScrim } : null;
}

/**
 * Fixed full-viewport background layer.
 *
 * A gradient renders straight from its CSS. A shipped photograph renders from its
 * precomputed average colour — no sampling, no flash — over a 20px placeholder that
 * paints instantly. A user's own upload is sampled live, since nothing is known about it
 * ahead of time.
 */
export function Backdrop({
  backgroundId,
  theme,
  customImageUrl,
  assetBase = '',
  glass,
}: BackdropProps) {
  // Memoised: a solid colour's definition is built per call, and the effects below key on it.
  const def = useMemo(() => backgroundById(backgroundId), [backgroundId]);
  const variant = theme === 'dark' ? def.dark : def.light;
  const photo = customImageUrl ? null : def.photo;
  const solid = customImageUrl ? null : def.solid;
  const [uploadOk, setUploadOk] = useState(false);
  const [wash, setWash] = useState<PageWash | null>(null);
  // Kept as plain values, so a new settings object with the same glass changes nothing.
  const glassColor = glass?.color ?? null;
  const glassAlpha = glass?.alpha ?? null;

  // Shipped photographs: apply synchronously on change, so text never renders unreadable.
  useEffect(() => {
    if (customImageUrl) return;
    const chosen = { color: glassColor, alpha: glassAlpha };
    setWash(
      solid
        ? applyGlass(solid, theme, 'solid', chosen)
        : applyGlass(photo ? photo.avg : null, theme, 'photo', chosen),
    );
  }, [photo, solid, customImageUrl, theme, glassColor, glassAlpha]);

  // A user's own image has to be measured in the browser.
  useEffect(() => {
    if (!customImageUrl) {
      setUploadOk(false);
      return;
    }
    let cancelled = false;
    sampleImage(customImageUrl)
      .then((avg) => {
        if (cancelled) return;
        setWash(applyGlass(avg, theme, 'photo', { color: glassColor, alpha: glassAlpha }));
        setUploadOk(true);
      })
      .catch(() => {
        if (!cancelled) setUploadOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customImageUrl, theme, glassColor, glassAlpha]);

  const imageUrl = customImageUrl && uploadOk ? customImageUrl : null;
  // `src` has no leading slash, so an empty base resolves to the app root.
  const photoUrl = photo ? `${assetBase}/${photo.src}` : null;

  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -1 }}>
      {/* Base layer: the gradient, or the photo's placeholder while it loads. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          ...(photo
            ? {
                backgroundImage: `url("${photo.lqip}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : { background: variant.css }),
        }}
      />
      {(imageUrl || photoUrl) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url("${imageUrl ?? photoUrl}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      {/* Scrim, so a bright photo does not fight the glass. */}
      {(photo || imageUrl) && (
        <div style={{ position: 'absolute', inset: 0, background: photoScrimCss(theme) }} />
      )}
      {/* Only as much extra wash as the page's own text needs to read on this photo. */}
      {(photo || imageUrl) && wash && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `rgb(${wash.color.join(' ')} / ${wash.alpha})`,
          }}
        />
      )}
    </div>
  );
}

/** Average colour of an image, sampled on a tiny canvas. Requires CORS-readable images. */
export function sampleImage(url: string): Promise<RGB> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no canvas'));
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0,
          g = 0,
          b = 0;
        const n = size * size;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
        }
        resolve([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}
