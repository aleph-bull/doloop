/**
 * Contrast audit for every shipped background in both themes (spec §8, §14).
 *
 * Estimates the average colour under a panel by compositing the gradient stops of each
 * background, then composites the glass and panel fills over it and checks WCAG contrast
 * for primary, muted and subtle text, on glass, on panels and straight on the backdrop
 * (page titles). Photos go through the same adaptation the Backdrop runs, per theme. The
 * accent presets are checked as text and as a button label. Fails (exit 1) if any
 * combination is below 4.5:1.
 *
 * Run: pnpm --filter @komogon/ui audit:contrast
 */
import { BACKGROUND_DEFS } from '../src/backgrounds';
import { adaptToPhoto, composite, contrastRatio, hslToRgb, type RGB } from '../src/contrast';
import { accentFill, readableAccent } from '../src/theme';

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
    fgMuted: [71, 77, 99],
    fgOnGlass: [15, 18, 32],
    glassFill: { rgb: [255, 255, 255], alpha: 0.6 },
    glassStrong: { rgb: [255, 255, 255], alpha: 0.78 },
    panelFill: { rgb: [255, 255, 255], alpha: 0.9 },
  },
  {
    name: 'dark',
    fg: [244, 245, 249],
    fgMuted: [184, 189, 207],
    fgOnGlass: [244, 245, 249],
    glassFill: { rgb: [22, 24, 36], alpha: 0.5 },
    glassStrong: { rgb: [22, 24, 36], alpha: 0.7 },
    panelFill: { rgb: [20, 22, 34], alpha: 0.94 },
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

/** On-glass muted and subtle text are the glass text colour at 76% and 64% (tokens.css). */
const MUTED = 0.76;
const SUBTLE = 0.64;

function check(id: string, theme: string, label: string, fg: RGB, surface: RGB): void {
  const ratio = contrastRatio(fg, surface);
  const ok = ratio >= 4.5;
  if (!ok) failures++;
  rows.push(
    `${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(13)} ${theme.padEnd(5)} ${label.padEnd(22)} ${ratio.toFixed(2)}:1`,
  );
}

/**
 * A photograph does not use the static glass tokens: `Backdrop` thickens the fill until
 * text clears 4.5:1, using the average colour baked in at build time. So the check here is
 * that the adaptation can reach 4.5:1 at all — a photo busy enough to need more than 95%
 * opacity would be unreadable, and should not ship.
 */
function auditPhoto(bg: (typeof BACKGROUND_DEFS)[number]): void {
  const avg = bg.photo!.avg as RGB;
  for (const t of ['light', 'dark'] as const) {
    const a = adaptToPhoto(avg, t);
    const scrim = t === 'dark' ? ([6, 7, 10] as RGB) : ([255, 255, 255] as RGB);
    const shown = composite(scrim, t === 'dark' ? 0.42 : 0.24, avg);
    const washed = composite(a.fill, a.pageScrim, shown);
    const glass = composite(a.fill, a.alpha, shown);
    check(bg.id, t, `glass @ ${Math.round(a.alpha * 100)}%`, a.fg, glass);
    check(bg.id, t, 'muted on glass', composite(a.fg, MUTED, glass), glass);
    check(bg.id, t, 'subtle on glass', composite(a.fg, SUBTLE, glass), glass);
    check(bg.id, t, `page text, wash ${Math.round(a.pageScrim * 100)}%`, a.fg, washed);
  }

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
    const glass = composite(theme.glassFill.rgb, theme.glassFill.alpha, avg);
    const checks: Array<[string, RGB, RGB]> = [
      ['fg on glass', theme.fgOnGlass, glass],
      ['subtle on glass', composite(theme.fgOnGlass, SUBTLE, glass), glass],
      ['page text', theme.fgOnGlass, avg],
      ['muted page text', composite(theme.fgOnGlass, MUTED, avg), avg],
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

// The accent presets: as link text on light and dark surfaces, and as a button's label.
const PRESETS: Record<string, [number, number, number]> = {
  indigo: [240, 84, 62],
  sky: [199, 89, 48],
  mint: [160, 64, 42],
  amber: [38, 92, 50],
  rose: [346, 77, 56],
  violet: [271, 81, 60],
};
const parseHsl = (css: string): RGB => {
  const m = css.match(/hsl\((\d+) (\d+)% (\d+)%\)/)!;
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
};
for (const [name, hsl] of Object.entries(PRESETS)) {
  check(
    name,
    'light',
    'accent text',
    parseHsl(readableAccent(hsl, [244, 245, 248])),
    [244, 245, 248],
  );
  check(name, 'dark', 'accent text', parseHsl(readableAccent(hsl, [30, 32, 44])), [30, 32, 44]);
  // Button labels are always white, on the accent deepened as far as white needs.
  check(name, 'both', 'white button label', [255, 255, 255], parseHsl(accentFill(hsl)));
}

console.log(rows.join('\n'));
console.log(
  failures === 0
    ? '\nAll background/theme combinations reach 4.5:1.'
    : `\n${failures} combination(s) below 4.5:1.`,
);
process.exit(failures === 0 ? 0 : 1);
