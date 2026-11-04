import { videoSize } from '@komogon/core';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, Modal } from '@komogon/ui';
import type { Still, TimelapseLook } from '../../lib/timelapse';
import {
  composeFrame,
  coverSpare,
  MIDDLE_CROP,
  type CameraCrop,
  type ComposeFrame,
} from '../../lib/timelapse-compose';
import { useStillPictures } from './RelayoutDialog';

/**
 * Moving the footage: when the video's shape cuts some of the camera's picture off (a wide
 * camera in a story, a tall one in a wide video), the picture can be dragged along the side
 * that has more of it, to pick which part shows. It belongs to the one video, like its text.
 */

/** Which way the footage can move in a `w` × `h` frame, or null when the picture fits it. */
export function cropAxis(camera: number | null, w: number, h: number): 'x' | 'y' | null {
  if (!camera) return null;
  const spare = coverSpare(camera, 1, w, h);
  if (spare.x > w * 0.01) return 'x';
  if (spare.y > h * 0.01) return 'y';
  return null;
}

const unit = (v: number) => Math.max(0, Math.min(1, v));
const STEP = 0.05;

/** What a canvas the footage is dragged on takes. */
type FootageProps = React.CanvasHTMLAttributes<HTMLCanvasElement> & {
  'data-move'?: 'x' | 'y';
  'data-dragging'?: boolean;
};

/** "Left side", "Middle", "40% across": which part of the footage shows, for a screen reader. */
function whereText(v: number, axis: 'x' | 'y'): string {
  if (Math.abs(v - 0.5) < 0.01) return 'Middle';
  if (v < 0.01) return axis === 'x' ? 'Left side' : 'Top';
  if (v > 0.99) return axis === 'x' ? 'Right side' : 'Bottom';
  return `${Math.round(v * 100)}% ${axis === 'x' ? 'across' : 'down'}`;
}

/**
 * A canvas the footage can be dragged on. The picture follows the pointer; the arrow keys
 * show more of the side they point to. Gives nothing to put on the canvas when the picture
 * fits the frame, or without `onCrop`.
 */
export function useFootageDrag({
  canvas,
  camera,
  w,
  h,
  crop,
  onCrop,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  /** The camera picture's width over height; null without one. */
  camera: number | null;
  /** The frame's size in the canvas's own pixels. */
  w: number;
  h: number;
  crop: CameraCrop;
  onCrop?: (next: CameraCrop) => void;
}): { axis: 'x' | 'y' | null; moved: boolean; props: FootageProps } {
  const start = useRef<{ x: number; y: number; crop: CameraCrop } | null>(null);
  const [dragging, setDragging] = useState(false);
  const axis = onCrop ? cropAxis(camera, w, h) : null;
  if (!axis || !onCrop || !camera) return { axis: null, moved: false, props: {} };
  const spare = coverSpare(camera, 1, w, h)[axis];
  const value = crop[axis];
  const set = (v: number) => onCrop({ ...crop, [axis]: unit(v) });

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    start.current = null;
    setDragging(false);
  };

  return {
    axis,
    moved: Math.abs(value - 0.5) > 0.005,
    props: {
      role: 'slider',
      tabIndex: 0,
      'aria-label': 'Where the footage sits',
      'aria-orientation': axis === 'x' ? 'horizontal' : 'vertical',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': Math.round(value * 100),
      'aria-valuetext': whereText(value, axis),
      'data-move': axis,
      'data-dragging': dragging || undefined,
      onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus({ preventScroll: true });
        start.current = { x: e.clientX, y: e.clientY, crop };
        setDragging(true);
      },
      onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
        const s = start.current;
        const el = canvas.current;
        if (!s || !el) return;
        const r = el.getBoundingClientRect();
        if (r.width <= 0) return;
        // From the page's pixels to the canvas's, then to a share of what is cut off.
        const moved = (axis === 'x' ? e.clientX - s.x : e.clientY - s.y) * (w / r.width);
        onCrop({ ...s.crop, [axis]: unit(s.crop[axis] - moved / spare) });
      },
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown: (e: React.KeyboardEvent<HTMLCanvasElement>) => {
        const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const on = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key === back) set(value - STEP);
        else if (e.key === on) set(value + STEP);
        else if (e.key === 'Home') set(0);
        else if (e.key === 'End') set(1);
        else return;
        e.preventDefault();
      },
    },
  };
}

/** A still's camera shape, width over height, once it is decoded; null without a camera. */
export function useCameraShape(still: Still | undefined): number | null {
  const blob = still?.blob ?? null;
  const [shape, setShape] = useState<{ blob: Blob; ratio: number } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let live = true;
    void createImageBitmap(blob)
      .then((b) => {
        if (live && b.height > 0) setShape({ blob, ratio: b.width / b.height });
        b.close();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [blob]);
  return shape && shape.blob === blob ? shape.ratio : null;
}

export interface MoveFootageDialogProps {
  open: boolean;
  onClose: () => void;
  /** The moment of the video the footage is moved over. */
  still: Still | undefined;
  look: TimelapseLook;
  /** What the clocks, the task name and the progress bar say at that moment. */
  sample: Partial<Omit<ComposeFrame, 'camera' | 'screen'>>;
  /** The made video's width over height. */
  ratio: number;
  crop: CameraCrop;
  /** Saved: make the video again with the footage here. */
  onSave: (next: CameraCrop) => void;
}

/**
 * "Move the footage" beside a made video: a moment of it, drawn as the video draws it, with
 * the footage dragged left and right (or up and down). Saving makes the video again.
 */
export function MoveFootageDialog({
  open,
  onClose,
  still,
  look,
  sample,
  ratio,
  crop,
  onSave,
}: MoveFootageDialogProps) {
  const pictures = useStillPictures(open ? still : undefined);
  const [draft, setDraft] = useState(crop);
  // Opened again: start from where the video has it.
  useEffect(() => {
    if (open) setDraft(crop);
  }, [open, crop]);
  const { w, h } = videoSize(ratio, 720);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera =
    pictures?.camera && pictures.camera.height > 0
      ? pictures.camera.width / pictures.camera.height
      : null;
  const move = useFootageDrag({ canvas: canvasRef, camera, w, h, crop: draft, onCrop: setDraft });

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !pictures) return;
    composeFrame(
      ctx,
      w,
      h,
      look.layout,
      {
        clock: null,
        elapsed: null,
        title: null,
        progress: null,
        ...sample,
        camera: pictures.camera,
        screen: look.layout.screen.visible ? pictures.screen : null,
      },
      { mark: '#ffffff', crop: draft },
    );
  }, [pictures, w, h, look.layout, sample, draft]);

  const changed = Math.abs(draft.x - crop.x) > 0.001 || Math.abs(draft.y - crop.y) > 0.001;

  return (
    <Modal open={open} onClose={onClose} title="Move the footage" className="move-footage-dialog">
      {open && (
        <>
          <canvas
            ref={canvasRef}
            width={w}
            height={h}
            className="tl-trim-view tl-move-view"
            style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, ${(56 * w) / h}vh)` }}
            {...move.props}
          />
          <div className="tl-move-hint field-hint">
            <span>{move.axis === 'y' ? 'Drag it up or down' : 'Drag it left or right'}</span>
            {move.moved && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(MIDDLE_CROP)}>
                Centre
              </Button>
            )}
          </div>
        </>
      )}
      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            if (changed) onSave(draft);
            onClose();
          }}
        >
          {changed ? 'Save and remake the video' : 'Done'}
        </Button>
      </div>
    </Modal>
  );
}
