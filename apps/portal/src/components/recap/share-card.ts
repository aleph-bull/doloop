/**
 * "Share my week": the week as one square picture, drawn on a canvas and saved as a PNG.
 * Nothing leaves the device; the browser just downloads the file it drew.
 */

export interface ShareCardInput {
  /** "Sep 21 to 27" */
  rangeLabel: string;
  headline: string;
  summary: string;
  /** Minutes per day, Monday first, and the short labels to go under them. */
  days: Array<{ label: string; minutes: number; best: boolean }>;
  stats: Array<{ label: string; value: string }>;
  personality: string | null;
  /** Hex, from the user's accent. */
  accent: string;
}

const SIZE = 1080;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Wrap text to a width, returning the lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawShareCard(input: ShareCardInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const font = (weight: number, px: number) =>
    `${weight} ${px}px "Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

  // Night backdrop with a wash of the accent from the top corner.
  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, '#171a2b');
  bg.addColorStop(1, '#0b0c14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const glow = ctx.createRadialGradient(SIZE * 0.85, 0, 0, SIZE * 0.85, 0, SIZE * 0.9);
  glow.addColorStop(0, `${input.accent}66`);
  glow.addColorStop(1, `${input.accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const pad = 84;
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = font(600, 30);
  ctx.fillText('Komogon · my week', pad, pad + 20);
  ctx.textAlign = 'right';
  ctx.fillText(input.rangeLabel, SIZE - pad, pad + 20);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 128);
  ctx.fillText(input.headline, pad, 300);
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = font(500, 40);
  let y = 370;
  for (const line of wrap(ctx, input.summary, SIZE - pad * 2).slice(0, 2)) {
    ctx.fillText(line, pad, y);
    y += 52;
  }

  // The week as columns, the best day in full accent.
  const chartTop = 500;
  const chartBottom = 780;
  const max = Math.max(30, ...input.days.map((d) => d.minutes));
  const slot = (SIZE - pad * 2) / input.days.length;
  const bw = Math.min(64, slot * 0.55);
  input.days.forEach((d, i) => {
    const cx = pad + slot * i + slot / 2;
    const h = (d.minutes / max) * (chartBottom - chartTop);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, cx - bw / 2, chartTop, bw, chartBottom - chartTop, 14);
    ctx.fill();
    if (h > 0) {
      ctx.fillStyle = d.best ? input.accent : `${input.accent}99`;
      roundRect(ctx, cx - bw / 2, chartBottom - h, bw, h, 14);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = font(600, 28);
    ctx.textAlign = 'center';
    ctx.fillText(d.label, cx, chartBottom + 44);
    ctx.textAlign = 'left';
  });

  // Up to three stats along the bottom.
  const stats = input.stats.slice(0, 3);
  const col = (SIZE - pad * 2) / Math.max(1, stats.length);
  stats.forEach((s, i) => {
    const x = pad + col * i;
    ctx.fillStyle = '#ffffff';
    ctx.font = font(700, 54);
    ctx.fillText(s.value, x, 928);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = font(500, 28);
    ctx.fillText(s.label, x, 968);
  });

  if (input.personality) {
    ctx.font = font(600, 28);
    const w = ctx.measureText(input.personality).width + 48;
    ctx.fillStyle = `${input.accent}33`;
    roundRect(ctx, SIZE - pad - w, 1000, w, 50, 25);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(input.personality, SIZE - pad - w / 2, 1034);
    ctx.textAlign = 'left';
  }
  return canvas;
}

/** Draw the card and hand it to the browser as a download. */
export async function saveShareCard(input: ShareCardInput, filename: string): Promise<void> {
  // Wait for the page font, so the card is not drawn in a fallback face.
  await document.fonts?.ready;
  const canvas = drawShareCard(input);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not draw the card');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
