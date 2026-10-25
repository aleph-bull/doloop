import { CUSTOM_BACKGROUND_UPLOAD, type UserSettings } from '@komogon/core';
import { Button, Modal, Spinner, useToast } from '@komogon/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type CustomBackground } from '../lib/api';
import {
  addPicture,
  adoptServerCopy,
  dropPicture,
  localTile,
  preparePicture,
  priceOf,
  tileOf,
} from '../lib/local-backgrounds';
import { keys, useCustomBackgrounds } from '../lib/queries';

/**
 * Puts a saved look's picture back on. Most of the time it is still one of theirs (the same
 * picture), which is free; one since deleted comes back as a new upload, at the usual price,
 * after asking. False when they said no.
 */
export async function restoreUpload(dataUrl: string): Promise<boolean> {
  const tile = await tileOf(dataUrl);
  try {
    await addPicture(dataUrl, tile, 0);
    return true;
  } catch (err) {
    const cost = priceOf(err);
    if (cost === null) throw err;
    if (!window.confirm(`Add this look's picture back for ${cost} XP?`)) return false;
    await addPicture(dataUrl, tile, cost);
    return true;
  }
}

export interface UploadedBackgrounds {
  items: CustomBackground[];
  /** The upload on screen, or null while the background is one of the app's. */
  chosen: string | null;
  busy: boolean;
  pick: (id: string) => void;
  /** Upload: straight to the file picker when it is free, after the price when it isn't. */
  add: () => void;
  remove: (id: string) => void;
  /** The hidden file input and the price question. Render once. */
  ui: ReactNode;
}

type DeepPatch = { theme: Partial<UserSettings['theme']> };

/**
 * The backgrounds they upload themselves, for the background picker. The pictures stay in
 * this browser (`local-backgrounds.ts`). The first is free and each one kept beside it costs
 * XP, asked for before the file picker opens.
 */
export function useUploadedBackgrounds({
  theme,
  xp,
  serverCopy,
  patch,
  onChanged,
}: {
  theme: UserSettings['theme'] | undefined;
  xp: number;
  /** The API still keeps one uploaded before they lived in the browser. */
  serverCopy: boolean;
  patch: (p: DeepPatch) => Promise<unknown>;
  /** After one was added or deleted: the account (settings, XP) changed on the server. */
  onChanged: () => void;
}): UploadedBackgrounds {
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useCustomBackgrounds();
  const input = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const items = list.data?.backgrounds ?? [];
  const cost = list.data?.cost ?? 0;
  const chosen =
    theme?.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD
      ? (theme.customBackgroundId ?? null)
      : null;

  const changed = () => {
    void qc.invalidateQueries({ queryKey: keys.customBackgrounds });
    void qc.invalidateQueries({ queryKey: ['custom-background'] });
    void qc.invalidateQueries({ queryKey: keys.shop });
    onChanged();
  };

  // One the API kept from before, not on screen: moved into this browser when it is seen here.
  useEffect(() => {
    if (!serverCopy) return;
    adoptServerCopy().then(
      (picture) => picture && changed(),
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCopy]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const dataUrl = await preparePicture(file);
      await addPicture(dataUrl, await tileOf(file), cost);
      changed();
    } catch (err) {
      // The price moved since the list was read (another tab): show the real one next time.
      if (priceOf(err) !== null) void list.refetch();
      toast(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const ui = (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title="Another background"
        initialFocus="dialog"
        actions={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={xp < cost}
              onClick={() => {
                setAsking(false);
                // Still inside the click, so the browser lets the file picker open.
                input.current?.click();
              }}
            >
              {xp < cost ? 'Not enough XP' : 'Choose a picture'}
            </Button>
          </>
        }
      >
        <p>This one is {cost} XP.</p>
      </Modal>
    </>
  );

  return {
    items,
    chosen,
    busy,
    pick: (id) =>
      void patch({
        theme: { customBackgroundUrl: CUSTOM_BACKGROUND_UPLOAD, customBackgroundId: id },
      }),
    add: () => {
      if (!list.data || busy) return;
      if (cost > 0) setAsking(true);
      else input.current?.click();
    },
    remove: (id) => {
      if (!window.confirm('Delete this background?')) return;
      api
        .deleteCustomBackground(id)
        .then(() => dropPicture(id))
        .then(changed)
        .catch((err) => toast(err instanceof Error ? err.message : 'Could not delete it'));
    },
    ui,
  };
}

/** The Upload tile at the start of "Yours". */
export function UploadTile({ uploads }: { uploads: UploadedBackgrounds }) {
  return (
    <button
      type="button"
      className="bg-thumb bg-thumb-add"
      disabled={uploads.busy}
      aria-busy={uploads.busy}
      onClick={uploads.add}
    >
      {uploads.busy ? <Spinner /> : <ImagePlus size={18} aria-hidden />}
      <span>Upload</span>
    </button>
  );
}

/**
 * One of their uploads: picks it, with a delete in the corner when `onRemove` is given. One
 * added in another browser has no picture here and can only be deleted.
 */
export function UploadedTile({
  item,
  selected,
  onPick,
  onRemove,
}: {
  item: CustomBackground;
  selected: boolean;
  onPick: () => void;
  onRemove?: () => void;
}) {
  const tile = useQuery({
    queryKey: keys.customBackgroundTile(item.id),
    queryFn: () => localTile(item.id),
    staleTime: Infinity,
  });
  const away = tile.isSuccess && !tile.data;
  return (
    <div className="bg-own">
      <button
        type="button"
        className={`bg-thumb${selected ? ' is-selected' : ''}${away ? ' is-away' : ''}`}
        aria-pressed={selected}
        aria-label={away ? 'Not on this device' : 'Your background'}
        disabled={away}
        onClick={onPick}
      >
        {tile.data && <img className="bg-thumb-img" src={tile.data} alt="" draggable={false} />}
        {away && <span className="bg-thumb-label">Not on this device</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          className="bg-own-remove"
          aria-label="Delete this background"
          title="Delete"
          onClick={onRemove}
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}
