import {
  aspectRatio,
  canHideElement,
  clampBox,
  defaultTimelapseLayout,
  fitBoxToRatio,
  minBoxSide,
  TIMELAPSE_ELEMENT_LABELS,
  TIMELAPSE_ELEMENTS,
  TIMELAPSE_MOVABLE,
  videoSize,
  type TimelapseAspect,
  type TimelapseBox,
  type TimelapseElementId,
  type TimelapseLayout,
  type UserSettings,
} from '@komogon/core';
import { Camera, CameraOff, Monitor, Plus, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Segmented } from '@komogon/ui';
import { useMe } from '../../lib/queries';
import {
  cameraSupported,
  knownCameraRatio,
  knownScreenRatio,
  rememberCameraRatio,
  timeOfDayText,
} from '../../lib/timelapse';
import { composeFrame, type DrawnRects } from '../../lib/timelapse-compose';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
type TimelapseSettingsValue = UserSettings['timelapse'];

const SHAPES: Array<{ value: TimelapseAspect; label: string }> = [
  { value: 'camera', label: 'Match camera' },
  { value: 'screen', label: 'Match screen' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '4:3', label: '4:3' },
];

/** "about 4:3": a measured ratio, named after the nearest common shape. */
function ratioName(r: number): string {
  const known: Array<[number, string]> = [
    [16 / 9, '16:9'],
    [16 / 10, '16:10'],
    [4 / 3, '4:3'],
    [3 / 2, '3:2'],
    [1, '1:1'],
    [9 / 16, '9:16'],
    [3 / 4, '3:4'],
  ];
  const [, name] = known.reduce((a, b) => (Math.abs(b[0] - r) < Math.abs(a[0] - r) ? b : a));
  return name;
}

const sameBoxes = (a: TimelapseLayout, b: TimelapseLayout) =>
  TIMELAPSE_ELEMENTS.every((id) =>
    (['x', 'y', 'w', 'h'] as const).every((k) => Math.abs(a[id][k] - b[id][k]) < 0.0005),
  );

const sameLayout = (a: TimelapseLayout, b: TimelapseLayout) =>
  sameBoxes(a, b) && TIMELAPSE_ELEMENTS.every((id) => a[id].visible === b[id].visible);

/** Pieces that keep their own shape when resized: the screen, the texts and the mark. */
const keepsShape = (id: TimelapseElementId) => id !== 'progress';

type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Drag = {
  id: TimelapseElementId;
  /** 'move', or the corner being pulled. */
  mode: 'move' | Corner;
  start: { x: number; y: number };
  /** Where the piece was drawn when the drag began, in fractions of the frame. */
  rect: TimelapseBox;
  pointer: number;
};

/**
 * A box resized from one corner with its shape kept: the opposite corner stays put, and
 * the scale follows whichever way the pointer moved further, held inside the frame.
 */
function scaleFromCorner(
  id: TimelapseElementId,
  r: TimelapseBox,
  corner: Corner,
  dx: number,
  dy: number,
): TimelapseBox {
  const east = corner.includes('e');
  const south = corner.includes('s');
  const sx = (r.w + (east ? dx : -dx)) / r.w;
  const sy = (r.h + (south ? dy : -dy)) / r.h;
  let s = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
  // Room on the side that moves.
  const roomW = east ? 1 - r.x : r.x + r.w;
  const roomH = south ? 1 - r.y : r.y + r.h;
  s = Math.min(s, roomW / r.w, roomH / r.h);
  s = Math.max(s, minBoxSide(id, 'h') / r.h, minBoxSide(id, 'w') / r.w);
  const w = r.w * s;
  const h = r.h * s;
  return {
    x: east ? r.x : r.x + r.w - w,
    y: south ? r.y : r.y + r.h - h,
    w,
    h,
    visible: r.visible,
  };
}

/** A box resized from one corner freely, for the progress bar. */
function stretchFromCorner(
  id: TimelapseElementId,
  r: TimelapseBox,
  corner: Corner,
  dx: number,
  dy: number,
): TimelapseBox {
  const minW = minBoxSide(id, 'w');
  const minH = minBoxSide(id, 'h');
  let { x, y, w, h } = r;
  if (corner.includes('e')) w = Math.max(minW, Math.min(1 - x, w + dx));
  if (corner.includes('s')) h = Math.max(minH, Math.min(1 - y, h + dy));
  if (corner.includes('w')) {
    const right = x + w;
    x = Math.max(0, Math.min(right - minW, x + dx));
    w = right - x;
  }
  if (corner.includes('n')) {
    const bottom = y + h;
    y = Math.max(0, Math.min(bottom - minH, y + dy));
    h = bottom - y;
  }
  return { ...r, x, y, w, h };
}

