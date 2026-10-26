/**
 * Ready-made looks for the timelapse, to start from instead of arranging every piece by
 * hand, and the person's own line of text that stays on the video. A look places the
 * clocks, the task name, that text, the progress bar and the mark, and says how the texts
 * are drawn (their pill and font); the screen stays where the person put it.
 */
import {
  defaultTimelapseLayout,
  sameLook,
  TIMELAPSE_DEFAULT_SCREEN_RATIO,
  TIMELAPSE_MIN_BAR,
  type TimelapseAlign,
  type TimelapseBox,
  type TimelapseElementId,
  type TimelapseLayout,
  type TimelapsePieceStyle,
} from './timelapse-layout';

export type TimelapseStyleId =
  'classic' | 'minimal' | 'big-timer' | 'headline' | 'story' | 'mono' | 'corner' | 'clean';

export interface TimelapseStyle {
  id: TimelapseStyleId;
  name: string;
  /** What it shows, in a line. */
  description: string;
}

/** In the order they are offered. */
export const TIMELAPSE_STYLES: readonly TimelapseStyle[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'The time of day, the time studied and the task in the corners.',
  },
  { id: 'minimal', name: 'Minimal', description: 'Plain text, no pills.' },
  { id: 'big-timer', name: 'Big timer', description: 'The time studied, big, under the task.' },
  { id: 'headline', name: 'Headline', description: 'The task across the top, the time under it.' },
  {
    id: 'story',
    name: 'Story',
    description: 'A bar along the top, the time and the task low in the middle.',
  },
  { id: 'mono', name: 'Mono', description: 'Outlined, in mono.' },
  { id: 'corner', name: 'Corner', description: 'Everything small, in one corner.' },
  { id: 'clean', name: 'Clean', description: 'The camera, the mark and your text.' },
];

/** The pieces a look places; the others (the screen, the time elapsed, start and end) stay put. */
type StyledId = 'clock' | 'elapsed' | 'title' | 'note' | 'progress' | 'watermark';
const STYLED: readonly StyledId[] = ['clock', 'elapsed', 'title', 'note', 'progress', 'watermark'];

/** Text pieces a look draws its way but leaves where they are. */
const DRESSED: readonly TimelapseElementId[] = ['total', 'start', 'end'];

/** How a look draws its texts, unless it says otherwise for one of them. */
const REST: Record<TimelapseStyleId, Partial<TimelapsePieceStyle>> = {
  classic: {},
  minimal: { pill: 'none' },
  'big-timer': { pill: 'none', font: 'geometric' },
  headline: {},
  story: { pill: 'none', font: 'geometric' },
  mono: { pill: 'outline', font: 'mono' },
  corner: {},
  clean: { pill: 'none' },
};

const box = (
  x: number,
  y: number,
  w: number,
  h: number,
  visible = true,
  align?: TimelapseAlign,
): TimelapseBox => (align ? { x, y, w, h, visible, align } : { x, y, w, h, visible });

/** A box without a pill, font or colour of its own. */
function plain(b: TimelapseBox): TimelapseBox {
  const out: TimelapseBox = { ...b };
  delete out.pill;
  delete out.font;
  delete out.color;
  return out;
}

/** A text piece drawn this way: only what differs from a dark sans pill in white is kept. */
function dress(b: TimelapseBox, s: Partial<TimelapsePieceStyle>): TimelapseBox {
  const out = plain(b);
  if (s.pill && s.pill !== 'dark') out.pill = s.pill;
  if (s.font && s.font !== 'sans') out.font = s.font;
  if (s.color && s.color !== 'white') out.color = s.color;
  return out;
}

/**
 * Sizes for a shape, as fractions of the frame: a line of text's height, the gap kept from
 * the sides and from the top and bottom (the same distance in pixels), the progress bar's
 * height, and the mark's.
 */
