/**
 * How the timelapse video is laid out: its shape, and where each piece sits in it. Every
 * piece is a box in fractions of the frame (0 to 1 on each side), so one layout fits any
 * size the video is made at. The drawing lives in the portal; this is the arithmetic.
 *
 * The camera is the backdrop: it always fills the whole frame and can't be moved or taken
 * out. Everything else sits on top of it.
 */

/** The pieces a timelapse can show. The camera and the screen are pictures; the rest are drawn. */
export type TimelapseElementId =
  | 'camera'
  | 'screen'
  | 'clock'
  | 'elapsed'
  | 'total'
  | 'start'
  | 'end'
  | 'title'
  | 'note'
  | 'progress'
  | 'watermark';

/** The order they are listed in, in the settings and the editor. */
export const TIMELAPSE_ELEMENTS: readonly TimelapseElementId[] = [
  'camera',
  'screen',
  'clock',
  'elapsed',
  'total',
  'start',
  'end',
  'title',
  'note',
  'progress',
  'watermark',
];

/** The pieces that sit on the camera and can be moved: all but the camera. */
export const TIMELAPSE_MOVABLE: readonly TimelapseElementId[] = TIMELAPSE_ELEMENTS.filter(
  (id) => id !== 'camera',
);

/** Pieces that are a line of text in a pill (or the mark): their width follows their height. */
export const TIMELAPSE_TEXT_ELEMENTS: readonly TimelapseElementId[] = [
  'clock',
  'elapsed',
  'total',
  'start',
  'end',
  'title',
  'note',
  'watermark',
];

/** Text pieces that can be restyled: all but the mark, which stays as it is. */
export const TIMELAPSE_STYLED_TEXT: readonly TimelapseElementId[] = TIMELAPSE_TEXT_ELEMENTS.filter(
  (id) => id !== 'watermark',
);

/** Whether a piece takes a pill and a font (the texts), or only a colour (the progress bar). */
export const takesPill = (id: TimelapseElementId) => TIMELAPSE_STYLED_TEXT.includes(id);
export const takesColor = (id: TimelapseElementId) => takesPill(id) || id === 'progress';

/** What each piece is called where people see it. */
export const TIMELAPSE_ELEMENT_LABELS: Record<TimelapseElementId, string> = {
  camera: 'Camera',
  screen: 'Screen',
  clock: 'Current time',
  elapsed: 'Focus time',
  total: 'Time elapsed',
  start: 'Start time',
  end: 'End time',
  title: 'Task name',
  note: 'Your text',
  progress: 'Progress bar',
  watermark: 'Komodon mark',
};

/**
 * One piece's place in the frame, in fractions of its width and height. For a text piece
 * (x, y) is the top left of its pill and `h` its height; the width is whatever the text
 * takes at that height, and `w` only records it as last measured.
 */
export interface TimelapseBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Shown in the video. */
  visible: boolean;
  /**
   * For a text piece, which side of its box the text holds to, so a longer real task name
   * grows away from that side: from the left edge, out from the middle, or back from the
   * right edge. Left when absent.
   */
  align?: TimelapseAlign;
  /** What a text piece sits on; a dark pill when absent. Not the mark. */
  pill?: TimelapsePill;
  /** A text piece's typeface; the app's own sans when absent. Not the mark. */
  font?: TimelapseFont;
  /** A text piece's or the progress bar's colour; white when absent. */
  color?: TimelapseColor;
}

export type TimelapseAlign = 'left' | 'center' | 'right';

/** What a text piece sits on: a dark pill, a pill of its colour, an outline, or nothing. */
export type TimelapsePill = 'dark' | 'solid' | 'outline' | 'none';
export type TimelapseFont = 'sans' | 'geometric' | 'mono' | 'serif';
export type TimelapseColor = 'white' | 'gold' | 'mint' | 'sky' | 'rose' | 'lilac';

export const TIMELAPSE_PILLS: readonly TimelapsePill[] = ['dark', 'solid', 'outline', 'none'];
export const TIMELAPSE_FONTS: readonly TimelapseFont[] = ['sans', 'geometric', 'mono', 'serif'];
export const TIMELAPSE_COLORS: readonly TimelapseColor[] = [
  'white',
  'gold',
  'mint',
  'sky',
  'rose',
  'lilac',
];

