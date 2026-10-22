import {
  cleanEndText,
  TIMELAPSE_END_SECONDS,
  TIMELAPSE_END_TEXT_MAX,
  type TimelapseAspect,
  type TimelapseDevice,
  type TimelapseLayout,
  type TimelapseOrientation,
  type UserSettings,
} from '@komogon/core';
import { useEffect, useState } from 'react';
import { Button, Input, Modal } from '@komogon/ui';
import type { ComposeFrame } from '../../lib/timelapse-compose';
import type { Still } from '../../lib/timelapse';
import { targetsFor, TimelapseLayoutEditor } from './TimelapseLayoutEditor';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** What the video is remade with once the dialog saves. */
export interface Relayout {
  aspect: TimelapseAspect;
  layout: TimelapseLayout;
  endText: string;
}

export interface RelayoutDialogProps {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  device: TimelapseDevice;
  /** A phone video's way up, which picks the layout it uses; null on a computer. */
  orientation: TimelapseOrientation | null;
  onChange: (patch: DeepPartial<UserSettings>) => unknown;
  /** The moment of the video the pieces are arranged over. */
  still: Still | undefined;
  /** What the clocks, the task name and the progress bar say at that moment. */
  sample: Partial<Omit<ComposeFrame, 'camera' | 'screen'>>;
  /** Saved: make the video again with this. */
  onRedraw: (next: Relayout) => void;
}

/**
 * "Change layout?" after a video is made: the timelapse layout editor, over a moment of that
 * video instead of the live camera, with the words at the end. Saving stores the layout (it
 * is the same setting as in Settings › Timelapse) and the video is made again with it.
 */
export function RelayoutDialog({
  open,
  onClose,
  settings,
  device,
  orientation,
  onChange,
  still,
  sample,
  onRedraw,
}: RelayoutDialogProps) {
  const preset = device === 'phone' ? settings.timelapsePhone : settings.timelapse;
  // Only the layout this video uses: a phone's upright or sideways one.
  const targets = targetsFor(settings, device).filter(
    (t) => device === 'computer' || t.id === (orientation ?? 'upright'),
  );
  const backdrop = useStillPictures(open ? still : undefined);
  const [endText, setEndText] = useState(preset.endText);
  // Opened again: start from what is saved.
  useEffect(() => {
    if (open) setEndText(preset.endText);
  }, [open, preset.endText]);
  const endChanged = cleanEndText(endText) !== preset.endText;

  return (
    <Modal open={open} onClose={onClose} title="Change the layout" className="relayout-dialog">
      <p className="muted text-sm">
        Arranged over a moment of your video. Saving changes your{' '}
        {device === 'phone' ? 'phone’s ' : ''}timelapse layout too, and makes this video again.
      </p>
      {/* Drawn once the moment is decoded, so the editor starts at its shape. */}
      {open && (backdrop || !still) && (
        <TimelapseLayoutEditor
          targets={targets}
          onChange={onChange}
          screen={device === 'computer'}
          backdrop={backdrop}
          sample={sample}
          footer={({ dirty, saving, save, revert }) => (
            <>
              <Input
                label="Words at the end"
                value={endText}
                maxLength={TIMELAPSE_END_TEXT_MAX}
                placeholder="Day 12 of finals"
                onChange={(e) => setEndText(e.target.value)}
                hint={
                  cleanEndText(endText)
                    ? `Shown over the last moment for ${TIMELAPSE_END_SECONDS} seconds as the video ends.`
                    : 'Your own words on a card at the end. Leave it empty for none.'
                }
              />
              <div className="modal-actions">
                <Button
                  variant="ghost"
                  onClick={() => {
                    revert();
                    onClose();
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={saving}
                  onClick={async () => {
                    if (!dirty && !endChanged) return onClose();
                    const shown = await save();
                    const words = cleanEndText(endText);
                    if (endChanged)
                      await Promise.resolve(
                        onChange(
                          device === 'phone'
                            ? { timelapsePhone: { endText: words } }
                            : { timelapse: { endText: words } },
                        ),
                      );
                    onRedraw({ ...shown, endText: words });
                    onClose();
                  }}
                >
                  {dirty || endChanged ? 'Save and remake the video' : 'Done'}
                </Button>
              </div>
            </>
          )}
        />
      )}
    </Modal>
  );
}

/** A still's camera and screen pictures, decoded for drawing while the dialog is open. */
function useStillPictures(still: Still | undefined) {
  const [pictures, setPictures] = useState<{
    camera: ImageBitmap | null;
    screen: ImageBitmap | null;
  } | null>(null);
  const camera = still?.blob ?? null;
  const screen = still?.screen ?? null;
  useEffect(() => {
    if (!camera && !screen) return;
    let live = true;
    let made: Array<ImageBitmap | null> = [];
    void Promise.all([
      camera ? createImageBitmap(camera).catch(() => null) : null,
      screen ? createImageBitmap(screen).catch(() => null) : null,
    ]).then(([c, s]) => {
      made = [c, s];
      if (live) setPictures({ camera: c, screen: s });
      else made.forEach((b) => b?.close());
    });
    return () => {
      live = false;
      made.forEach((b) => b?.close());
      setPictures(null);
    };
  }, [camera, screen]);
  return pictures;
}