function metrics(ratio: number) {
  const tall = ratio < 0.9;
  const square = !tall && ratio < 1.2;
  const u = tall ? 0.045 : square ? 0.065 : 0.08;
  const mx = tall || square ? 0.05 : 0.04;
  const my = Math.min(0.07, Math.max(0.025, mx * ratio));
  const bar = tall ? 0.012 : square ? 0.014 : 0.018;
  return { u, mx, my, bar, mark: u * 0.7, gap: u * 0.3 };
}

/** A look's pieces for a shape; the screen comes from the layout it is put on. */
function styledPieces(
  id: TimelapseStyleId,
  ratio: number,
  screenRatio: number,
): Record<StyledId, TimelapseBox> {
  const classic = defaultTimelapseLayout(ratio, screenRatio);
  if (id === 'classic') return classic;
  const { u, mx, my, bar, mark, gap } = metrics(ratio);
  const rest = REST[id];
  const as = (b: TimelapseBox, s: Partial<TimelapsePieceStyle> = rest) => dress(b, s);
  const progress = box(0, 1 - bar, 1, bar);
  const full = 1 - mx * 2;
  const markTop = box(1 - mx - 0.3, my, 0.3, mark, true, 'right');
  const markBottom = box(1 - mx - 0.3, 1 - my - bar - mark, 0.3, mark, true, 'right');
  // A piece a look leaves out keeps the classic place, so adding it back puts it somewhere
  // sensible, drawn the look's way.
  const off = (b: TimelapseBox): TimelapseBox => as({ ...b, visible: false });

  // The person's text: a line a little smaller than the clocks.
  const line = u * 0.8;
  if (id === 'minimal') {
    const big = u * 1.25;
    const elapsedY = 1 - my - bar - big;
    return {
      clock: as(box(mx, my, 0.4, u * 0.85)),
      elapsed: as(box(mx, elapsedY, 0.4, big)),
      title: as(box(mx, elapsedY - gap * 0.4 - u * 0.85, full, u * 0.85)),
      note: as(box(mx, my + u * 0.85 + gap * 0.4, 0.6, u * 0.75)),
      progress: box(0, 1 - bar * 0.5, 1, bar * 0.5),
      watermark: markTop,
    };
  }
  if (id === 'big-timer') {
    const big = u * 2.6;
    const elapsedY = 1 - my - bar - big;
    return {
      clock: off(classic.clock),
      elapsed: as(box(mx, elapsedY, full, big, true, 'center')),
      title: as(box(mx, elapsedY - gap * 0.2 - line, full, line, true, 'center')),
      note: as(box(mx, my, 0.6, line)),
      progress,
      watermark: markTop,
    };
  }
  if (id === 'headline') {
    const head = u * 1.5;
    const elapsedY = my + head + gap;
    const serif = { pill: 'none', font: 'serif' } as const;
    return {
      clock: off(classic.clock),
      title: as(box(mx, my, full, head), serif),
      elapsed: as(box(mx, elapsedY, 0.3, u * 0.9)),
      note: as(box(mx, elapsedY + u * 0.9 + gap, 0.6, line), serif),
      progress,
      watermark: markBottom,
    };
  }
  if (id === 'story') {
    // Like a story on a phone: a thin bar across the top, the time of day and the mark under
    // it, and the task and the time studied low in the middle.
    const top = my * 0.6;
    const thin = Math.max(TIMELAPSE_MIN_BAR, bar * 0.5);
    const under = top + thin + gap;
    const big = u * 1.3;
    const elapsedY = 1 - my * 1.6 - big;
    const titleY = elapsedY - gap - u;
    return {
      progress: box(mx, top, full, thin),
      watermark: box(1 - mx - 0.3, under, 0.3, mark, true, 'right'),
      clock: as(box(mx, under, 0.4, mark * 1.15)),
      elapsed: as(box(mx, elapsedY, full, big, true, 'center'), { font: 'geometric' }),
      title: as(box(mx, titleY, full, u, true, 'center')),
      note: as(box(mx, titleY - gap - line, full, line, true, 'center')),
    };
  }
  if (id === 'mono') {
    const s = u * 0.85;
    const elapsedY = 1 - my - bar - s;
    return {
      clock: as(box(mx, my, 0.4, s)),
      elapsed: as(box(mx, elapsedY, 0.4, s)),
      title: as(box(mx, elapsedY - gap - s, 0.6, s)),
      note: as(box(mx, my + s + gap, 0.6, s)),
      progress,
      watermark: markTop,
    };
  }
  if (id === 'corner') {
    const s = u * 0.75;
    const clockY = 1 - my - bar - s;
    const elapsedY = clockY - gap - s;
    const titleY = elapsedY - gap - s;
    return {
      clock: box(mx, clockY, 0.4, s),
      elapsed: box(mx, elapsedY, 0.4, s),
      title: box(mx, titleY, 0.6, s),
      note: box(mx, titleY - gap - s, 0.6, s),
      progress,
      watermark: markTop,
    };
  }
  // Clean: the camera and the mark, and the person's text when there is some.
  return {
    clock: off(classic.clock),
    elapsed: off(classic.elapsed),
    title: off(classic.title),
    note: as(box(mx, 1 - my - line, 0.6, line)),
    progress: { ...classic.progress, visible: false },
    watermark: classic.watermark,
  };
}

