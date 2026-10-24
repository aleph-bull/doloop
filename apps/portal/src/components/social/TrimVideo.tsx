import { timelapseClock } from '@komogon/core';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal, Spinner, useToast } from '@komogon/ui';
import { api, type FeedPost, type PostFile } from '../../lib/api';
import { compressVideo } from '../../lib/compress';
import { FALLBACK_LIMITS, posterFromVideo, sendMedia } from '../../lib/post-media';
import { useCutPostVideo, useMediaLimits } from '../../lib/queries';
import { cutVideo, videoDuration, videoStills } from '../../lib/video-cut';

/** The least a cut keeps, in seconds. */
const MIN_KEEP = 1;
/** Pictures in the strip: as many as fit at the video's shape, within these. */
const THUMBS_MIN = 5;
const THUMBS_MAX = 12;

const round = (t: number) => Math.round(t * 100) / 100;

/** The post's video as a file: through its R2 link, or from the API that keeps it. */
async function loadVideo(post: FeedPost, file: PostFile): Promise<Blob> {
  const { url } = await api.postMediaUrl(post.id, file.n);
  const blob = url
    ? await fetch(url).then((r) => {
        if (!r.ok) throw new Error('Could not load the video.');
        return r.blob();
      })
    : await api.postMedia(post.id, file.n, file.bytes);
  return blob.type === file.mime ? blob : new Blob([blob], { type: file.mime });
}

/**
 * Trimming a video already posted: the timelapse's trim (a strip with a handle at each end,
 * a playhead, play) over the posted video. Save cuts it in the browser, uploads the cut and
 * puts it in the old one's place.
 */
