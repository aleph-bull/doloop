import {
  alignBox,
  aspectRatio,
  canHideElement,
  clampBox,
  defaultStoryLayout,
  defaultTimelapseLayout,
  fitBoxToRatio,
  minBoxSide,
  PHONE_SIDEWAYS_ASPECTS,
  PHONE_UPRIGHT_ASPECTS,
  phoneAspectRatio,
  pieceStyle,
  restyleBox,
  sameLook,
  STORY_ASPECT,
  takesColor,
  takesPill,
  TIMELAPSE_COLOR_LABELS,
  TIMELAPSE_COLORS,
  TIMELAPSE_FONT_LABELS,
  TIMELAPSE_FONTS,
  TIMELAPSE_PILL_LABELS,
  TIMELAPSE_PILLS,
  TIMELAPSE_TEXT_ELEMENTS,
  TIMELAPSE_ELEMENT_LABELS,
  TIMELAPSE_ELEMENTS,
  TIMELAPSE_MOVABLE,
  videoSize,
  type TimelapseAlign,
  type TimelapseAspect,
  type TimelapseBox,
  type TimelapseDevice,
  type TimelapseElementId,
  type TimelapseLayout,
  type TimelapseOrientation,
  type TimelapsePieceStyle,
  type UserSettings,
} from '@komogon/core';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Camera,
  CameraOff,
  Check,
  Monitor,
  Plus,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, Segmented } from '@komogon/ui';
import { useMe } from '../../lib/queries';
import {
  cameraSupported,
  knownCameraRatio,
  knownFacing,
  knownScreenRatio,
  rememberCamera,
  timeOfDayText,
} from '../../lib/timelapse';
import {
  composeFrame,
  sourceSize,
  TIMELAPSE_COLOR_HEX,
  TIMELAPSE_FONT_FAMILY,
  type ComposeFrame,
  type DrawnRects,
} from '../../lib/timelapse-compose';
import { TimelapseStylePicker } from './TimelapseStylePicker';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const SHAPE_LABELS: Record<TimelapseAspect, string> = {
  camera: 'Match camera',
  screen: 'Match screen',
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '4:5': '4:5',
  '4:3': '4:3',
};

/** Every shape a computer's video can take. */
export const COMPUTER_SHAPES: readonly TimelapseAspect[] = [
  'camera',
  'screen',
  '16:9',
  '9:16',
  '1:1',
  '4:5',
  '4:3',
];

/**
 * One layout the editor arranges: the computer's own or its story one, or a phone's upright
 * or sideways one. `save` turns a shape and layout into the settings patch that stores them.
 */
export interface LayoutTarget {
  id: string;
  label: string;
  aspect: TimelapseAspect;
  layout: TimelapseLayout;
  shapes: readonly TimelapseAspect[];
  /** How the phone is held for this layout; null for a computer, whose camera is as it comes. */
  orientation: TimelapseOrientation | null;
  /** Where "Reset the layout" goes, when not the shape's usual start. */
  fresh?: (screenRatio: number) => TimelapseLayout;
  save: (aspect: TimelapseAspect, layout: TimelapseLayout) => DeepPartial<UserSettings>;
}

/**
 * The layouts a preset's editor arranges: the computer's two (its own, and the story's), or
 * the phone's two.
 */
export function targetsFor(settings: UserSettings, device: TimelapseDevice): LayoutTarget[] {
  if (device === 'computer') {
    const c = settings.timelapse;
    return [
      {
        id: 'computer',
        label: 'Normal',
        aspect: c.aspect,
        layout: c.layout,
        shapes: COMPUTER_SHAPES,
        orientation: null,
        save: (aspect, layout) => ({ timelapse: { aspect, layout } }),
      },
      {
        id: 'story',
        label: 'Story / Reel',
        aspect: STORY_ASPECT,
        layout: c.storyLayout,
        shapes: [STORY_ASPECT],
        orientation: null,
        fresh: defaultStoryLayout,
        save: (_, layout) => ({ timelapse: { storyLayout: layout } }),
      },
    ];
  }
  const p = settings.timelapsePhone;
  return [
    {
      id: 'upright',
      label: 'Upright',
      aspect: p.aspect,
      layout: p.layout,
      shapes: PHONE_UPRIGHT_ASPECTS,
      orientation: 'upright',
      save: (aspect, layout) => ({ timelapsePhone: { aspect, layout } }),
    },
    {
      id: 'sideways',
      label: 'Sideways',
      aspect: p.sidewaysAspect,
      layout: p.sidewaysLayout,
      shapes: PHONE_SIDEWAYS_ASPECTS,
      orientation: 'sideways',
      save: (aspect, layout) => ({
        timelapsePhone: { sidewaysAspect: aspect, sidewaysLayout: layout },
      }),
    },
  ];
}

