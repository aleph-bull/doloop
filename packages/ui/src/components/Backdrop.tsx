import { useEffect, useMemo, useState } from 'react';
import { backgroundById, photoScrimCss } from '../backgrounds';
import { adaptToPhoto, type RGB } from '../contrast';
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
}

/** The wash over a photo that keeps text straight on the backdrop readable. */
interface PageWash {
  color: RGB;
  alpha: number;
}

/**
 * Push the adapted glass tokens onto <html>, or clear them for a plain gradient. Returns
 * the page wash the photo needs, if any.
 */
function applyGlass(
  avg: RGB | null,
  theme: ResolvedTheme,
  kind: 'photo' | 'solid' = 'photo',
): PageWash | null {
  const root = document.documentElement;
  if (!avg) {
    for (const v of [
      '--fg-on-glass',
      '--glass-fill',
      '--glass-fill-strong',
      '--glass-solid',
      '--chrome-fill',
      '--accent-text-glass',
    ])
      root.style.removeProperty(v);
    delete root.dataset.backdrop;
    return null;
  }
  const a = adaptToPhoto(avg, theme);
  // Lets text that sits straight on a photo pick up a soft halo (see styles.css). A flat
  // colour has no busy patches to cover, so it gets none.
  root.dataset.backdrop = kind;
  const lightText = a.fg[0] > 128;
  root.style.setProperty('--fg-on-glass', `rgb(${a.fg.join(' ')})`);
  // The opaque stand-in under reduced transparency, and the accent text that reads on it.
  root.style.setProperty('--glass-solid', lightText ? 'rgb(26 28 40)' : 'rgb(246 247 250)');
  root.style.setProperty(
    '--accent-text-glass',
    lightText ? 'var(--accent-text-on-dark)' : 'var(--accent-text-on-light)',
  );
  // Chrome stays thinner than the cards, but never thinner than the photo allows.
  root.style.setProperty(
    '--chrome-fill',
    `rgb(${a.fill.join(' ')} / ${Math.max(0.42, a.alpha - 0.05).toFixed(2)})`,
  );
  root.style.setProperty('--glass-fill', `rgb(${a.fill.join(' ')} / ${a.alpha.toFixed(2)})`);
  root.style.setProperty(
    '--glass-fill-strong',
    `rgb(${a.fill.join(' ')} / ${a.strongAlpha.toFixed(2)})`,
  );
  return a.pageScrim > 0 ? { color: a.fill, alpha: a.pageScrim } : null;
}

/**
 * Fixed full-viewport background layer.
 *
 * A gradient renders straight from its CSS. A shipped photograph renders from its
 * precomputed average colour — no sampling, no flash — over a 20px placeholder that
 * paints instantly. A user's own upload is sampled live, since nothing is known about it
 * ahead of time.
 */
export function Backdrop({ backgroundId, theme, customImageUrl, assetBase = '' }: BackdropProps) {
  // Memoised: a solid colour's definition is built per call, and the effects below key on it.
  const def = useMemo(() => backgroundById(backgroundId), [backgroundId]);
  const variant = theme === 'dark' ? def.dark : def.light;
  const photo = customImageUrl ? null : def.photo;
  const solid = customImageUrl ? null : def.solid;
  const [uploadOk, setUploadOk] = useState(false);
  const [wash, setWash] = useState<PageWash | null>(null);

  // Shipped photographs: apply synchronously on change, so text never renders unreadable.
  useEffect(() => {
    if (customImageUrl) return;
    setWash(
      solid ? applyGlass(solid, theme, 'solid') : applyGlass(photo ? photo.avg : null, theme),
    );
  }, [photo, solid, customImageUrl, theme]);

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
        setWash(applyGlass(avg, theme));
        setUploadOk(true);
      })
      .catch(() => {
        if (!cancelled) setUploadOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customImageUrl, theme]);

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
