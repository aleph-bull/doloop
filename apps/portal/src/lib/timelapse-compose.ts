import {
  pieceStyle,
  type TimelapseAlign,
  type TimelapseBox,
  type TimelapseColor,
  type TimelapseElementId,
  type TimelapseFont,
  type TimelapseLayout,
} from '@komogon/core';
import { LOGO_PATH, LOGO_VIEWBOX } from '@komogon/ui';

/**
 * Draws one frame of the timelapse from its layout: the camera across the whole frame, the
 * screen in its box, then the clocks, the task, the progress bar and the mark. The video
 * and the layout editor's preview both draw with this, so what is arranged is what comes
 * out, and it reports where each piece landed so the editor's boxes hug them exactly.
 */

/** The watermark's colour: black on a light corner, white on a dark one. */
export type WatermarkTone = '#000000' | '#ffffff';

export interface ComposeFrame {
  camera: CanvasImageSource | null;
  screen: CanvasImageSource | null;
  /** The time of day, "2:14 PM EST". */
  clock: string | null;
  /** The focus clock, "Focus 23:45" or "Break 03:10". */
  elapsed: string | null;
  /** Focus and breaks together, "Elapsed 41:02". */
  total?: string | null;
  /** When the session started and ended, "Start 9:10 AM". */
  start?: string | null;
  end?: string | null;
  title: string | null;
  /** The person's own line of text, the same on every frame. */
  note?: string | null;
  /** How far through the session this frame is, 0 to 1. */
  progress: number | null;
}

export interface ComposeOptions {
  /** The mark's colour, or null to leave it out (while its corner is being measured). */
  mark: WatermarkTone | null;
  /** Draw labelled stand-ins for a missing camera or screen, for the editor. */
  placeholders?: boolean;
}

/** A box in pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where each piece was drawn, in pixels of the frame. */
export type DrawnRects = Partial<Record<TimelapseElementId, Rect>>;

export const TIMELAPSE_BACKDROP = '#0b0d16';
const PILL_FILL = 'rgba(10, 12, 24, 0.55)';
const FONT = `'Inter Variable', Inter, system-ui, sans-serif`;

/** A picture's own size in pixels, whatever kind of source it is. */
export function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement)
    return { w: src.videoWidth || 1280, h: src.videoHeight || 720 };
  const s = src as { width: number | { baseVal: { value: number } }; height: unknown };
  const w = typeof s.width === 'number' ? s.width : 1280;
  const h = typeof s.height === 'number' ? s.height : 720;
  return { w: w || 1280, h: h || 720 };
}

const toRect = (b: TimelapseBox, w: number, h: number): Rect => ({
  x: b.x * w,
  y: b.y * h,
  w: b.w * w,
  h: b.h * h,
});

/** Where a piece `pw` wide starts in its box, holding to the box's side. */
function anchorX(r: Rect, pw: number, align: TimelapseAlign | undefined): number {
  if (align === 'right') return r.x + r.w - pw;
  if (align === 'center') return r.x + (r.w - pw) / 2;
  return r.x;
}

/** A piece of `pw` × `ph` pixels at (x, y), moved back inside the frame if it runs over. */
function keepInFrame(x: number, y: number, pw: number, ph: number, w: number, h: number): Rect {
  return {
    x: Math.max(0, Math.min(x, w - pw)),
    y: Math.max(0, Math.min(y, h - ph)),
    w: pw,
    h: ph,
  };
}

/** The camera fills the frame and is cropped to it, like a photo in a frame. */
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number) {
  const { w: sw, h: sh } = sourceSize(src);
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
}

