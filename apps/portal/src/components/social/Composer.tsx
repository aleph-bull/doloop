import { useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Link2, Timer, Video, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Button, Panel, useToast } from '@komogon/ui';
import { postSessions, takeTimelapse } from '../../lib/after-session';
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
  usePostableSessions,
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
/** What one post carries: one video and three pictures (the API's limits). */
const MAX_VIDEOS = 1;
const MAX_IMAGES = 3;
/** Sessions one post can hold (the API's limit). */
const MAX_SESSIONS = 6;

/**
 * Where a post starts: a line, a session from the last few days (others linked to it, for
 * tasks done one after another), and a video and pictures.
 */
export function Composer() {
  const me = useMe().data?.user;
  const avatar = useAvatar().data?.dataUrl ?? null;
  const create = useCreatePost();
  const { toast } = useToast();
  const [text, setText] = useState('');
  /** The sessions it is about: the one picked, then any linked to it. */
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const sessionId = sessionIds[0] ?? '';
  const [showElapsed, setShowElapsed] = useState(false);
  // Settings › Social can keep every post to friends; then this one is too.
  const allFriends = me?.settings.social.posts === 'friends';
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  /** A file over the limit, waiting on "Compress it". */
  const [oversize, setOversize] = useState<{ file: File; maxBytes: number } | null>(null);
  const [uploaded, setUploaded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** On a phone it rests as the box alone until it is tapped (social.css, `is-resting`). */
  const [opened, setOpened] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const limits = useMediaLimits().data ?? FALLBACK_LIMITS;

  const sessionsQuery = useSessions(undefined, 15);
  const postableQuery = usePostableSessions();
  const sessions = sessionsQuery.data?.sessions;
  const postable = postableQuery.data?.sessionIds;
  const nodes = useNodes().data?.nodes;
  const recent = useMemo(() => {
    const titles = new Map((nodes ?? []).map((n) => [n.id, n.title]));
    const open = new Set(postable ?? []);
    return (sessions ?? [])
      .filter((s) => s.endedAt && s.workSeconds >= 60 && open.has(s.id))
      .slice(0, 10)
      .map((s) => {
        const on =
          s.nodeId && titles.get(s.nodeId) ? titles.get(s.nodeId)! : s.routineId ? 'routine' : '';
        return {
          id: s.id,
          label: `${fmtDate(s.startedAt)} · ${fmtMinutes(s.workSeconds / 60)} focus${on ? ` · ${on}` : ''}`,
          // On a linked session's chip.
          short: on || `${fmtMinutes(s.workSeconds / 60)} focus`,
        };
      });
  }, [sessions, nodes, postable]);
  const linkable = recent.filter((s) => !sessionIds.includes(s.id));

  // Sent here from a session's summary (`?post=`, lib/after-session.ts): that session picked
  // (with any before it in the same timelapse) and the box open, with the timelapse made for
  // it attached, then the address forgets it.
  const [params, setParams] = useSearchParams();
  const asked = params.get('post');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { refetch: refetchSessions } = sessionsQuery;
  const { refetch: refetchPostable } = postableQuery;
  const settling = sessionsQuery.isFetching || postableQuery.isFetching;
  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!asked) return;
    // Both lists asked again first: ones from before the session ended don't have it.
    if (refreshedFor.current !== asked) {
      refreshedFor.current = asked;
      void refetchSessions();
      void refetchPostable();
      return;
    }
    if (settling || !sessions || !postable) return;
    const found = postSessions(asked).filter((id) => recent.some((s) => s.id === id));
    if (found.length) {
      setSessionIds(found.slice(0, MAX_SESSIONS));
      setOpened(true);
      // The box is empty here, so the video fits; one too big waits on "Compress it".
      const video = takeTimelapse(found);
      const problem = video ? mediaProblem(video, limits) : null;
      if (video && problem?.kind === 'size')
        setOversize({ file: video, maxBytes: problem.maxBytes });
      else if (video && !problem) setFiles((f) => (f.some(isVideo) ? f : [...f, video]));
      const box = textRef.current;
      box?.scrollIntoView({ block: 'center' });
      // No keyboard before a tap on a touch screen.
      if (!window.matchMedia('(pointer: coarse)').matches) box?.focus({ preventScroll: true });
    }
    setParams(
      (p) => {
        p.delete('post');
        return p;
      },
      { replace: true },
    );
  }, [
    asked,
    sessions,
    postable,
    recent,
    settling,
    refetchSessions,
    refetchPostable,
    setParams,
    limits,
  ]);

  // The pending compress counts too, so it can't push a post past its limits.
  const held = oversize ? [...files, oversize.file] : files;
  const videos = held.filter(isVideo).length;
  const images = held.length - videos;
  const full = videos >= MAX_VIDEOS && images >= MAX_IMAGES;

  const clearInput = () => {
    if (fileRef.current) fileRef.current.value = '';
  };
  const clearFiles = () => {
    setFiles([]);
    setOversize(null);
    clearInput();
  };

  const pick = (list: FileList | null) => {
    if (!list) return;
    let v = videos;
    let i = images;
    let over = oversize;
    let skipped = false;
    const next: File[] = [];
    for (const file of list) {
      const problem = mediaProblem(file, limits);
      if (problem?.kind === 'type') {
        toast(problem.message);
        continue;
      }
      const video = isVideo(file);
      if (video ? v >= MAX_VIDEOS : i >= MAX_IMAGES) {
        skipped = true;
        continue;
      }
      if (problem?.kind === 'size') {
        // One compress at a time; another file too big waits to be picked again.
        if (over) {
          skipped = true;
          continue;
        }
        over = { file, maxBytes: problem.maxBytes };
      } else next.push(file);
      if (video) v++;
      else i++;
    }
    if (skipped) toast('1 video and 3 photos at most.');
    setFiles((f) => [...f, ...next]);
    setOversize(over);
    clearInput();
  };

  // Every post is about a session; the line and the files go with it.
  const canPost = Boolean(sessionId) && !busy && !create.isPending && !oversize;

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    try {
      const video = files.find(isVideo);
      const poster = video ? ((await posterFromVideo(video)) ?? undefined) : undefined;
      // One after another, so the label can count the whole lot.
      const sent = [];
      for (const [i, file] of files.entries())
        sent.push(
          await sendMedia(file, limits, (f) => setUploaded((i + f) / Math.max(1, files.length))),
        );
      await create.mutateAsync({
        body: text.trim() || undefined,
        sessionIds,
        showElapsed,
        friendsOnly: friendsOnly || allFriends,
        files: sent.length ? sent : undefined,
        poster,
      });
      setText('');
      setSessionIds([]);
      setShowElapsed(false);
      setFriendsOnly(false);
      clearFiles();
      setOpened(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not post it');
    } finally {
      setBusy(false);
      setUploaded(null);
    }
  };

  const resting = !opened && !text && sessionIds.length === 0 && files.length === 0 && !oversize;

  return (
    <Panel as="section" className={`composer${resting ? ' is-resting' : ''}`} aria-label="New post">
      <div className="composer-row">
        <Avatar name={me?.settings.profile.name ?? ''} url={avatar} size="sm" />
        <textarea
          ref={textRef}
          className="textarea composer-text"
          value={text}
          onFocus={() => setOpened(true)}
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
                onChange={(e) => {
                  const v = e.target.value;
                  setSessionIds((ids) => (v ? [v, ...ids.slice(1).filter((x) => x !== v)] : []));
                }}
                aria-label="Share a session"
              >
                <option value="">Which session?</option>
                {recent
                  .filter((s) => s.id === sessionId || !sessionIds.includes(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {/* Sessions on other tasks, one after another: one post, and one timelapse. */}
          {sessionIds.slice(1).map((id) => (
            <span key={id} className="chip composer-file">
              <Link2 size={13} aria-hidden />
              {recent.find((s) => s.id === id)?.short ?? 'Session'}
              <button
                type="button"
                className="composer-file-x"
                aria-label="Unlink this session"
                onClick={() => setSessionIds((ids) => ids.filter((x) => x !== id))}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
          {sessionId && linkable.length > 0 && sessionIds.length < MAX_SESSIONS && (
            <label className="composer-session">
              <Link2 size={15} aria-hidden />
              <select
                className="select composer-select"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setSessionIds((ids) => (ids.includes(v) ? ids : [...ids, v]));
                }}
                aria-label="Link another session"
              >
                <option value="">Link another session</option>
                {linkable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {sessionId && (
            <button
              type="button"
              className="chip composer-toggle"
              aria-pressed={showElapsed}
              onClick={() => setShowElapsed((v) => !v)}
            >
              Elapsed
            </button>
          )}
          {sessionId && (
            <button
              type="button"
              className="chip composer-toggle"
              aria-pressed={friendsOnly || allFriends}
              disabled={allFriends}
              onClick={() => setFriendsOnly((v) => !v)}
            >
              Friends only
            </button>
          )}
          {files.map((file, at) => (
            <span
              key={`${file.name}-${file.size}-${at}`}
              className="chip composer-file"
              title={file.name}
            >
              {isVideo(file) ? (
                <Video size={13} aria-hidden />
              ) : (
                <ImageIcon size={13} aria-hidden />
              )}
              {file.name.length > 24 ? `${file.name.slice(0, 22)}…` : file.name}
              <button
                type="button"
                className="composer-file-x"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((f) => f.filter((_, i) => i !== at))}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
          {!full && (
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
              <ImageIcon size={15} aria-hidden />{' '}
              {held.length ? 'Add more' : 'Add photos or a video'}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => pick(e.target.files)}
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
            setFiles((f) => [
              ...f,
              new File([blob], renamed(oversize.file.name, blob), { type: blob.type }),
            ]);
            setOversize(null);
          }}
          onCancel={() => setOversize(null)}
        />
      )}
    </Panel>
  );
}
