import type { TimelapseBox, TimelapseElementId, TimelapseLayout } from '@komogon/core';
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
  /** The time studied, "23:45" or "Break 03:10". */
  elapsed: string | null;
  title: string | null;
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
 * A text in a dark pill, exactly the box's height, as wide as the text needs, starting at
 * the box's top left (moved in if it would run out of the frame).
 */
function drawPill(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  text: string,
  w: number,
  h: number,
): Rect {
  let size = r.h / 1.55;
  ctx.save();
  ctx.font = `600 ${size}px ${FONT}`;
  let tw = ctx.measureText(text).width;
  // Wider than the frame: shrink it so the whole pill still shows.
  if (tw + size * 1.1 > w) {
    size *= w / (tw + size * 1.1);
    ctx.font = `600 ${size}px ${FONT}`;
    tw = ctx.measureText(text).width;
  }
  const pad = size * 0.55;
  const at = keepInFrame(r.x, r.y, tw + pad * 2, size + pad, w, h);
  ctx.fillStyle = PILL_FILL;
  ctx.beginPath();
  ctx.roundRect(at.x, at.y, at.w, at.h, at.h / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x + pad, at.y + at.h / 2 + size * 0.04);
  ctx.restore();
  return at;
}

/** A thin bar that fills from the left as the session goes on. */
function drawProgress(ctx: CanvasRenderingContext2D, r: Rect, fraction: number) {
  const radius = Math.min(r.h, r.w) / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(10, 12, 24, 0.45)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fill();
  const f = Math.max(0, Math.min(1, fraction));
  if (f > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
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
): Rect {
  const size = r.h;
  const text = 'Komodon';
  ctx.save();
  ctx.font = `600 ${Math.round(size * 0.78)}px Satoshi, ${FONT}`;
  const tw = ctx.measureText(text).width;
  const at = keepInFrame(r.x, r.y, size * 1.35 + tw, size, w, h);
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
  const texts: Array<['clock' | 'elapsed' | 'title', string | null]> = [
    ['clock', frame.clock],
    ['elapsed', frame.elapsed],
    ['title', frame.title],
  ];
  for (const [id, text] of texts) {
    const box = layout[id];
    if (box.visible && text) drawn[id] = drawPill(ctx, toRect(box, w, h), text, w, h);
  }
  if (layout.progress.visible && frame.progress !== null) {
    drawn.progress = toRect(layout.progress, w, h);
    drawProgress(ctx, drawn.progress, frame.progress);
  }
  drawn.watermark = drawWatermark(ctx, toRect(layout.watermark, w, h), opts.mark, w, h);
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