export const TIMELAPSE_PILL_LABELS: Record<TimelapsePill, string> = {
  dark: 'Dark',
  solid: 'Colour',
  outline: 'Outline',
  none: 'None',
};
export const TIMELAPSE_FONT_LABELS: Record<TimelapseFont, string> = {
  sans: 'Sans',
  geometric: 'Geometric',
  mono: 'Mono',
  serif: 'Serif',
};
export const TIMELAPSE_COLOR_LABELS: Record<TimelapseColor, string> = {
  white: 'White',
  gold: 'Gold',
  mint: 'Mint',
  sky: 'Sky',
  rose: 'Rose',
  lilac: 'Lilac',
};

/** How a piece is drawn, with the defaults filled in. */
export interface TimelapsePieceStyle {
  pill: TimelapsePill;
  font: TimelapseFont;
  color: TimelapseColor;
}

export const TIMELAPSE_PLAIN_STYLE: TimelapsePieceStyle = {
  pill: 'dark',
  font: 'sans',
  color: 'white',
};

export function pieceStyle(b: Pick<TimelapseBox, 'pill' | 'font' | 'color'>): TimelapsePieceStyle {
  return {
    pill: b.pill ?? 'dark',
    font: b.font ?? 'sans',
    color: b.color ?? 'white',
  };
}

/** Whether two pieces are drawn alike: the same side, pill, font and colour. */
export function sameLook(a: TimelapseBox, b: TimelapseBox): boolean {
  const x = pieceStyle(a);
  const y = pieceStyle(b);
  return (
    (a.align ?? 'left') === (b.align ?? 'left') &&
    x.pill === y.pill &&
    x.font === y.font &&
    x.color === y.color
  );
}

/** The gap kept from the frame's sides when a piece is lined up against one. */
export const TIMELAPSE_ALIGN_MARGIN = 0.04;

/**
 * A box lined up in the frame: against the left side, in the middle, or against the right
 * side, keeping its size and height. A piece that spans the frame lines up against the
 * edge itself.
 */
export function alignBox(b: TimelapseBox, align: TimelapseAlign): TimelapseBox {
  const margin = b.w > 1 - TIMELAPSE_ALIGN_MARGIN * 2 ? 0 : TIMELAPSE_ALIGN_MARGIN;
  const x = align === 'left' ? margin : align === 'right' ? 1 - margin - b.w : (1 - b.w) / 2;
  return { ...b, x: Math.max(0, Math.min(1 - b.w, x)) };
}

export type TimelapseLayout = Record<TimelapseElementId, TimelapseBox>;

/**
 * The shape of the video. 'camera' follows the shape the camera films in, 'screen' the
 * shape of the screen.
 */
export type TimelapseAspect = 'camera' | 'screen' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3';

export const TIMELAPSE_ASPECTS: readonly TimelapseAspect[] = [
  'camera',
  'screen',
  '16:9',
  '9:16',
  '1:1',
  '4:5',
  '4:3',
];

/** The smallest a box can be made, so it never shrinks to nothing under the pointer. */
export const TIMELAPSE_MIN_BOX = 0.04;
/** Text pieces may be a little smaller. */
export const TIMELAPSE_MIN_TEXT = 0.025;
/** The progress bar may be thinner than other boxes. */
export const TIMELAPSE_MIN_BAR = 0.006;
/** The longest side of the finished video, in pixels. */
export const TIMELAPSE_LONG_SIDE = 1280;
/** A screen's shape before any has been seen. */
export const TIMELAPSE_DEFAULT_SCREEN_RATIO = 16 / 9;

const validRatio = (r: number | null | undefined): r is number =>
  typeof r === 'number' && Number.isFinite(r) && r > 0;

/**
 * Width over height for a shape. 'camera' and 'screen' need the measured shape, and use
 * 16:9 until it is known.
 */
export function aspectRatio(
  aspect: TimelapseAspect,
  cameraRatio?: number | null,
  screenRatio?: number | null,
): number {
  if (aspect === 'camera') return validRatio(cameraRatio) ? cameraRatio : 16 / 9;
  if (aspect === 'screen') return validRatio(screenRatio) ? screenRatio : 16 / 9;
  const [a, b] = aspect.split(':').map(Number) as [number, number];
  return a / b;
}

