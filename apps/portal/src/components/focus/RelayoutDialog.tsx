import {
  cleanNoteText,
  type TimelapseAspect,
  type TimelapseDevice,
  type TimelapseLayout,
  type TimelapseOrientation,
  type UserSettings,
} from '@komogon/core';
import { useEffect, useState } from 'react';
import { Button, Modal } from '@komogon/ui';
import type { ComposeFrame } from '../../lib/timelapse-compose';
import type { Still } from '../../lib/timelapse';
import { NoteField } from './NoteField';
import { targetsFor, TimelapseLayoutEditor } from './TimelapseLayoutEditor';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** What the video is remade with once the dialog saves. */
export interface Relayout {
  aspect: TimelapseAspect;
  layout: TimelapseLayout;
  noteText: string;
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
  /** The text on this video, which belongs to it rather than to the layout. */
  noteText: string;
  /** Saved: make the video again with this. */
  onRedraw: (next: Relayout) => void;
}

/**
 * "Change layout?" after a video is made: the timelapse layout editor, over a moment of that
 * video instead of the live camera, with the text on the video. Saving stores the layout (it
 * is the same setting as in Settings › Timelapse) and the video is made again with it; the
 * text goes on this video only.
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
  noteText: videoNote,
  onRedraw,
}: RelayoutDialogProps) {
  // Only the layout this video uses: a phone's upright or sideways one.
  const targets = targetsFor(settings, device).filter(
    (t) => device === 'computer' || t.id === (orientation ?? 'upright'),
  );
  const backdrop = useStillPictures(open ? still : undefined);
  const [noteText, setNoteText] = useState(videoNote);
  // Opened again: start from the video's own text.
  useEffect(() => {
    if (open) setNoteText(videoNote);
  }, [open, videoNote]);
  const noteChanged = cleanNoteText(noteText) !== cleanNoteText(videoNote);

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
          noteText={noteText}
          footer={({ dirty, saving, save, revert }) => (
            <>
              <NoteField value={noteText} onChange={setNoteText} />
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
                    if (!dirty && !noteChanged) return onClose();
                    const shown = await save();
                    onRedraw({ ...shown, noteText: cleanNoteText(noteText) });
                    onClose();
                  }}
                >
                  {dirty || noteChanged ? 'Save and remake the video' : 'Done'}
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
