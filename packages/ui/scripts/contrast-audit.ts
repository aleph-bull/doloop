/**
 * Contrast audit for every shipped background in both themes (spec §8, §14).
 *
 * Estimates the average colour under a panel by compositing the gradient stops of each
 * background, then composites the glass and panel fills over it and checks WCAG contrast
 * for primary and muted text. Fails (exit 1) if any combination is below 4.5:1.
 *
 * Run: pnpm --filter @komodoit/ui audit:contrast
 */
import { BACKGROUND_DEFS } from '../src/backgrounds';
import {
  adaptGlassToBackdrop,
  composite,
  contrastRatio,
  hslToRgb,
  type RGB,
} from '../src/contrast';

interface Theme {
  name: 'light' | 'dark';
  fg: RGB;
  fgMuted: RGB;
  fgOnGlass: RGB;
  glassFill: { rgb: RGB; alpha: number };
  glassStrong: { rgb: RGB; alpha: number };
  panelFill: { rgb: RGB; alpha: number };
}

// Mirrors tokens.css. Keep in sync when tokens change.
const THEMES: Theme[] = [
  {
    name: 'light',
    fg: [15, 18, 32],
    fgMuted: [75, 81, 104],
    fgOnGlass: [15, 18, 32],
    glassFill: { rgb: [255, 255, 255], alpha: 0.55 },
    glassStrong: { rgb: [255, 255, 255], alpha: 0.72 },
    panelFill: { rgb: [255, 255, 255], alpha: 0.92 },
  },
  {
    name: 'dark',
    fg: [242, 243, 248],
    fgMuted: [179, 184, 204],
    fgOnGlass: [242, 243, 248],
    glassFill: { rgb: [20, 22, 36], alpha: 0.45 },
    glassStrong: { rgb: [20, 22, 36], alpha: 0.65 },
    panelFill: { rgb: [21, 24, 39], alpha: 0.94 },
  },
];

function parseColor(token: string): { rgb: RGB; alpha: number } | null {
  const hex = token.match(/#([0-9a-f]{6})\b/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const hsl = token.match(
    /hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%(?:\s*\/\s*(\d*\.?\d+))?\)/i,
  );
  if (hsl) {
    return {
      rgb: hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3])),
      alpha: hsl[4] ? Number(hsl[4]) : 1,
    };
  }
  return null;
}

/**
 * Average colour estimate: start from the mean of the base gradient's stops (the last
 * layer), then overlay every translucent glow at half its alpha (a glow covers roughly half
 * the viewport). Conservative enough for a 4.5:1 gate; the visual check is done in-browser.
 */
function averageBackground(css: string): RGB {
  const layers = css.split(/\),\s*(?=[a-z-]+\()/i);
  const base = layers[layers.length - 1] ?? '';
  const baseColors = [...base.matchAll(/#[0-9a-f]{6}/gi)].map((m) => parseColor(m[0])!.rgb);
  let avg: RGB = baseColors.length
    ? (baseColors
        .reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0])
        .map((v) => Math.round(v / baseColors.length)) as RGB)
    : [128, 128, 128];
  for (const layer of layers.slice(0, -1)) {
    for (const m of layer.matchAll(/hsl\([^)]*\)|#[0-9a-f]{6}/gi)) {
      const c = parseColor(m[0]);
      if (!c) continue;
      avg = composite(c.rgb, c.alpha * 0.5, avg);
    }
  }
  return avg;
}

let failures = 0;
const rows: string[] = [];

/**
 * A photograph does not use the static glass tokens: `Backdrop` thickens the fill until
 * text clears 4.5:1, using the average colour baked in at build time. So the check here is
 * that the adaptation can reach 4.5:1 at all — a photo busy enough to need more than 95%
 * opacity would be unreadable, and should not ship.
 */
function auditPhoto(bg: (typeof BACKGROUND_DEFS)[number]): void {
  const avg = bg.photo!.avg as RGB;
  const a = adaptGlassToBackdrop(avg);
  const ok = a.ratio >= 4.5;
  if (!ok) failures++;
  rows.push(
    `${ok ? 'PASS' : 'FAIL'}  ${bg.id.padEnd(13)} photo  adapted glass @ ${String(
      Math.round(a.alpha * 100),
    ).padStart(3)}%       ${a.ratio.toFixed(2)}:1`,
  );

  // Panels are opaque enough that they do not adapt; check them against the photo directly.
  for (const theme of THEMES) {
    const surface = composite(theme.panelFill.rgb, theme.panelFill.alpha, avg);
    for (const [label, fg] of [
      ['fg on panel', theme.fg],
      ['muted on panel', theme.fgMuted],
    ] as Array<[string, RGB]>) {
      const ratio = contrastRatio(fg, surface);
      const pass = ratio >= 4.5;
      if (!pass) failures++;
      rows.push(
        `${pass ? 'PASS' : 'FAIL'}  ${bg.id.padEnd(13)} ${theme.name.padEnd(5)} ${label.padEnd(22)} ${ratio.toFixed(2)}:1`,
      );
    }
  }
}

for (const bg of BACKGROUND_DEFS) {
  if (bg.photo) {
    auditPhoto(bg);
    continue;
  }
  for (const theme of THEMES) {
    const variant = theme.name === 'dark' ? bg.dark : bg.light;
    const avg = averageBackground(variant.css);
    const checks: Array<[string, RGB, RGB]> = [
      ['fg on glass', theme.fgOnGlass, composite(theme.glassFill.rgb, theme.glassFill.alpha, avg)],
      [
        'muted on strong glass',
        theme.fgMuted,
        composite(theme.glassStrong.rgb, theme.glassStrong.alpha, avg),
      ],
      ['fg on panel', theme.fg, composite(theme.panelFill.rgb, theme.panelFill.alpha, avg)],
      ['muted on panel', theme.fgMuted, composite(theme.panelFill.rgb, theme.panelFill.alpha, avg)],
    ];
    for (const [label, fg, surface] of checks) {
      const ratio = contrastRatio(fg, surface);
      const ok = ratio >= 4.5;
      if (!ok) failures++;
      rows.push(
        `${ok ? 'PASS' : 'FAIL'}  ${bg.id.padEnd(13)} ${theme.name.padEnd(5)} ${label.padEnd(22)} ${ratio.toFixed(2)}:1`,
      );
    }
  }
}

console.log(rows.join('\n'));
console.log(
  failures === 0
    ? '\nAll background/theme combinations reach 4.5:1.'
    : `\n${failures} combination(s) below 4.5:1.`,
);
process.exit(failures === 0 ? 0 : 1);
