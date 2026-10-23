import type { BackgroundTexture } from '@komogon/core';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { backgroundById, photoScrimCss } from '../backgrounds';
import { adaptToPhoto, chooseGlass, THEME_GLASS, type GlassChoice, type RGB } from '../contrast';
import { coverPlacement, makeGlassImage, pinnedGlassWorks, type GlassImage } from '../glass-image';
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
  /** A faint pattern over a solid colour or gradient. Photos and uploads never get one. */
  texture?: BackgroundTexture;
  /**
   * The glass's blur and colour boost (Appearance › Advanced). Given, a photo is blurred
   * once for the cards that sit straight on it (glass-image.ts); the app shell passes it.
   */
  frost?: { blur: number; saturate: number };
  /**
   * One card over the whole window (Social on a phone): the photo blurred as the cards show
   * it, under the cards' own colour. True fades it in, false fades it out; left out, none.
   */
  sheet?: boolean;
}

/** Wait this long after the window stops changing size before blurring the photo again. */
const RESIZE_SETTLE_MS = 300;

/** What the blurred photo puts on <html> for the cards' panes (styles.css). */
const GLASS_IMAGE_VARS = [
  '--glass-image',
  '--glass-image-size',
  '--glass-image-x',
  '--glass-image-y',
];

/** A tile of fine noise: dark specks on a light background, light ones on a dark. */
function grainTile(light: boolean): string {
  const c = light ? 0 : 1;
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>" +
    "<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>" +
    `<feColorMatrix values='0 0 0 0 ${c} 0 0 0 0 ${c} 0 0 0 0 ${c} 1.6 0 0 0 -0.62'/></filter>` +
    "<rect width='100%' height='100%' filter='url(#g)'/></svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The texture layer's style over a background of the given luminance (0..1). */
export function textureStyle(texture: BackgroundTexture, luminance: number): CSSProperties | null {
  const light = luminance > 0.45;
  const mark = (a: number) => (light ? `rgb(30 26 18 / ${a})` : `rgb(255 255 255 / ${a})`);
  switch (texture) {
    case 'grain':
      return { backgroundImage: grainTile(light), opacity: light ? 0.1 : 0.08 };
    case 'dots':
      return {
        backgroundImage: `radial-gradient(circle, ${mark(light ? 0.16 : 0.11)} 1px, transparent 1.5px)`,
        backgroundSize: '20px 20px',
      };
    case 'grid':
      return {
        backgroundImage: `linear-gradient(${mark(light ? 0.06 : 0.045)} 1px, transparent 1px), linear-gradient(90deg, ${mark(light ? 0.06 : 0.045)} 1px, transparent 1px)`,
        backgroundSize: '32px 32px',
      };
    default:
      return null;
  }
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
 * that sits straight on the photo keeps the mode's own colour too, and the photo is washed
 * darker (or lighter) under it instead. A flat colour, which has no wash, keeps the text
 * that reads on it.
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
  const a = adaptToPhoto(avg, theme, kind === 'photo');
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
  texture = 'none',
  frost,
  sheet,
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
  const pattern = photo || customImageUrl ? null : textureStyle(texture, variant.luminance);

  // The photo blurred once for the cards' panes (glass-image.ts). Not for a PNG upload,
  // which may be see-through, and not with a colour boost: those cards keep blurring.
  const glassSrc = imageUrl?.startsWith('data:image/jpeg') ? imageUrl : imageUrl ? null : photoUrl;
  const glassBlur = frost && frost.saturate === 100 ? frost.blur : null;
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = layerRef.current;
    if (!glassSrc || glassBlur === null || !layer || !pinnedGlassWorks()) return;
    const root = document.documentElement;
    let cancelled = false;
    let image: GlassImage | null = null;
    let made = { width: 0, height: 0 };
    let settle = 0;
    const size = () => ({ width: layer.clientWidth, height: layer.clientHeight });
    // Where the photo lies on the backdrop now, so each card's strip shows its own part.
    const place = () => {
      if (!image) return;
      const { width, height } = size();
      const at = coverPlacement(image, width, height);
      root.style.setProperty('--glass-image-size', at.size);
      root.style.setProperty('--glass-image-x', at.x);
      root.style.setProperty('--glass-image-y', at.y);
    };
    const make = () => {
      made = size();
      makeGlassImage(glassSrc, glassBlur, made.width, made.height)
        .then((next) => {
          if (cancelled || !next) {
            if (next) URL.revokeObjectURL(next.url);
            return;
          }
          const old = image;
          image = next;
          root.style.setProperty('--glass-image', `url("${next.url}")`);
          place();
          root.dataset.glassImage = '';
          // Let the cards take the new image before the old one goes.
          if (old) window.setTimeout(() => URL.revokeObjectURL(old.url), 1000);
        })
        .catch(() => {});
    };
    // The photo covers the backdrop, so a much wider or taller window scales it, and the blur
    // with it: blur it again for the new size once the window settles.
    const sizes = new ResizeObserver(() => {
      place();
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        const now = size();
        const dw = Math.abs(now.width / made.width - 1);
        const dh = Math.abs(now.height / made.height - 1);
        if (dw > 0.05 || dh > 0.05) make();
      }, RESIZE_SETTLE_MS);
    });
    make();
    sizes.observe(layer);
    return () => {
      cancelled = true;
      window.clearTimeout(settle);
      sizes.disconnect();
      delete root.dataset.glassImage;
      for (const v of GLASS_IMAGE_VARS) root.style.removeProperty(v);
      if (image) URL.revokeObjectURL(image.url);
    };
  }, [glassSrc, glassBlur]);

  // What the backdrop lays over the photo, laid over the blurred copy the same way.
  const washCss = wash ? `rgb(${wash.color.join(' ')} / ${wash.alpha})` : null;
  const glassOver =
    photo || imageUrl
      ? [washCss && `linear-gradient(${washCss}, ${washCss})`, photoScrimCss(theme)]
          .filter(Boolean)
          .join(', ')
      : null;
  useEffect(() => {
    if (!glassOver) return;
    const root = document.documentElement;
    root.style.setProperty('--glass-image-over', glassOver);
    return () => {
      root.style.removeProperty('--glass-image-over');
    };
  }, [glassOver]);

  return (
    <div ref={layerRef} aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -1 }}>
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
      {pattern && <div style={{ position: 'absolute', inset: 0, ...pattern }} />}
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
            background: washCss ?? undefined,
          }}
        />
      )}
      {/* The card over everything (styles.css, .backdrop-sheet): the photo blurred, then the
          cards' colour. The photo blurred once for the panes, where there is one. */}
      {sheet !== undefined && (
        <div className={`backdrop-sheet${sheet ? ' is-on' : ''}`}>
          {(imageUrl || photoUrl) && (
            <div
              className="backdrop-sheet-photo"
              style={{ '--sheet-photo': `url("${imageUrl ?? photoUrl}")` } as CSSProperties}
            />
          )}
          <div className="backdrop-sheet-fill" />
        </div>
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