type Draft = { aspect: TimelapseAspect; layout: TimelapseLayout };

/** What the text piece says in the preview until the person writes some. */
const NOTE_STAND_IN = 'Your text';

/** What a footer given to the editor works with, in place of the unsaved bubble. */
export interface LayoutEditorControls {
  /** Something differs from what is saved. */
  dirty: boolean;
  saving: boolean;
  /**
   * Save every changed layout, and resolve with the shape and layout on screen as they are
   * now stored (unchanged ones too), so a video can be made with them straight away.
   */
  save: () => Promise<Draft>;
  revert: () => void;
}

/** Several targets' patches as one save; each group merges field by field, like the API. */
function mergePatches(patches: Array<DeepPartial<UserSettings>>): DeepPartial<UserSettings> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const p of patches)
    for (const [k, v] of Object.entries(p)) out[k] = { ...out[k], ...(v as object) };
  return out as DeepPartial<UserSettings>;
}

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
  sameBoxes(a, b) &&
  TIMELAPSE_ELEMENTS.every((id) => a[id].visible === b[id].visible && sameLook(a[id], b[id]));

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
  /** The layouts to arrange, picked between with a switch when there are several. */
  targets: LayoutTarget[];
  /** Saves a change; a promise lets the editor know when the save has finished. */
  onChange: (patch: DeepPartial<UserSettings>) => unknown;
  /** The screen can be placed (a computer's); a phone's layouts have none. */
  screen?: boolean;
  /** Shown on the page; while false (its panel folded away) the camera preview is off. */
  active?: boolean;
  /** What the task name shows in the preview. */
  sampleTitle?: string;
  /** The person's text on the video; empty shows a stand-in so the piece can be placed. */
  noteText?: string;
  /**
   * A still to arrange the pieces over, in place of the live camera: a frame of a video just
   * made. The preview then shows that frame, and the camera button goes.
   */
  backdrop?: { camera: CanvasImageSource | null; screen: CanvasImageSource | null } | null;
  /** What the clocks, the task name and the progress bar say in the preview. */
  sample?: Partial<Omit<ComposeFrame, 'camera' | 'screen'>>;
  /**
   * Buttons of its own under the editor (in a dialog), given the save and revert. Without
   * it, unsaved changes show in a bubble at the bottom of the window.
   */
  footer?: (controls: LayoutEditorControls) => ReactNode;
}

/**
 * The timelapse laid out as it will come out: a preview of the video with a box over each
 * piece, exactly around what is drawn. The camera is the backdrop and stays put. Drag a
 * box to move it, pull a corner to resize it, and take it out with its cross; pieces taken
 * out wait under the preview to be added back. Arrow keys move the chosen box, Shift with
 * them resizes it, and Delete takes it out.
 */