export function TrimVideoDialog({
  post,
  file,
  onClose,
}: {
  post: FeedPost;
  file: PostFile;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const limits = useMediaLimits().data ?? FALLBACK_LIMITS;
  const cutPost = useCutPostVideo();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [length, setLength] = useState(0);
  const [shape, setShape] = useState(16 / 9);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    loadVideo(post, file).then(
      (b) => {
        if (!live) return;
        url = URL.createObjectURL(b);
        setBlob(b);
        setSrc(url);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
      stop.current?.abort();
    };
    // The file to trim is the one it opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- the strip's pictures ----- */
  const [strip, setStrip] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => setStrip({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [src]);
  const count =
    strip && strip.h > 0
      ? Math.max(THUMBS_MIN, Math.min(THUMBS_MAX, Math.round(strip.w / (strip.h * shape))))
      : 0;
  const [thumbs, setThumbs] = useState<Array<string | null>>([]);
  useEffect(() => {
    if (!blob || !length || !count || !strip) return;
    let live = true;
    setThumbs(Array.from({ length: count }, () => null));
    // The middle of each picture's stretch of the video.
    const times = Array.from({ length: count }, (_, k) => ((k + 0.5) * length) / count);
    const height = Math.round(strip.h * Math.min(2, window.devicePixelRatio || 1));
    void (async () => {
      let i = 0;
      for await (const u of videoStills(blob, times, height)) {
        if (!live) break;
        const at = i++;
        setThumbs((t) => t.map((x, k) => (k === at ? u : x)));
      }
    })().catch(() => undefined); // The strip stays plain; the trim still works.
    return () => {
      live = false;
    };
    // Redone when the count changes, not on every pixel of a resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, length, count]);

  /* ----- the viewer ----- */
  const ready = (v: HTMLVideoElement) => {
    setShape(v.videoWidth / Math.max(1, v.videoHeight) || 16 / 9);
    const take = (d: number) => {
      setLength(d);
      setFrom(0);
      setTo(d);
    };
    // A video recorded in the browser may not say how long it is until read through.
    if (Number.isFinite(v.duration) && v.duration > 0) take(v.duration);
    else if (blob) void videoDuration(blob).then(take, () => setFailed(true));
  };
  const seek = (t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setAt(t);
  };

  // Playing: the kept part, then back to its start.
  useEffect(() => {
    const v = videoRef.current;
    if (!playing || !v) return;
    if (v.currentTime < from || v.currentTime >= to - 0.05) v.currentTime = from;
    void v.play().catch(() => setPlaying(false));
    let raf = 0;
    const tick = () => {
      if (v.currentTime >= to || v.ended) {
        v.pause();
        v.currentTime = from;
        setAt(from);
        setPlaying(false);
        return;
      }
      setAt(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.pause();
    };
  }, [playing, from, to]);

  /* ----- dragging ----- */
  const span = Math.max(0.01, length);
  const pct = (t: number) => Math.max(0, Math.min(100, (t / span) * 100));
  const trimmed = length > 0 && (from > 0.05 || to < length - 0.05);
  const timeAt = (clientX: number) => {
    const r = stripRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
  };
  const gap = Math.min(MIN_KEEP, length);
  const moveStart = (t: number) => {
    const next = round(Math.max(0, Math.min(t, to - gap)));
    setFrom(next);
    seek(next);
  };
  const moveEnd = (t: number) => {
    const next = round(Math.min(length, Math.max(t, from + gap)));
    setTo(next);
    seek(next);
  };
  const handleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handleMove = (e: React.PointerEvent, which: 'start' | 'end') => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    if (which === 'start') moveStart(timeAt(e.clientX));
    else moveEnd(timeAt(e.clientX));
  };
  const handleKey = (e: React.KeyboardEvent, which: 'start' | 'end') => {
    const step = Math.max(0.1, span / 100);
    const d = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    if (!d) return;
    e.preventDefault();
    if (which === 'start') moveStart(from + d);
    else moveEnd(to + d);
  };
  // A press on the strip between the handles moves the playhead there.
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0 || !length) return;
    setPlaying(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seek(Math.max(from, Math.min(to, timeAt(e.clientX))));
  };
  const scrubMove = (e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    seek(Math.max(from, Math.min(to, timeAt(e.clientX))));
  };

  const handle = (which: 'start' | 'end') => (
    <span
      role="slider"
      tabIndex={0}
      className={`tl-trim-handle is-${which}`}
      aria-label={which === 'start' ? 'Where the video starts' : 'Where the video ends'}
      aria-valuemin={0}
      aria-valuemax={Math.round(length)}
      aria-valuenow={Math.round(which === 'start' ? from : to)}
      aria-valuetext={timelapseClock(which === 'start' ? from : to)}
      onPointerDown={handleDown}
      onPointerMove={(e) => handleMove(e, which)}
      onKeyDown={(e) => handleKey(e, which)}
    >
      {which === 'start' ? (
        <ChevronLeft size={14} aria-hidden />
      ) : (
        <ChevronRight size={14} aria-hidden />
      )}
    </span>
  );

  /* ----- saving ----- */
  const save = async () => {
    if (!blob || !trimmed) return;
    setPlaying(false);
    const ctrl = new AbortController();
    stop.current = ctrl;
    setSaving(0);
    try {
      let cut = await cutVideo(blob, from, to, (p) => setSaving(p * 0.7), ctrl.signal);
      // Re-encoded, a cut can come out over the limit; it shrinks to fit like a new post's.
      if (cut.size > limits.videoMaxBytes)
        cut = await compressVideo(cut, limits.videoMaxBytes, () => undefined, ctrl.signal);
      const poster = await posterFromVideo(cut);
      const sent = await sendMedia(cut, limits, (p) => setSaving(0.7 + p * 0.3));
      if (ctrl.signal.aborted) return;
      await cutPost.mutateAsync({
        id: post.id,
        input: { ...sent, ...(poster ? { poster } : {}) },
      });
      onClose();
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setSaving(null);
      toast(err instanceof Error ? err.message : "Couldn't save the cut");
    }
  };

  return createPortal(
    <Modal
      open
      onClose={onClose}
      title="Trim video"
      phone="full"
      initialFocus="dialog"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!trimmed}
            loading={saving !== null}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="tl-trim post-trim">
        {failed ? (
          <p className="muted text-sm">Could not load the video.</p>
        ) : !src ? (
          <div className="post-trim-wait" style={{ aspectRatio: String(shape) }}>
            <Spinner />
          </div>
        ) : (
          <video
            ref={videoRef}
            className="tl-trim-view post-trim-view"
            src={src}
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => ready(e.currentTarget)}
            onClick={() => length && setPlaying((p) => !p)}
          />
        )}
        <div className="tl-trim-bar">
          <button
            type="button"
            className="tl-trim-play"
            aria-label={playing ? 'Pause' : 'Play the trimmed part'}
            disabled={!length || saving !== null}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
          </button>
          <div
            ref={stripRef}
            className="tl-trim-strip"
            onPointerDown={scrub}
            onPointerMove={scrubMove}
          >
            <div className="tl-trim-thumbs" aria-hidden>
              {thumbs.map((u, k) =>
                u ? <img key={k} src={u} alt="" draggable={false} /> : <span key={k} />,
              )}
            </div>
            {length > 0 && (
              <>
                <span
                  className="tl-trim-shade is-left"
                  style={{ left: 0, width: `${pct(from)}%` }}
                />
                <span
                  className="tl-trim-shade is-right"
                  style={{ left: `${pct(to)}%`, right: 0 }}
                />
                <div
                  className={`tl-trim-frame${trimmed ? ' is-trimmed' : ''}`}
                  style={{ left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%` }}
                >
                  {handle('start')}
                  {handle('end')}
                </div>
                <span className="tl-trim-head" style={{ left: `${pct(at)}%` }} aria-hidden />
              </>
            )}
          </div>
        </div>
        <div className="tl-trim-times field-hint tabular">
          <span>{timelapseClock(from)}</span>
          <span>
            {saving !== null
              ? `Saving ${Math.round(saving * 100)}%`
              : trimmed
                ? `Keeps ${timelapseClock(to - from)} of ${timelapseClock(length)}`
                : timelapseClock(length)}
          </span>
          <span>{timelapseClock(to)}</span>
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