export interface TimelapseLayoutEditorProps {
  value: TimelapseSettingsValue;
  onChange: (patch: DeepPartial<UserSettings>) => void;
  /** What the task name shows in the preview. */
  sampleTitle?: string;
}

/**
 * The timelapse laid out as it will come out: a preview of the video with a box over each
 * piece, exactly around what is drawn. The camera is the backdrop and stays put. Drag a
 * box to move it, pull a corner to resize it, and take it out with its cross; pieces taken
 * out wait under the preview to be added back. Arrow keys move the chosen box, Shift with
 * them resizes it, and Delete takes it out.
 */
export function TimelapseLayoutEditor({
  value,
  onChange,
  sampleTitle = 'Your task name',
}: TimelapseLayoutEditorProps) {
  const timeZone = useMe().data?.user.timezone;
  const [draft, setDraft] = useState<TimelapseLayout | null>(null);
  const layout = draft ?? value.layout;
  const [selected, setSelected] = useState<TimelapseElementId | null>(null);
  const [cameraRatio, setCameraRatio] = useState<number | null>(() => knownCameraRatio());
  const screenRatio = useMemo(() => knownScreenRatio(), []);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<'idle' | 'asking' | 'denied'>('idle');
  /** Where each piece was last drawn, in fractions of the frame. */
  const [drawn, setDrawn] = useState<Partial<Record<TimelapseElementId, TimelapseBox>>>({});
  // The time of day in the preview, kept current to the minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const drag = useRef<Drag | null>(null);

  const ratio = aspectRatio(value.aspect, cameraRatio, screenRatio);
  const { w: cw, h: ch } = videoSize(ratio, 960);

  const save = useCallback(
    (next: Partial<TimelapseSettingsValue>) => onChange({ timelapse: next }),
    [onChange],
  );
  /** Show a change at once and save it; the draft stays until the saved copy matches it. */
  const saveLayout = useCallback(
    (next: TimelapseLayout) => {
      setDraft(next);
      save({ layout: next });
    },
    [save],
  );

  /** A default layout for a shape, keeping which pieces are shown. */
  const freshLayout = (r: number, keep: TimelapseLayout): TimelapseLayout => {
    const d = defaultTimelapseLayout(r, screenRatio);
    for (const id of TIMELAPSE_ELEMENTS) d[id].visible = keep[id].visible;
    return d;
  };

  /* ----- the camera, for its shape and a live preview ----- */
  const stopCamera = useCallback(() => {
    setCamera((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);
  useEffect(() => () => camera?.getTracks().forEach((t) => t.stop()), [camera]);

  const startCamera = async (): Promise<number | null> => {
    if (!cameraSupported()) {
      setCameraState('denied');
      return null;
    }
    setCameraState('asking');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = s;
      await video.play().catch(() => undefined);
      videoRef.current = video;
      setCamera(s);
      setCameraState('idle');
      const r = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : null;
      if (r) {
        rememberCameraRatio(video.videoWidth, video.videoHeight);
        setCameraRatio(r);
      }
      return r;
    } catch {
      setCameraState('denied');
      return null;
    }
  };

  /**
   * Pick a shape. A layout still at the old shape's starting places moves to the new one's;
   * an arranged one stays, with the screen reshaped so it still fits its picture.
   */
  const pickShape = (aspect: TimelapseAspect, camRatio = cameraRatio) => {
    const newRatio = aspectRatio(aspect, camRatio, screenRatio);
    const next = sameBoxes(layout, defaultTimelapseLayout(ratio, screenRatio))
      ? freshLayout(newRatio, layout)
      : { ...layout, screen: fitBoxToRatio(layout.screen, newRatio, screenRatio) };
    setDraft(next);
    save({ aspect, layout: next });
  };

  const matchCamera = async () => {
    const r = cameraRatio ?? (await startCamera());
    pickShape('camera', r);
  };

  /** Reshape the screen's box to the screen's own shape, keeping its width. */
  const fitScreen = () => {
    setSelected('screen');
    saveLayout({ ...layout, screen: fitBoxToRatio(layout.screen, ratio, screenRatio) });
  };

  /* ----- drawing the preview ----- */
  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const video = camera ? videoRef.current : null;
    const rects: DrawnRects = composeFrame(
      ctx,
      cw,
      ch,
      layout,
      {
        camera: video && video.readyState >= 2 ? video : null,
        screen: null,
        clock: timeOfDayText(now, timeZone),
        elapsed: '42:17',
        title: sampleTitle,
        progress: 0.6,
      },
      { mark: '#ffffff', placeholders: true },
    );
    const next: Partial<Record<TimelapseElementId, TimelapseBox>> = {};
    for (const id of TIMELAPSE_MOVABLE) {
      const r = rects[id];
      if (r) next[id] = { x: r.x / cw, y: r.y / ch, w: r.w / cw, h: r.h / ch, visible: true };
    }
    // Only a real change re-renders; the live camera redraws every frame.
    setDrawn((prev) => {
      const same = TIMELAPSE_MOVABLE.every((id) => {
        const a = prev[id];
        const b = next[id];
        if (!a || !b) return a === b;
        return (['x', 'y', 'w', 'h'] as const).every((k) => Math.abs(a[k] - b[k]) < 0.0002);
      });
      return same ? prev : next;
    });
  }, [camera, cw, ch, layout, sampleTitle, timeZone, now]);

  useEffect(() => {
    draw();
    if (!camera) return;
    // The live camera needs a fresh frame each time the screen paints.
    let raf = 0;
    const tick = () => {
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw, camera]);

  // The Satoshi wordmark may arrive after the first paint.
  useEffect(() => {
    void document.fonts?.load('600 24px Satoshi').then(
      () => draw(),
      () => undefined,
    );
  }, [draw]);

  /* ----- moving and resizing ----- */
  const pointFrac = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  /** The box shown over a piece: where it was drawn, or its layout box until it has been. */
  const rectOf = (id: TimelapseElementId): TimelapseBox => drawn[id] ?? layout[id];

  const begin = (e: React.PointerEvent, id: TimelapseElementId, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, mode, start: pointFrac(e), rect: rectOf(id), pointer: e.pointerId };
  };

  /** A piece placed at a rect: its layout box becomes exactly that rect. */
  const placed = (id: TimelapseElementId, r: TimelapseBox): TimelapseLayout => ({
    ...layout,
    [id]: clampBox(id, { ...r, visible: layout[id].visible }),
  });

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const p = pointFrac(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    const r = d.rect;
    const next =
      d.mode === 'move'
        ? { ...r, x: r.x + dx, y: r.y + dy }
        : keepsShape(d.id)
          ? scaleFromCorner(d.id, r, d.mode, dx, dy)
          : stretchFromCorner(d.id, r, d.mode, dx, dy);
    setDraft(placed(d.id, next));
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (draft) saveLayout(draft);
  };

  // The saved layout caught up with the draft: drop the draft.
  useEffect(() => {
    setDraft((d) => (d && sameLayout(d, value.layout) ? null : d));
  }, [value.layout]);

  const hide = (id: TimelapseElementId) => {
    if (!canHideElement(id)) return;
    setSelected(null);
    saveLayout({ ...layout, [id]: { ...layout[id], visible: false } });
  };
  const show = (id: TimelapseElementId) => {
    setSelected(id);
    const box = id === 'screen' ? fitBoxToRatio(layout.screen, ratio, screenRatio) : layout[id];
    saveLayout({ ...layout, [id]: { ...box, visible: true } });
  };

  const onKey = (e: React.KeyboardEvent, id: TimelapseElementId) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      hide(id);
      return;
    }
    const step = e.altKey ? 0.002 : 0.01;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = arrows[e.key];
    if (!delta) return;
    e.preventDefault();
    const r = rectOf(id);
    if (!e.shiftKey) {
      saveLayout(placed(id, { ...r, x: r.x + delta[0], y: r.y + delta[1] }));
      return;
    }
    // Shift: right and down grow it from its top left, left and up shrink it.
    const grow = delta[0] + delta[1];
    const next = keepsShape(id)
      ? scaleFromCorner(id, r, 'se', grow * (r.w / Math.max(r.w, r.h)), grow)
      : stretchFromCorner(id, r, 'se', delta[0], delta[1]);
    saveLayout(placed(id, next));
  };

  const hidden = TIMELAPSE_MOVABLE.filter((id) => !layout[id].visible);
  const reset = () => {
    setSelected(null);
    saveLayout(freshLayout(ratio, layout));
  };

  const shapeHint: Record<TimelapseAspect, string> = {
    camera: cameraRatio
      ? `Matches your camera, about ${ratioName(cameraRatio)}.`
      : 'The video takes your camera’s shape automatically. Preview with your camera to see it here.',
    screen: `Matches your screen, about ${ratioName(screenRatio)}.`,
    '9:16': 'Tall, for phone stories and reels.',
    '16:9': 'Wide, like a laptop screen or a video on YouTube.',
    '1:1': 'Square, for a feed post.',
    '4:5': 'A little taller than square, for a phone feed.',
    '4:3': 'The shape of most webcams and tablets.',
  };

  return (
    <div className="tl-editor">
      <div className="field">
        <span className="field-label">Shape</span>
        <Segmented
          ariaLabel="Shape of the video"
          value={value.aspect}
          onChange={(v) => (v === 'camera' ? void matchCamera() : pickShape(v))}
          options={SHAPES}
        />
        <span className="field-hint">{shapeHint[value.aspect]}</span>
        {cameraState === 'denied' && (
          <span className="field-hint timelapse-size-warn" role="status">
            The camera was blocked, so its shape is not known yet. Allow it in the address bar and
            try again.
          </span>
        )}
      </div>

      <div
        ref={stageRef}
        className="tl-stage"
        style={{
          aspectRatio: `${cw} / ${ch}`,
          width: `min(100%, ${Math.round(480 * (cw / ch))}px)`,
        }}
        onPointerDown={() => setSelected(null)}
      >
        <canvas ref={canvasRef} width={cw} height={ch} className="tl-canvas" aria-hidden />
        {TIMELAPSE_MOVABLE.filter((id) => layout[id].visible).map((id) => {
          const b = rectOf(id);
          const isSel = selected === id;
          const label = TIMELAPSE_ELEMENT_LABELS[id];
          return (
            <div
              key={id}
              className={`tl-box${isSel ? ' is-selected' : ''}${id === 'screen' ? ' is-picture' : ''}`}
              style={{
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
                zIndex: isSel ? 5 : id === 'screen' ? 1 : 2,
              }}
              role="button"
              tabIndex={0}
              aria-label={`${label}. Drag to move, pull a corner to resize. Arrow keys move it, Shift and arrows resize it${canHideElement(id) ? ', Delete removes it' : ''}.`}
              aria-pressed={isSel}
              onFocus={() => setSelected(id)}
              onKeyDown={(e) => onKey(e, id)}
              onPointerDown={(e) => begin(e, id, 'move')}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              {isSel && (
                <>
                  <span className={`tl-box-name${b.y < 0.08 ? ' is-below' : ''}`}>{label}</span>
                  {canHideElement(id) && (
                    <button
                      type="button"
                      className="tl-box-remove"
                      aria-label={`Remove ${label.toLowerCase()}`}
                      title="Remove"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => hide(id)}
                    >
                      <X size={12} aria-hidden />
                    </button>
                  )}
                  {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                    <span
                      key={corner}
                      className={`tl-handle is-${corner}`}
                      aria-hidden
                      onPointerDown={(e) => begin(e, id, corner)}
                      onPointerMove={move}
                      onPointerUp={end}
                      onPointerCancel={end}
                    />
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>

      {hidden.length > 0 && (
        <div className="tl-hidden">
          <span className="field-hint">Add back</span>
          {hidden.map((id) => (
            <button key={id} type="button" className="tl-chip" onClick={() => show(id)}>
              <Plus size={13} aria-hidden /> {TIMELAPSE_ELEMENT_LABELS[id]}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {camera ? (
          <Button variant="ghost" size="sm" onClick={stopCamera}>
            <CameraOff size={14} aria-hidden /> Turn the camera off
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void startCamera()}
            disabled={cameraState === 'asking'}
          >
            <Camera size={14} aria-hidden /> Preview with my camera
          </Button>
        )}
        {layout.screen.visible && (
          <Button variant="ghost" size="sm" onClick={fitScreen}>
            <Monitor size={14} aria-hidden /> Fit the screen to its shape
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw size={14} aria-hidden /> Reset the layout
        </Button>
      </div>
      <span className="field-hint">
        The camera fills the video behind everything. Drag a piece to move it and pull a corner to
        resize it; the screen, the clocks and the task name keep their shape as they grow. Add the
        screen to choose where it goes; each session asks whether to record it.
      </span>
    </div>
  );
}