/** The video's size in pixels for a ratio: the long side fixed, both sides even for H.264. */
export function videoSize(ratio: number, longSide = TIMELAPSE_LONG_SIDE): { w: number; h: number } {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return r >= 1
    ? { w: even(longSide), h: even(longSide / r) }
    : { w: even(longSide * r), h: even(longSide) };
}

const box = (
  x: number,
  y: number,
  w: number,
  h: number,
  visible = true,
  align?: TimelapseAlign,
): TimelapseBox => (align ? { x, y, w, h, visible, align } : { x, y, w, h, visible });

/** The camera's box: always the whole frame. */
export const CAMERA_BOX: TimelapseBox = box(0, 0, 1, 1);

/**
 * The screen's box reshaped to the screen's own shape, so the picture fills it exactly:
 * the width is kept and the height follows, and if that runs out of the frame the box
 * shrinks until it fits. `frameRatio` and `screenRatio` are width over height in pixels.
 */
export function fitBoxToRatio(
  b: TimelapseBox,
  frameRatio: number,
  screenRatio: number,
): TimelapseBox {
  const fr = validRatio(frameRatio) ? frameRatio : 16 / 9;
  const sr = validRatio(screenRatio) ? screenRatio : TIMELAPSE_DEFAULT_SCREEN_RATIO;
  // In fractions of the frame, height = width × (frame width / frame height) / screen ratio.
  let w = b.w;
  let h = (w * fr) / sr;
  const scale = Math.min(1, 1 / h, 1 / w);
  w *= scale;
  h *= scale;
  return {
    x: Math.min(Math.max(0, b.x), 1 - w),
    y: Math.min(Math.max(0, b.y), 1 - h),
    w,
    h,
    visible: b.visible,
  };
}

/**
 * A starting layout for a shape, after the owner's sketch: the time of day top left, the
 * screen top right, the time elapsed bottom left, the task bottom right, the camera behind.
 * Tall videos stack the same pieces instead. The screen starts out of the layout, waiting
 * under the editor to be added, and so do the time elapsed and the start and end times. The person's own text sits under the time of day; it is
 * drawn only once there is some.
 */
