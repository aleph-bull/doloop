import { useEffect, useState } from 'react';
import { backgroundById } from '../backgrounds';
import { contrastRatio, luminanceToTextTheme, relativeLuminance, type RGB } from '../contrast';
import type { ResolvedTheme } from '../theme';

export interface BackdropProps {
  backgroundId: string;
  theme: ResolvedTheme;
  /** Custom image URL (Advanced). When set, it replaces the curated background. */
  customImageUrl?: string | null;
}

/**
 * Fixed full-viewport background layer. For custom images it samples the average
 * luminance, flips `--fg-on-glass` to light or dark, and raises the glass fill alpha
 * until text on glass reaches 4.5:1.
 */
export function Backdrop({ backgroundId, theme, customImageUrl }: BackdropProps) {
  const def = backgroundById(backgroundId);
  const variant = theme === 'dark' ? def.dark : def.light;
  const [imageStyle, setImageStyle] = useState<{ ok: boolean }>({ ok: false });

  useEffect(() => {
    const root = document.documentElement;
    if (!customImageUrl) {
      root.style.removeProperty('--fg-on-glass');
      root.style.removeProperty('--glass-fill');
      root.style.removeProperty('--glass-fill-strong');
      setImageStyle({ ok: false });
      return;
    }
    let cancelled = false;
    sampleImage(customImageUrl)
      .then((avg) => {
        if (cancelled) return;
        const lum = relativeLuminance(avg);
        const textTheme = luminanceToTextTheme(lum);
        const fg: RGB = textTheme === 'light' ? [242, 243, 248] : [15, 18, 32];
        const fillBase: RGB = textTheme === 'light' ? [20, 22, 36] : [255, 255, 255];
        // Increase fill alpha until fg on (fill over image) reaches 4.5:1.
        let alpha = 0.45;
        for (; alpha <= 0.95; alpha += 0.05) {
          const composite = avg.map((c, i) =>
            Math.round(c * (1 - alpha) + fillBase[i]! * alpha),
          ) as RGB;
          if (contrastRatio(fg, composite) >= 4.5) break;
        }
        root.style.setProperty('--fg-on-glass', `rgb(${fg.join(' ')})`);
        root.style.setProperty('--glass-fill', `rgb(${fillBase.join(' ')} / ${alpha.toFixed(2)})`);
        root.style.setProperty(
          '--glass-fill-strong',
          `rgb(${fillBase.join(' ')} / ${Math.min(0.97, alpha + 0.15).toFixed(2)})`,
        );
        setImageStyle({ ok: true });
      })
      .catch(() => setImageStyle({ ok: false }));
    return () => {
      cancelled = true;
    };
  }, [customImageUrl]);

  const style =
    customImageUrl && imageStyle.ok
      ? {
          backgroundImage: `url("${customImageUrl}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }
      : { background: variant.css };

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        transition: 'background var(--dur-slow) var(--ease-out)',
        ...style,
      }}
    />
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
