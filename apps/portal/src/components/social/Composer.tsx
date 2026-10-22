import { useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Timer, Video, X } from 'lucide-react';
import { Button, Panel, useToast } from '@komogon/ui';
import { fmtDate, fmtMinutes } from '../../lib/format';
import {
  FALLBACK_LIMITS,
  isVideo,
  mediaProblem,
  posterFromVideo,
  sendMedia,
} from '../../lib/post-media';
import {
  useAvatar,
  useCreatePost,
  useMe,
  useMediaLimits,
  useNodes,
  useSessions,
} from '../../lib/queries';
import { Avatar } from './Avatar';
import { CompressOffer } from './CompressOffer';

/** The compressed copy keeps the name, with the extension of what it now is. */
const renamed = (name: string, blob: Blob) =>
  `${name.replace(/\.[^.]+$/, '')}.${
    blob.type === 'video/webm' ? 'webm' : blob.type.startsWith('video/') ? 'mp4' : 'jpg'
  }`;

const MAX = 500;

/** Where a post starts: a line, a session from the last few days, a video, or all three. */
export function Composer() {
  const me = useMe().data?.user;
  const avatar = useAvatar().data?.dataUrl ?? null;
  const create = useCreatePost();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [video, setVideo] = useState<File | null>(null);
  /** A file over the limit, waiting on "Compress it". */
  const [oversize, setOversize] = useState<{ file: File; maxBytes: number } | null>(null);
  const [uploaded, setUploaded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const limits = useMediaLimits().data ?? FALLBACK_LIMITS;

  const sessions = useSessions(undefined, 15).data?.sessions;
  const nodes = useNodes().data?.nodes;
  const recent = useMemo(() => {
    const titles = new Map((nodes ?? []).map((n) => [n.id, n.title]));
    return (sessions ?? [])
      .filter((s) => s.endedAt && s.workSeconds >= 60)
      .slice(0, 10)
      .map((s) => ({
        id: s.id,
        label: `${fmtDate(s.startedAt)} · ${fmtMinutes(s.workSeconds / 60)}${
          s.nodeId && titles.get(s.nodeId)
            ? ` · ${titles.get(s.nodeId)}`
            : s.routineId
              ? ' · routine'
              : ''
        }`,
      }));
  }, [sessions, nodes]);

  const clearFile = () => {
    setVideo(null);
    setOversize(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = (file: File | null) => {
    if (!file) return;
    const problem = mediaProblem(file, limits);
    if (problem?.kind === 'type') return toast(problem.message);
    if (problem?.kind === 'size') return setOversize({ file, maxBytes: problem.maxBytes });
    setOversize(null);
    setVideo(file);
  };

  // Every post is about a session; the line and the file go with it.
  const canPost = Boolean(sessionId) && !busy && !create.isPending;

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    try {
      const poster =
        video && isVideo(video) ? ((await posterFromVideo(video)) ?? undefined) : undefined;
      const file = video ? await sendMedia(video, limits, setUploaded) : {};
      await create.mutateAsync({ body: text.trim() || undefined, sessionId, ...file, poster });
      setText('');
      setSessionId('');
      clearFile();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not post it');
    } finally {
      setBusy(false);
      setUploaded(null);
    }
  };

  return (
    <Panel as="section" className="composer" aria-label="New post">
      <div className="composer-row">
        <Avatar name={me?.settings.profile.name ?? ''} url={avatar} size="sm" />
        <textarea
          className="textarea composer-text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          placeholder={recent.length ? 'How did it go?' : 'Finish a session first, then share it.'}
          rows={2}
          aria-label="Your post"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
          }}
        />
      </div>
      <div className="composer-foot">
        <div className="composer-attach">
          {recent.length > 0 && (
            <label className="composer-session">
              <Timer size={15} aria-hidden />
              <select
                className="select composer-select"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                aria-label="Share a session"
              >
                <option value="">Which session?</option>
                {recent.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {video ? (
            <span className="chip composer-file" title={video.name}>
              {isVideo(video) ? (
                <Video size={13} aria-hidden />
              ) : (
                <ImageIcon size={13} aria-hidden />
              )}
              {video.name.length > 24 ? `${video.name.slice(0, 22)}…` : video.name}
              <button
                type="button"
                className="composer-file-x"
                aria-label="Remove the file"
                onClick={clearFile}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
              <ImageIcon size={15} aria-hidden /> Add a photo or video
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!canPost}
          loading={busy}
          onClick={() => void submit()}
        >
          {uploaded === null ? 'Post' : `Uploading ${Math.round(uploaded * 100)}%`}
        </Button>
      </div>
      {oversize && (
        <CompressOffer
          key={`${oversize.file.name}-${oversize.file.size}`}
          file={oversize.file}
          maxBytes={oversize.maxBytes}
          onDone={(blob) => {
            setVideo(new File([blob], renamed(oversize.file.name, blob), { type: blob.type }));
            setOversize(null);
          }}
          onCancel={clearFile}
        />
      )}
    </Panel>
  );
}