export function defaultTimelapseLayout(
  ratio = 16 / 9,
  screenRatio = TIMELAPSE_DEFAULT_SCREEN_RATIO,
): TimelapseLayout {
  const fit = (b: TimelapseBox) => fitBoxToRatio(b, ratio, screenRatio);
  if (ratio < 0.9) {
    return {
      camera: { ...CAMERA_BOX },
      screen: fit(box(0.05, 0.1, 0.9, 0.3, false)),
      clock: box(0.05, 0.035, 0.3, 0.04),
      elapsed: box(0.05, 0.86, 0.25, 0.045),
      total: box(0.05, 0.74, 0.25, 0.045, false),
      start: box(0.05, 0.135, 0.3, 0.035, false),
      end: box(0.05, 0.18, 0.3, 0.035, false),
      title: box(0.05, 0.8, 0.6, 0.045),
      note: box(0.05, 0.085, 0.7, 0.04),
      progress: box(0, 0.988, 1, 0.012),
      watermark: box(0.62, 0.93, 0.33, 0.03, true, 'right'),
    };
  }
  if (ratio < 1.2) {
    return {
      camera: { ...CAMERA_BOX },
      screen: fit(box(0.45, 0.05, 0.5, 0.36, false)),
      clock: box(0.05, 0.05, 0.3, 0.06),
      elapsed: box(0.05, 0.86, 0.2, 0.065),
      total: box(0.05, 0.68, 0.2, 0.065, false),
      start: box(0.05, 0.2, 0.3, 0.055, false),
      end: box(0.05, 0.27, 0.3, 0.055, false),
      title: box(0.05, 0.77, 0.5, 0.065),
      note: box(0.05, 0.125, 0.6, 0.055),
      progress: box(0, 0.986, 1, 0.014),
      watermark: box(0.72, 0.89, 0.23, 0.045, true, 'right'),
    };
  }
  return {
    camera: { ...CAMERA_BOX },
    screen: fit(box(0.5, 0.06, 0.46, 0.46, false)),
    clock: box(0.04, 0.06, 0.2, 0.08),
    elapsed: box(0.04, 0.84, 0.12, 0.08),
    total: box(0.04, 0.74, 0.12, 0.08, false),
    start: box(0.04, 0.25, 0.2, 0.07, false),
    end: box(0.04, 0.33, 0.2, 0.07, false),
    title: box(0.5, 0.76, 0.46, 0.08, true, 'right'),
    note: box(0.04, 0.16, 0.5, 0.07),
    progress: box(0, 0.982, 1, 0.018),
    watermark: box(0.7, 0.88, 0.26, 0.055, true, 'right'),
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The smallest side a piece may have. */
export function minBoxSide(id: TimelapseElementId, side: 'w' | 'h'): number {
  if (id === 'progress' && side === 'h') return TIMELAPSE_MIN_BAR;
  if (TIMELAPSE_TEXT_ELEMENTS.includes(id)) return TIMELAPSE_MIN_TEXT;
  return TIMELAPSE_MIN_BOX;
}

/** A box kept inside the frame and no smaller than its piece allows. The camera fills it. */
export function clampBox(id: TimelapseElementId, b: TimelapseBox): TimelapseBox {
  if (id === 'camera') return { ...CAMERA_BOX };
  const w = clamp(b.w, minBoxSide(id, 'w'), 1);
  const h = clamp(b.h, minBoxSide(id, 'h'), 1);
  const out: TimelapseBox = {
    x: clamp(b.x, 0, 1 - w),
    y: clamp(b.y, 0, 1 - h),
    w,
    h,
    visible: b.visible,
  };
  if (b.align && b.align !== 'left' && TIMELAPSE_TEXT_ELEMENTS.includes(id)) out.align = b.align;
  // Only what differs from the plain look is kept, like the side.
  if (takesPill(id)) {
    if (b.pill && b.pill !== 'dark' && TIMELAPSE_PILLS.includes(b.pill)) out.pill = b.pill;
    if (b.font && b.font !== 'sans' && TIMELAPSE_FONTS.includes(b.font)) out.font = b.font;
  }
  if (takesColor(id) && b.color && b.color !== 'white' && TIMELAPSE_COLORS.includes(b.color))
    out.color = b.color;
  return out;
}

/** A piece with its pill, font and colour changed; the rest of it as it was. */
export function restyleBox(
  id: TimelapseElementId,
  b: TimelapseBox,
  style: Partial<TimelapsePieceStyle>,
): TimelapseBox {
  return clampBox(id, { ...b, ...pieceStyle({ ...pieceStyle(b), ...style }) });
}

/**
 * A layout read back from storage, made whole: a missing or malformed piece takes the
 * default's place, every box is kept in the frame, and the camera and the mark are always
 * there, the camera across the whole frame.
 */
export function normalizeTimelapseLayout(
  raw: unknown,
  fallback: TimelapseLayout = defaultTimelapseLayout(),
): TimelapseLayout {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as TimelapseLayout;
  for (const id of TIMELAPSE_ELEMENTS) {
    const r = src[id] && typeof src[id] === 'object' ? (src[id] as Record<string, unknown>) : {};
    const d = fallback[id];
    // A piece that was saved keeps what it says; one that wasn't takes the fallback's.
    const saved = r.x !== undefined;
    const pick = <T extends string>(v: unknown, list: readonly T[], from: T | undefined) =>
      list.includes(v as T) ? (v as T) : saved ? undefined : from;
    out[id] = clampBox(id, {
      x: num(r.x) ?? d.x,
      y: num(r.y) ?? d.y,
      w: num(r.w) ?? d.w,
      h: num(r.h) ?? d.h,
      visible: typeof r.visible === 'boolean' ? r.visible : d.visible,
      align: pick(r.align, ['left', 'center', 'right'] as const, d.align),
      pill: pick(r.pill, TIMELAPSE_PILLS, d.pill),
      font: pick(r.font, TIMELAPSE_FONTS, d.font),
      color: pick(r.color, TIMELAPSE_COLORS, d.color),
    });
  }
  out.watermark.visible = true;
  return out;
}

/** Whether a piece can be taken out: never the camera or the mark. */
export function canHideElement(id: TimelapseElementId): boolean {
  return id !== 'camera' && id !== 'watermark';
}