/**
 * A layout in a look, for a video of this shape (width over height). The camera fills the
 * frame as always, and the screen keeps its place and whether it is shown. The time
 * elapsed, start and end stay where they are, drawn the look's way.
 */
export function applyTimelapseStyle(
  id: TimelapseStyleId,
  ratio: number,
  current: TimelapseLayout,
  screenRatio = TIMELAPSE_DEFAULT_SCREEN_RATIO,
): TimelapseLayout {
  const pieces = styledPieces(id, ratio, screenRatio);
  const out: TimelapseLayout = { ...current };
  // The bar and the mark take no pill or font; a look also puts the bar's colour back.
  for (const p of STYLED)
    out[p] = p === 'progress' || p === 'watermark' ? plain(pieces[p]) : { ...pieces[p] };
  for (const p of DRESSED) out[p] = dress(current[p], REST[id]);
  return out;
}

const near = (a: number, b: number, within: number) => Math.abs(a - b) <= within;

/** Where a text piece is held: its left edge, middle or right edge. */
const anchor = (b: TimelapseBox) =>
  b.align === 'right' ? b.x + b.w : b.align === 'center' ? b.x + b.w / 2 : b.x;

/**
 * Whether two placings of a piece are the same as far as a look goes. A saved text piece
 * is stored where it was drawn (its width the text's), so only its height, its top, the
 * side it holds to and how it is drawn are compared; the progress bar is compared whole.
 * Hidden is hidden, wherever it waits.
 */
function samePiece(id: TimelapseElementId, a: TimelapseBox, b: TimelapseBox): boolean {
  if (a.visible !== b.visible) return false;
  if (!a.visible) return true;
  if (id === 'progress')
    return (
      (a.color ?? 'white') === (b.color ?? 'white') &&
      (['x', 'y', 'w', 'h'] as const).every((k) => near(a[k], b[k], 0.004))
    );
  return (
    sameLook(a, b) &&
    near(a.y, b.y, 0.004) &&
    near(a.h, b.h, 0.004) &&
    near(anchor(a), anchor(b), 0.006)
  );
}

/** The look a layout is in, or null once it has been arranged or restyled by hand. */
export function matchTimelapseStyle(
  layout: TimelapseLayout,
  ratio: number,
  screenRatio = TIMELAPSE_DEFAULT_SCREEN_RATIO,
): TimelapseStyleId | null {
  for (const style of TIMELAPSE_STYLES) {
    const pieces = styledPieces(style.id, ratio, screenRatio);
    if (STYLED.every((id) => samePiece(id, layout[id], pieces[id]))) return style.id;
  }
  return null;
}

/* ---------- the person's own text ---------- */

/** The most the text on the video may say. */
export const TIMELAPSE_NOTE_MAX = 100;

/** The text on the video as stored: one line of plain text, or empty to leave it out. */
export function cleanNoteText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, TIMELAPSE_NOTE_MAX);
}