export function TimelapseLayoutEditor({
  targets,
  onChange,
  screen: withScreen = true,
  active = true,
  sampleTitle = 'Your task name',
  noteText = '',
  backdrop = null,
  sample,
  footer,
}: TimelapseLayoutEditorProps) {
  const timeZone = useMe().data?.user.timezone;
  const [currentId, setCurrentId] = useState(targets[0]!.id);
  const target = targets.find((t) => t.id === currentId) ?? targets[0]!;
  // Changes wait here until Save, one draft per layout; Revert drops them all.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draft: Draft | undefined = drafts[target.id];
  const setDraft = useCallback(
    (d: Draft | null) =>
      setDrafts((all) => {
        const next = { ...all };
        if (d) next[target.id] = d;
        else delete next[target.id];
        return next;
      }),
    [target.id],
  );
  const [saving, setSaving] = useState(false);
  const aspect = draft?.aspect ?? target.aspect;
  const layout = draft?.layout ?? target.layout;
  const changed = (t: LayoutTarget) => {
    const d = drafts[t.id];
    return !!d && !(d.aspect === t.aspect && sameLayout(d.layout, t.layout));
  };
  const dirty = targets.some(changed);
  const [selected, setSelected] = useState<TimelapseElementId | null>(null);
  const [cameraRatio, setCameraRatio] = useState<number | null>(() => {
    // A still's own shape is the camera's, as it filmed this video.
    if (backdrop?.camera) {
      const { w, h } = sourceSize(backdrop.camera);
      if (w && h) return w / h;
    }
    return knownCameraRatio();
  });
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

  /** Width over height for a shape: a phone's camera is turned the way it is held. */
  const ratioOf = (shape: TimelapseAspect, camRatio: number | null) =>
    target.orientation
      ? phoneAspectRatio(shape, target.orientation, camRatio)
      : aspectRatio(shape, camRatio, screenRatio);
  const ratio = ratioOf(aspect, cameraRatio);
  const { w: cw, h: ch } = videoSize(ratio, 960);

  /** A change to the layout, shown at once and held until Save. */
  const saveLayout = useCallback(
    (next: TimelapseLayout) => setDraft({ aspect, layout: next }),
    [aspect, setDraft],
  );

  /** A default layout for a shape, keeping which pieces are shown. */
  const freshLayout = (r: number, keep: TimelapseLayout): TimelapseLayout => {
    const d = target.fresh ? target.fresh(screenRatio) : defaultTimelapseLayout(r, screenRatio);
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
  // Folded away: the camera goes off.
  useEffect(() => {
    if (!active) stopCamera();
  }, [active, stopCamera]);

  const startCamera = async (): Promise<number | null> => {
    if (!cameraSupported()) {
      setCameraState('denied');
      return null;
    }
    setCameraState('asking');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        // The camera the focus screen films with; a computer's front one.
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { ideal: knownFacing() },
        },
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
        rememberCamera(video.videoWidth, video.videoHeight);
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
  const pickShape = (shape: TimelapseAspect, camRatio = cameraRatio) => {
    const newRatio = ratioOf(shape, camRatio);
    const next = sameBoxes(layout, defaultTimelapseLayout(ratio, screenRatio))
      ? freshLayout(newRatio, layout)
      : { ...layout, screen: fitBoxToRatio(layout.screen, newRatio, screenRatio) };
    setDraft({ aspect: shape, layout: next });
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
        camera: video && video.readyState >= 2 ? video : (backdrop?.camera ?? null),
        screen: backdrop?.screen ?? null,
        clock: timeOfDayText(now, timeZone),
        elapsed: 'Focus 42:17',
        total: 'Elapsed 51:02',
        start: `Start ${timeOfDayText(now - 51 * 60_000, timeZone, false)}`,
        end: `End ${timeOfDayText(now, timeZone, false)}`,
        title: sampleTitle,
        note: noteText.trim() || NOTE_STAND_IN,
        progress: 0.6,
        ...sample,
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
  }, [camera, cw, ch, layout, sampleTitle, noteText, timeZone, now, backdrop, sample]);

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

  /** A piece placed at a rect: its layout box becomes exactly that rect, drawn as it was. */
  const placed = (id: TimelapseElementId, r: TimelapseBox): TimelapseLayout => ({
    ...layout,
    [id]: clampBox(id, {
      ...layout[id],
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      align: r.align ?? layout[id].align,
    }),
  });

  /** The chosen piece drawn another way: its pill, its font or its colour. */
  const restyle = (id: TimelapseElementId, style: Partial<TimelapsePieceStyle>) =>
    saveLayout({ ...layout, [id]: restyleBox(id, layout[id], style) });

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
    saveLayout(placed(d.id, next));
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
  };

  // A saved layout caught up with its draft: drop that draft.
  const savedKey = targets.map((t) => `${t.id}:${t.aspect}:${JSON.stringify(t.layout)}`).join('|');
  const targetsRef = useRef(targets);
  useEffect(() => {
    targetsRef.current = targets;
  });
  useEffect(() => {
    setDrafts((all) => {
      let next = all;
      for (const t of targetsRef.current) {
        const d = all[t.id];
        if (d && d.aspect === t.aspect && sameLayout(d.layout, t.layout)) {
          if (next === all) next = { ...all };
          delete next[t.id];
        }
      }
      return next;
    });
    setSaving(false);
  }, [savedKey]);

  /**
   * The draft with each text piece exactly where it was drawn, so its side (left, middle or
   * right) holds against the box the person saw. Only the layout on screen has been drawn.
   */
  const snapped = (d: Draft): Draft => {
    const next = { ...d.layout };
    for (const id of TIMELAPSE_TEXT_ELEMENTS) {
      const r = drawn[id];
      if (r && next[id].visible)
        next[id] = clampBox(id, { ...next[id], x: r.x, y: r.y, w: r.w, h: r.h });
    }
    return { aspect: d.aspect, layout: next };
  };

  /** Save every changed layout at once; resolves with the layout on screen as stored. */
  const commit = async (): Promise<Draft> => {
    const all = draft ? { ...drafts, [target.id]: snapped(draft) } : drafts;
    const shown = all[target.id] ?? { aspect: target.aspect, layout: target.layout };
    const patches = targets
      .filter((t) => all[t.id])
      .map((t) => t.save(all[t.id]!.aspect, all[t.id]!.layout));
    if (patches.length === 0) return shown;
    setSaving(true);
    setDrafts(all);
    // A save that fails leaves the drafts and the buttons, so it can be tried again.
    await Promise.resolve(onChange(mergePatches(patches))).finally(() => setSaving(false));
    return shown;
  };
  const revert = () => {
    setSelected(null);
    setDrafts({});
  };

  /** Switch to another layout, keeping this one's changes (placed as drawn) for the save. */
  const switchTo = (id: string) => {
    if (id === target.id) return;
    if (draft) setDraft(snapped(draft));
    setSelected(null);
    setDrawn({});
    setCurrentId(id);
  };

  // Unsaved changes: ask before the tab closes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Line a piece up against the left, in the middle, or against the right. */
  const lineUp = (id: TimelapseElementId, side: TimelapseAlign) => {
    const r = alignBox(rectOf(id), side);
    saveLayout(placed(id, TIMELAPSE_TEXT_ELEMENTS.includes(id) ? { ...r, align: side } : r));
  };
  /** The side a piece holds to now, for the buttons' pressed state. */
  const sideOf = (id: TimelapseElementId): TimelapseAlign | null => {
    if (TIMELAPSE_TEXT_ELEMENTS.includes(id)) return layout[id].align ?? 'left';
    const r = rectOf(id);
    const sides: TimelapseAlign[] = ['left', 'center', 'right'];
    return sides.find((side) => Math.abs(alignBox(r, side).x - r.x) < 0.002) ?? null;
  };

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

  const hidden = TIMELAPSE_MOVABLE.filter(
    (id) => !layout[id].visible && (withScreen || id !== 'screen'),
  );
  const reset = () => {
    setSelected(null);
    saveLayout(freshLayout(ratio, layout));
  };

  const held = target.orientation === 'sideways' ? 'sideways' : 'upright';
  const shapeHint: Record<TimelapseAspect, string> = {
    camera: target.orientation
      ? `The phone’s camera, held ${held}${cameraRatio ? `, about ${ratioName(ratioOf('camera', cameraRatio))}` : ''}.`
      : cameraRatio
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
      {targets.length > 1 && (
        <div className="field">
          <span className="field-label">{target.orientation ? 'Held' : 'Video'}</span>
          <Segmented
            ariaLabel="Which layout to arrange"
            value={target.id}
            onChange={switchTo}
            options={targets.map((t) => ({ value: t.id, label: t.label }))}
          />
          {target.orientation && (
            <span className="field-hint">
              Upright is for a vertical video, sideways for a horizontal one.
            </span>
          )}
        </div>
      )}
      {/* A story is always 9:16: there is no shape to pick. */}
      {target.shapes.length > 1 && (
        <div className="field">
          <span className="field-label">Shape</span>
          <Segmented
            ariaLabel="Shape of the video"
            value={aspect}
            onChange={(v) => (v === 'camera' ? void matchCamera() : pickShape(v))}
            options={target.shapes.map((value) => ({ value, label: SHAPE_LABELS[value] }))}
          />
          <span className="field-hint">{shapeHint[aspect]}</span>
          {cameraState === 'denied' && (
            <span className="field-hint timelapse-size-warn" role="status">
              The camera was blocked, so its shape is not known yet. Allow it in the address bar and
              try again.
            </span>
          )}
        </div>
      )}

      <TimelapseStylePicker
        ratio={ratio}
        layout={layout}
        screenRatio={screenRatio}
        camera={backdrop?.camera ?? null}
        screen={backdrop?.screen ?? null}
        sample={{ title: sampleTitle, note: noteText.trim() || NOTE_STAND_IN, ...sample }}
        onPick={(_, next) => {
          setSelected(null);
          saveLayout(next);
        }}
      />

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

      {selected && layout[selected].visible && (
        <div className="tl-align" role="group" aria-label="Line up the chosen piece">
          <span className="field-hint">
            Line up {TIMELAPSE_ELEMENT_LABELS[selected].toLowerCase()}
          </span>
          {(
            [
              ['left', 'Left', AlignLeft],
              ['center', 'Centre', AlignCenter],
              ['right', 'Right', AlignRight],
            ] as const
          ).map(([side, name, Icon]) => (
            <Button
              key={side}
              variant="ghost"
              size="sm"
              aria-pressed={sideOf(selected) === side}
              className={sideOf(selected) === side ? 'is-on' : undefined}
              onClick={() => lineUp(selected, side)}
            >
              <Icon size={14} aria-hidden /> {name}
            </Button>
          ))}
        </div>
      )}
      {selected && layout[selected].visible && takesColor(selected) && (
        <PieceLook
          id={selected}
          box={layout[selected]}
          onChange={(style) => restyle(selected, style)}
        />
      )}

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
        {backdrop ? null : camera ? (
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
        {withScreen && layout.screen.visible && (
          <Button variant="ghost" size="sm" onClick={fitScreen}>
            <Monitor size={14} aria-hidden /> Fit the screen to its shape
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw size={14} aria-hidden /> Reset the layout
        </Button>
      </div>
      <span className="field-hint">
        {withScreen
          ? 'The camera fills the video behind everything. Drag a piece to move it and pull a corner to resize it; the screen, the clocks and the texts keep their shape as they grow. Add the screen to choose where it goes; each session asks whether to record it. Your text shows once you write some, after a session. Nothing changes until you save.'
          : 'The camera fills the video behind everything. Drag a piece to move it and pull a corner to resize it; the clocks and the texts keep their shape as they grow. Your text shows once you write some, after a session. Nothing changes until you save.'}
      </span>

      {footer?.({ dirty, saving, save: commit, revert })}

      {dirty &&
        !footer &&
        createPortal(
          <div className="tl-unsaved-stack">
            <div className="toast glass-strong tl-unsaved" role="status">
              <span>You have unsaved changes to the timelapse layout.</span>
              <span className="tl-unsaved-actions">
                <Button variant="ghost" size="sm" onClick={revert} disabled={saving}>
                  <Undo2 size={14} aria-hidden /> Revert
                </Button>
                <Button variant="primary" size="sm" onClick={() => void commit()} disabled={saving}>
                  <Check size={14} aria-hidden /> Save
                </Button>
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** How the chosen piece is drawn: a text's pill and font, and a text's or the bar's colour. */
function PieceLook({
  id,
  box,
  onChange,
}: {
  id: TimelapseElementId;
  box: TimelapseBox;
  onChange: (style: Partial<TimelapsePieceStyle>) => void;
}) {
  const s = pieceStyle(box);
  return (
    <div className="tl-piece-look">
      {takesPill(id) && (
        <>
          <div className="tl-piece-row">
            <span className="field-hint">Pill</span>
            <Segmented
              ariaLabel="Pill"
              value={s.pill}
              onChange={(pill) => onChange({ pill })}
              options={TIMELAPSE_PILLS.map((v) => ({ value: v, label: TIMELAPSE_PILL_LABELS[v] }))}
            />
          </div>
          <div className="tl-piece-row">
            <span className="field-hint">Font</span>
            <Segmented
              ariaLabel="Font"
              value={s.font}
              onChange={(font) => onChange({ font })}
              options={TIMELAPSE_FONTS.map((v) => ({
                value: v,
                label: (
                  <span style={{ fontFamily: TIMELAPSE_FONT_FAMILY[v] }}>
                    {TIMELAPSE_FONT_LABELS[v]}
                  </span>
                ),
              }))}
            />
          </div>
        </>
      )}
      <div className="tl-piece-row" role="radiogroup" aria-label="Colour">
        <span className="field-hint">Colour</span>
        {TIMELAPSE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={s.color === c}
            aria-label={TIMELAPSE_COLOR_LABELS[c]}
            title={TIMELAPSE_COLOR_LABELS[c]}
            className={`tl-swatch${s.color === c ? ' is-on' : ''}`}
            style={{ '--swatch': TIMELAPSE_COLOR_HEX[c].text } as CSSProperties}
            onClick={() => onChange({ color: c })}
          />
        ))}
      </div>
    </div>
  );
}
