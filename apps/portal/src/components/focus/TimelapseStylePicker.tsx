import {
  applyTimelapseStyle,
  matchTimelapseStyle,
  TIMELAPSE_STYLES,
  videoSize,
  type TimelapseLayout,
  type TimelapseStyleId,
} from '@komogon/core';
import { useEffect, useRef } from 'react';
import { composeFrame, type ComposeFrame } from '../../lib/timelapse-compose';

/** What the pieces say in the little pictures, unless real ones are given. */
const SAMPLE: Omit<ComposeFrame, 'camera' | 'screen'> = {
  clock: '2:14 PM',
  elapsed: 'Focus 42:17',
  title: 'Your task name',
  note: 'Your text',
  progress: 0.6,
};

/** A flat grey to stand in for the camera, so the pieces' dark pills show against it. */
let standIn: HTMLCanvasElement | null = null;
function cameraStandIn(): HTMLCanvasElement {
  if (!standIn) {
    standIn = document.createElement('canvas');
    standIn.width = 16;
    standIn.height = 9;
    const ctx = standIn.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#5a6078';
      ctx.fillRect(0, 0, 16, 9);
    }
  }
  return standIn;
}

export interface TimelapseStylePickerProps {
  /** The video's shape, width over height. */
  ratio: number;
  /** The layout now, to show which look it is in and to keep its screen. */
  layout: TimelapseLayout;
  screenRatio?: number;
  onPick: (id: TimelapseStyleId, layout: TimelapseLayout) => void;
  /** A real picture to draw the looks on: a still from the video, or the live camera. */
  camera?: CanvasImageSource | null;
  screen?: CanvasImageSource | null;
  /** What the pieces say, from that still. */
  sample?: Partial<Omit<ComposeFrame, 'camera' | 'screen'>>;
  /** Smaller pictures, for the focus screen's controls. */
  compact?: boolean;
}

/**
 * The ready-made looks, each as a little picture of the video in it. Picking one places the
 * clocks, the task name, the progress bar and the mark; the screen stays where it is.
 */
export function TimelapseStylePicker({
  ratio,
  layout,
  screenRatio,
  onPick,
  camera,
  screen,
  sample,
  compact = false,
}: TimelapseStylePickerProps) {
  const current = matchTimelapseStyle(layout, ratio, screenRatio);
  return (
    <div className="field">
      <span className="field-label">Start from a look</span>
      <div
        className={`tl-looks${compact ? ' is-compact' : ''}`}
        role="radiogroup"
        aria-label="Looks"
      >
        {TIMELAPSE_STYLES.map((s) => {
          const styled = applyTimelapseStyle(s.id, ratio, layout, screenRatio);
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={current === s.id}
              className={`tl-look${current === s.id ? ' is-on' : ''}`}
              title={s.description}
              onClick={() => onPick(s.id, styled)}
            >
              <span className="tl-look-pic">
                <LookPicture
                  ratio={ratio}
                  layout={styled}
                  camera={camera ?? null}
                  screen={screen ?? null}
                  sample={sample}
                />
              </span>
              <span className="tl-look-name">{s.name}</span>
            </button>
          );
        })}
      </div>
      {!compact && (
        <span className="field-hint">
          {current
            ? TIMELAPSE_STYLES.find((s) => s.id === current)!.description
            : 'Arranged your own way. Pick a look to start again from it.'}
        </span>
      )}
    </div>
  );
}

function LookPicture({
  ratio,
  layout,
  camera,
  screen,
  sample,
}: {
  ratio: number;
  layout: TimelapseLayout;
  camera: CanvasImageSource | null;
  screen: CanvasImageSource | null;
  sample?: Partial<Omit<ComposeFrame, 'camera' | 'screen'>>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = videoSize(ratio, 360);
  const said = { ...SAMPLE, ...sample };
  const { clock, elapsed, title, note, progress } = said;
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const paint = () =>
      composeFrame(
        ctx,
        w,
        h,
        layout,
        { camera: camera ?? cameraStandIn(), screen, clock, elapsed, title, note, progress },
        { mark: '#ffffff', placeholders: true },
      );
    paint();
    // The wordmark is in Satoshi, which may arrive after the first paint.
    void document.fonts?.load('600 24px Satoshi').then(paint, () => undefined);
  }, [w, h, layout, camera, screen, clock, elapsed, title, note, progress]);
  return <canvas ref={ref} width={w} height={h} aria-hidden />;
}
