import { useEffect, useState } from 'react';
import { backgroundById } from '../backgrounds';
import { adaptGlassToBackdrop, type RGB } from '../contrast';
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

/** Push the adapted glass tokens onto <html>, or clear them for a plain gradient. */
function applyGlass(avg: RGB | null): void {
  const root = document.documentElement;
  if (!avg) {
    root.style.removeProperty('--fg-on-glass');
    root.style.removeProperty('--glass-fill');
    root.style.removeProperty('--glass-fill-strong');
    return;
  }
  const a = adaptGlassToBackdrop(avg);
  root.style.setProperty('--fg-on-glass', `rgb(${a.fg.join(' ')})`);
  root.style.setProperty('--glass-fill', `rgb(${a.fill.join(' ')} / ${a.alpha.toFixed(2)})`);
  root.style.setProperty(
    '--glass-fill-strong',
    `rgb(${a.fill.join(' ')} / ${a.strongAlpha.toFixed(2)})`,
  );
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
  const def = backgroundById(backgroundId);
  const variant = theme === 'dark' ? def.dark : def.light;
  const photo = customImageUrl ? null : def.photo;
  const [uploadOk, setUploadOk] = useState(false);

  // Shipped photographs: apply synchronously on change, so text never renders unreadable.
  useEffect(() => {
    if (customImageUrl) return;
    applyGlass(photo ? photo.avg : null);
  }, [photo, customImageUrl]);

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
        applyGlass(avg);
        setUploadOk(true);
      })
      .catch(() => {
        if (!cancelled) setUploadOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customImageUrl]);

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
      {photo && <div style={{ position: 'absolute', inset: 0, background: variant.css }} />}
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
