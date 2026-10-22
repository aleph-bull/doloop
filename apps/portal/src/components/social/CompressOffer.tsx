import { useEffect, useRef, useState } from 'react';
import { Button } from '@komogon/ui';
import { CompressError, compressImage, compressVideo } from '../../lib/compress';
import { fmtSize, isVideo } from '../../lib/post-media';

interface Props {
  file: Blob;
  maxBytes: number;
  /** The smaller file, ready to post. */
  onDone: (file: Blob) => void;
  onCancel: () => void;
  /** Says what happens after compressing, e.g. "Compress and share". */
  actionLabel?: string;
}

/**
 * A file over the limit: say so, and offer to shrink it to fit. Videos are re-encoded in
 * the browser (it takes a little while, with a percentage); pictures are redrawn smaller.
 */
export function CompressOffer({ file, maxBytes, onDone, onCancel, actionLabel }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const video = isVideo(file);

  useEffect(() => () => abort.current?.abort(), []);

  const compress = async () => {
    setError(null);
    setProgress(0);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const out = video
        ? await compressVideo(file, maxBytes, setProgress, ctrl.signal)
        : await compressImage(file, maxBytes);
      if (!ctrl.signal.aborted) onDone(out);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(
        err instanceof CompressError
          ? err.message
          : `Couldn't compress the ${video ? 'video' : 'picture'}.`,
      );
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const stop = () => {
    abort.current?.abort();
    setProgress(null);
  };

  return (
    <div className="compress-offer" role="status">
      <p className="text-sm">
        {progress === null ? (
          <>
            This {video ? 'video' : 'picture'} is {fmtSize(file.size)}, and posts take up to{' '}
            {fmtSize(maxBytes)}.
          </>
        ) : (
          <>Compressing… {Math.round(progress * 100)}%</>
        )}
      </p>
      {error && <p className="muted text-sm">{error}</p>}
      <div className="flex gap-2 flex-wrap">
        {progress === null ? (
          <>
            <Button size="sm" variant="primary" onClick={() => void compress()}>
              {actionLabel ?? 'Compress it'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={stop}>
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