/** The screen is shown whole inside its box, so nothing on it is cut off. */
function drawContain(ctx: CanvasRenderingContext2D, src: CanvasImageSource, r: Rect): Rect {
  const { w: sw, h: sh } = sourceSize(src);
  const scale = Math.min(r.w / sw, r.h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const fit = { x: r.x + (r.w - dw) / 2, y: r.y + (r.h - dh) / 2, w: dw, h: dh };
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(fit.x, fit.y, fit.w, fit.h, Math.round(Math.min(fit.w, fit.h) * 0.04));
  ctx.clip();
  ctx.drawImage(src, fit.x, fit.y, fit.w, fit.h);
  ctx.restore();
  return fit;
}

/** A flat, labelled stand-in for a picture the editor does not have. */
function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number,
  fill: string,
  label: string,
  /** The screen, when it sits on the camera: the label moves out from under it. */
  over: Rect | null,
) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fill();
  const size = Math.max(10, Math.min(r.h * 0.12, r.w * 0.09, 28));
  ctx.font = `500 ${size}px ${FONT}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const inside = (x: number, y: number, q: Rect) =>
    x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h;
  const spots: Array<[number, number]> = [
    [0.5, 0.5],
    [0.5, 0.85],
    [0.5, 0.15],
    [0.2, 0.5],
    [0.8, 0.5],
  ];
  const [fx, fy] =
    spots.find(([a, b]) => !over || !inside(r.x + r.w * a, r.y + r.h * b, over)) ?? spots[0]!;
  ctx.fillText(label, r.x + r.w * fx, r.y + r.h * fy);
  ctx.restore();
}

/**
 * Each colour as text (light, on a dark pill, an outline or the camera itself) and as the
 * fill of a coloured pill, which carries white text. Muted, like the app's own accents.
 */
export const TIMELAPSE_COLOR_HEX: Record<TimelapseColor, { text: string; fill: string }> = {
  white: { text: '#ffffff', fill: 'rgba(255, 255, 255, 0.26)' },
  gold: { text: '#f1d48e', fill: '#86672b' },
  mint: { text: '#a9dfcf', fill: '#2d6a5a' },
  sky: { text: '#accaf2', fill: '#34507d' },
  rose: { text: '#f1b8c5', fill: '#7a3a4b' },
  lilac: { text: '#cebff1', fill: '#53467e' },
};

/** The typefaces, as the canvas names them. The geometric one is the wordmark's. */
export const TIMELAPSE_FONT_FAMILY: Record<TimelapseFont, string> = {
  sans: FONT,
  geometric: `Satoshi, ${FONT}`,
  mono: `ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, Menlo, monospace`,
  serif: `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`,
};
/** A typeface's weight for the words that matter, and for the small label beside them. */
const WEIGHTS: Record<TimelapseFont, [number, number]> = {
  sans: [600, 450],
  geometric: [700, 500],
  mono: [600, 450],
  serif: [600, 400],
};

/** One run of a piece's text, and whether it is the small part beside the number. */
type Part = { text: string; small: boolean };

const LABEL = /^(Focus|Break|Elapsed|Start|End) (.+)$/;
const SUFFIX = /^(.*\d)\s+([AP]M(?:\s+\S+)?)$/;

/**
 * A clock's text split into its label, its number and the end of a time of day: "Focus"
 * and "42:17", "2:14" and "PM EST". The label and the ending are drawn smaller, so the
 * number reads first. The task and the person's text stay whole.
 */
function textParts(id: TimelapseElementId, text: string): Part[] {
  if (id === 'title' || id === 'note') return [{ text, small: false }];
  const parts: Part[] = [];
  let rest = text;
  const label = LABEL.exec(text);
  if (label) {
    parts.push({ text: label[1]!, small: true });
    rest = label[2]!;
  }
  const end = SUFFIX.exec(rest);
  if (end) parts.push({ text: end[1]!, small: false }, { text: end[2]!, small: true });
  else parts.push({ text: rest, small: false });
  return parts;
}

/** A number measured as if every digit were a 0, so a pill doesn't twitch as the clock runs. */
const steady = (text: string) => text.replace(/\d/g, '0');

/**
 * A text piece exactly the box's height, as wide as the text needs, holding to the box's
 * left, middle or right (moved in if it would run out of the frame). It sits on a dark pill,
 * a pill of its colour, an outline, or on nothing with a soft shadow under it.
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  id: TimelapseElementId,
  text: string,
  w: number,
  h: number,
  box: TimelapseBox,
): Rect {
  const { pill, font, color } = pieceStyle(box);
  const family = TIMELAPSE_FONT_FAMILY[font];
  const [heavy, light] = WEIGHTS[font];
  const parts = textParts(id, text);
  const clocklike = id !== 'title' && id !== 'note';
  const fontOf = (p: Part, size: number) =>
    p.small ? `${light} ${size * 0.7}px ${family}` : `${heavy} ${size}px ${family}`;
  const measure = (size: number) => {
    const gap = size * 0.24;
    const widths = parts.map((p) => {
      ctx.font = fontOf(p, size);
      return ctx.measureText(clocklike && !p.small ? steady(p.text) : p.text).width;
    });
    return { gap, widths, tw: widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1) };
  };
  const padOf = (size: number) => (pill === 'none' ? size * 0.12 : size * 0.55);
  ctx.save();
  let size = r.h / 1.55;
  let m = measure(size);
  // Wider than the frame: shrink it so the whole piece still shows.
  if (m.tw + padOf(size) * 2 > w) {
    size *= w / (m.tw + padOf(size) * 2);
    m = measure(size);
  }
  const pad = padOf(size);
  const pw = m.tw + pad * 2;
  const at = keepInFrame(anchorX(r, pw, box.align), r.y, pw, size * 1.55, w, h);
  const hue = TIMELAPSE_COLOR_HEX[color];
  const radius = at.h / 2;
  if (pill === 'dark' || pill === 'solid') {
    ctx.fillStyle = pill === 'dark' ? PILL_FILL : hue.fill;
    ctx.beginPath();
    ctx.roundRect(at.x, at.y, at.w, at.h, radius);
    ctx.fill();
  } else if (pill === 'outline') {
    const line = Math.max(1, size * 0.075);
    ctx.fillStyle = 'rgba(10, 12, 24, 0.22)';
    ctx.strokeStyle = hue.text;
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.roundRect(at.x + line / 2, at.y + line / 2, at.w - line, at.h - line, radius - line / 2);
    ctx.fill();
    ctx.stroke();
  }
  // Bare text, or white on a pale pill: a soft shadow keeps it readable on a bright room.
  if (pill === 'none' || (pill === 'solid' && color === 'white')) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = size * (pill === 'none' ? 0.45 : 0.25);
    ctx.shadowOffsetY = size * 0.04;
  }
  ctx.fillStyle = pill === 'solid' ? '#ffffff' : hue.text;
  // Every part on one baseline, the capitals centred in the pill.
  const main = parts.find((p) => !p.small) ?? parts[0]!;
  ctx.font = fontOf(main, size);
  const cap = ctx.measureText('H').actualBoundingBoxAscent || size * 0.72;
  const baseline = at.y + at.h / 2 + cap / 2;
  ctx.textBaseline = 'alphabetic';
  let x = at.x + pad;
  parts.forEach((p, i) => {
    ctx.font = fontOf(p, size);
    ctx.globalAlpha = p.small ? 0.72 : 1;
    ctx.fillText(p.text, x, baseline);
    x += m.widths[i]! + m.gap;
  });
  ctx.restore();
  return at;
}

/** A thin bar that fills from the left as the session goes on, in the piece's colour. */
function drawProgress(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  fraction: number,
  color: TimelapseColor,
) {
  const radius = Math.min(r.h, r.w) / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(10, 12, 24, 0.45)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fill();
  const f = Math.max(0, Math.min(1, fraction));
  if (f > 0) {
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = TIMELAPSE_COLOR_HEX[color].text;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, Math.max(r.h, r.w * f), r.h, radius);
    ctx.fill();
  }
  ctx.restore();
}

const LOGO_SHAPE = typeof Path2D !== 'undefined' ? new Path2D(LOGO_PATH) : null;
const [LOGO_X, LOGO_Y, LOGO_SIZE] = LOGO_VIEWBOX.split(' ').map(Number) as [number, number, number];

/** The Komodon mark and wordmark, as in the portal nav, its height the box's. */
function drawWatermark(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tone: WatermarkTone | null,
  w: number,
  h: number,
  align: TimelapseAlign | undefined,
): Rect {
  const size = r.h;
  const text = 'Komodon';
  ctx.save();
  ctx.font = `600 ${Math.round(size * 0.78)}px Satoshi, ${FONT}`;
  const tw = ctx.measureText(text).width;
  const mw = size * 1.35 + tw;
  const at = keepInFrame(anchorX(r, mw, align), r.y, mw, size, w, h);
  if (tone) {
    const cy = at.y + size / 2;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = tone;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, at.x + size * 1.35, cy + 1);
    if (LOGO_SHAPE) {
      ctx.translate(at.x, cy - size / 2);
      ctx.scale(size / LOGO_SIZE, size / LOGO_SIZE);
      ctx.translate(-LOGO_X, -LOGO_Y);
      ctx.fill(LOGO_SHAPE, 'evenodd');
    }
  }
  ctx.restore();
  return at;
}

/** One whole frame, from the backdrop up. Returns where each piece was drawn. */
export function composeFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  layout: TimelapseLayout,
  frame: ComposeFrame,
  opts: ComposeOptions,
): DrawnRects {
  const drawn: DrawnRects = {};
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.fillStyle = TIMELAPSE_BACKDROP;
  ctx.fillRect(0, 0, w, h);
  const full = { x: 0, y: 0, w, h };
  const screenBox = layout.screen.visible ? toRect(layout.screen, w, h) : null;
  if (frame.camera) drawCover(ctx, frame.camera, w, h);
  else if (opts.placeholders) drawPlaceholder(ctx, full, 0, '#3b4157', 'Camera', screenBox);
  drawn.camera = full;
  if (screenBox) {
    // No screen still (the screen was not shared this time): nothing is drawn, and the
    // camera shows through. The editor shows a stand-in.
    if (frame.screen) drawn.screen = drawContain(ctx, frame.screen, screenBox);
    else if (opts.placeholders) {
      drawPlaceholder(
        ctx,
        screenBox,
        Math.round(Math.min(screenBox.w, screenBox.h) * 0.04),
        '#262b3d',
        'Screen',
        null,
      );
      drawn.screen = screenBox;
    }
  }
  const texts: Array<
    ['clock' | 'elapsed' | 'total' | 'start' | 'end' | 'title' | 'note', string | null]
  > = [
    ['clock', frame.clock],
    ['elapsed', frame.elapsed],
    ['total', frame.total ?? null],
    ['start', frame.start ?? null],
    ['end', frame.end ?? null],
    ['title', frame.title],
    ['note', frame.note ?? null],
  ];
  for (const [id, text] of texts) {
    const box = layout[id];
    if (box.visible && text) drawn[id] = drawText(ctx, toRect(box, w, h), id, text, w, h, box);
  }
  if (layout.progress.visible && frame.progress !== null) {
    drawn.progress = toRect(layout.progress, w, h);
    drawProgress(ctx, drawn.progress, frame.progress, layout.progress.color ?? 'white');
  }
  drawn.watermark = drawWatermark(
    ctx,
    toRect(layout.watermark, w, h),
    opts.mark,
    w,
    h,
    layout.watermark.align,
  );
  ctx.restore();
  return drawn;
}

/** Average brightness, 0..1, of one area of what is on the canvas. */
export function rectLuma(ctx: CanvasRenderingContext2D, w: number, h: number, r: Rect): number {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const bw = Math.max(1, Math.min(w - x, Math.ceil(r.w)));
  const bh = Math.max(1, Math.min(h - y, Math.ceil(r.h)));
  const d = ctx.getImageData(x, y, bw, bh).data;
  let sum = 0;
  // Every fourth pixel is plenty for an average.
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    n++;
  }
  return n ? sum / n / 255 : 0;
}
