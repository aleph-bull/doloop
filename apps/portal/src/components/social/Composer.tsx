import { useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Timer, Video, X } from 'lucide-react';
import { Button, Panel, useToast } from '@komogon/ui';
import { fmtDate, fmtMinutes } from '../../lib/format';
import { blobToDataUrl, isVideo, mediaProblem, posterFromVideo } from '../../lib/post-media';
import { useAvatar, useCreatePost, useMe, useNodes, useSessions } from '../../lib/queries';
import { Avatar } from './Avatar';

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
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const pick = (file: File | null) => {
    if (!file) return;
    const problem = mediaProblem(file);
    if (problem) return toast(problem);
    setVideo(file);
  };

  const canPost = (text.trim() || sessionId || video) && !busy && !create.isPending;

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    try {
      const media = video ? await blobToDataUrl(video) : undefined;
      const poster =
        video && isVideo(video) ? ((await posterFromVideo(video)) ?? undefined) : undefined;
      await create.mutateAsync({
        body: text.trim() || undefined,
        sessionId: sessionId || undefined,
        media,
        poster,
      });
      setText('');
      setSessionId('');
      setVideo(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not post it');
    } finally {
      setBusy(false);
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
          placeholder="How did it go?"
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
                <option value="">Share a session</option>
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
                onClick={() => {
                  setVideo(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
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
          Post
        </Button>
      </div>
    </Panel>
  );
}
