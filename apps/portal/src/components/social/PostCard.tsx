import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Award,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Flag,
  Flame,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Scissors,
  ThumbsUp,
  Timer,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { badgeByKey, findMentions, showsUsername } from '@komogon/core';
import { Button, Modal, Panel, Spinner, useToast } from '@komogon/ui';
import {
  api,
  postFiles,
  type FeedComment,
  type FeedPost,
  type Person,
  type PostFile,
  type PostSession,
} from '../../lib/api';
import { timeRange } from '../../lib/calendar';
import { fmtAgo } from '../../lib/format';
import { NARROW_QUERY, useMediaQuery } from '../../lib/media';
import {
  useAddComment,
  useComments,
  useDeleteComment,
  useDeletePost,
  useEditPost,
  useLikePost,
} from '../../lib/queries';
import { Avatar } from './Avatar';
import { TrimVideoDialog } from './TrimVideo';

const unknown = (id: string): Person => ({
  id,
  name: 'Someone',
  username: null,
  avatarUrl: null,
  university: null,
});

/** Minutes as a big number with a small unit: "1.5 h", "45 min". */
export function figure(minutes: number): { value: string; unit: string } {
  if (minutes < 60) return { value: String(Math.max(1, Math.round(minutes))), unit: 'min' };
  const h = minutes / 60;
  return { value: String(h >= 100 ? Math.round(h) : Math.round(h * 10) / 10), unit: 'h' };
}

/** The top right of a post: when the session ran, then focus (and elapsed) as small cards. */
export function SessionSide({ session }: { session: PostSession | null }) {
  if (!session) return null;
  const focus = figure(session.minutes);
  const elapsed = session.elapsedMinutes !== null ? figure(session.elapsedMinutes) : null;
  return (
    <div className="post-side">
      {session.startedAt && session.endedAt && (
        <span className="post-times tabular">{timeRange(session.startedAt, session.endedAt)}</span>
      )}
      <div className="post-stats">
        <span className="post-stat">
          <Timer size={15} aria-hidden className="post-session-icon" />
          <span className="post-session-figure tabular">
            {focus.value}
            <small>{focus.unit}</small>
          </span>
          <span className="post-session-label">focus</span>
        </span>
        {elapsed && (
          <span className="post-stat">
            <span className="post-session-figure tabular">
              {elapsed.value}
              <small>{elapsed.unit}</small>
            </span>
            <span className="post-session-label">elapsed</span>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * What the session earned, after kudos and comments: the daily streak it ended on, then one
 * award for all its badges (named on hover, or on a tap).
 */
function SessionWins({ session }: { session: PostSession }) {
  const [open, setOpen] = useState(false);
  const names = (session.badges ?? []).flatMap((k) => badgeByKey(k)?.name ?? []);
  const streak = session.streak ?? 0;
  return (
    <>
      {streak > 0 && (
        <span className="post-streak" title={`${streak} ${streak === 1 ? 'day' : 'days'}`}>
          <Flame size={15} aria-hidden />
          <span className="tabular">{streak}</span>
        </span>
      )}
      {names.length > 0 && (
        <span
          className={`post-awards${open ? ' is-open' : ''}`}
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className="post-action"
            aria-label={`Badges: ${names.join(', ')}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            onBlur={() => setOpen(false)}
          >
            <Award size={17} aria-hidden />
          </button>
          <span className="post-awards-tip" role="tooltip">
            {names.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </span>
        </span>
      )}
    </>
  );
}

/**
 * The ⋯ under every post. Yours: edit the words, trim the video when there is one, or delete
 * it after "Are you sure?". Someone else's: Hide and Report, which only close the menu for
 * now (not built yet).
 */
function PostMenu({
  post,
  onEdit,
  onTrim,
}: {
  post: FeedPost;
  onEdit: () => void;
  onTrim?: () => void;
}) {
  const del = useDeletePost();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setSure(false);
    };
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <span className="post-menu" ref={wrap}>
      <button
        type="button"
        className={`post-action${open ? ' is-on' : ''}`}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setSure(false);
        }}
      >
        <MoreHorizontal size={17} aria-hidden />
      </button>
      {open && (
        <span className="post-menu-pop" role="menu">
          {sure ? (
            <span className="post-menu-sure">
              <span>Are you sure?</span>
              <span className="post-menu-actions">
                <Button
                  size="sm"
                  variant="danger"
                  loading={del.isPending}
                  onClick={() =>
                    del.mutate(post.id, {
                      onError: (err) =>
                        toast(err instanceof Error ? err.message : 'Could not delete it'),
                    })
                  }
                >
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
                  Keep
                </Button>
              </span>
            </span>
          ) : post.you ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="post-menu-item"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
              >
                <Pencil size={14} aria-hidden /> Edit
              </button>
              {onTrim && (
                <button
                  type="button"
                  role="menuitem"
                  className="post-menu-item"
                  onClick={() => {
                    setOpen(false);
                    onTrim();
                  }}
                >
                  <Scissors size={14} aria-hidden /> Trim video
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="post-menu-item is-danger"
                onClick={() => setSure(true)}
              >
                <Trash2 size={14} aria-hidden /> Delete
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className="post-menu-item"
                onClick={() => setOpen(false)}
              >
                <EyeOff size={14} aria-hidden /> Hide
              </button>
              <button
                type="button"
                role="menuitem"
                className="post-menu-item is-danger"
                onClick={() => setOpen(false)}
              >
                <Flag size={14} aria-hidden /> Report
              </button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

/** The post's words in a box, saved over the old ones. */
function EditBody({ post, onDone }: { post: FeedPost; onDone: () => void }) {
  const edit = useEditPost();
  const { toast } = useToast();
  const [text, setText] = useState(post.body ?? '');
  const save = () =>
    edit.mutate(
      { id: post.id, body: text.trim() },
      {
        onSuccess: onDone,
        onError: (err) => toast(err instanceof Error ? err.message : 'Could not save it'),
      },
    );
  return (
    <div className="post-edit">
      <textarea
        className="textarea post-edit-text"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 500))}
        placeholder="How did it go?"
        aria-label="Your post"
        rows={1}
        autoFocus
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
          if (e.key === 'Escape') onDone();
        }}
      />
      <span className="post-edit-actions">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={edit.isPending} onClick={save}>
          Save
        </Button>
      </span>
    </div>
  );
}

/**
 * Where one of a post's files (`n`, 0 first) plays from: a short-lived R2 link straight into
 * `src`, or, for a file the API keeps, the bytes fetched with the token and played from a
 * blob. `retry` asks for a fresh link when one has run out.
 */
function usePostFile(post: FeedPost, n: number, enabled: boolean) {
  const link = useQuery({
    queryKey: ['social', 'media-url', post.id, n],
    queryFn: () => api.postMediaUrl(post.id, n),
    enabled,
    // Links last an hour; ask again well before that.
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
  });
  const inApi = link.data !== undefined && link.data.url === null;
  // Its size changes when the video is trimmed, and with it the address asked.
  const size = postFiles(post).find((f) => f.n === n)?.bytes;
  const bytes = useQuery({
    queryKey: ['social', 'media', post.id, n, size],
    queryFn: () => api.postMedia(post.id, n, size),
    enabled: enabled && inApi,
    staleTime: Infinity,
  });
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes.data) return;
    const next = URL.createObjectURL(bytes.data);
    setBlobUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes.data]);
  const retried = useRef(false);
  return {
    src: link.data?.url ?? blobUrl,
    isError: link.isError || bytes.isError,
    retry: () => {
      if (retried.current || !link.data?.url) return;
      retried.current = true;
      void link.refetch();
    },
  };
}

/** A picture on a post; `onRatio` hears its shape once it has loaded. */
function PostImage({
  post,
  n,
  onRatio,
}: {
  post: FeedPost;
  n: number;
  onRatio?: (ratio: number) => void;
}) {
  const file = usePostFile(post, n, true);
  if (file.isError) return <p className="muted text-sm">Could not load the picture.</p>;
  if (!file.src) return <div className="post-image is-loading" aria-hidden />;
  return (
    <img
      className="post-image"
      src={file.src}
      alt=""
      onError={file.retry}
      onLoad={(e) =>
        onRatio?.(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight))
      }
    />
  );
}

/** The poster until it is asked to play; then the video, paused again when `active` goes. */
function PostVideo({
  post,
  n,
  poster,
  active = true,
}: {
  post: FeedPost;
  n: number;
  poster: string | null;
  active?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const file = usePostFile(post, n, playing);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);

  if (playing && file.src)
    return (
      <video
        ref={ref}
        className="post-video"
        src={file.src}
        controls
        autoPlay
        loop
        playsInline
        onError={file.retry}
      />
    );
  return (
    <button
      type="button"
      className="post-video post-video-poster"
      onClick={() => setPlaying(true)}
      aria-label="Play the timelapse"
      style={poster ? { backgroundImage: `url(${poster})` } : undefined}
    >
      <span className="post-play" aria-hidden>
        {playing ? <Spinner /> : <Play size={22} fill="currentColor" />}
      </span>
      {file.isError && <span className="post-video-error">Could not load the video.</span>}
    </button>
  );
}

/** One file of a post: a picture or the video. */
function PostFileView({
  post,
  file,
  active,
  onRatio,
}: {
  post: FeedPost;
  file: PostFile;
  active?: boolean;
  onRatio?: (ratio: number) => void;
}) {
  return file.mime.startsWith('image/') ? (
    <PostImage post={post} n={file.n} onRatio={onRatio} />
  ) : (
    <PostVideo post={post} n={file.n} poster={file.poster} active={active} />
  );
}

/** Instagram allows a carousel between 4:5 and 1.91:1; ours keeps to 4:5 and 16:9. */
const clampRatio = (r: number) => Math.min(16 / 9, Math.max(4 / 5, r));

/**
 * Several files, one at a time, like an Instagram carousel: swiped on a touch screen
 * (scroll snapping), arrows on a computer, dots under it and "2/4" in the corner. The
 * frame takes the first file's shape, so the others are cropped to it (pictures) or sit in
 * it (the video).
 */
function Carousel({ post, files }: { post: FeedPost; files: PostFile[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [ratio, setRatio] = useState(1);
  const first = files[0];
  // A video first: its poster says the shape.
  useEffect(() => {
    if (!first?.poster) return;
    const img = new Image();
    img.onload = () => setRatio(clampRatio(img.naturalWidth / Math.max(1, img.naturalHeight)));
    img.src = first.poster;
  }, [first?.poster]);
  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };
  return (
    <div className="post-carousel" aria-roledescription="carousel" aria-label="Photos and video">
      <div
        ref={track}
        className="post-carousel-track"
        style={{ aspectRatio: String(ratio) }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {files.map((f, i) => (
          <div
            key={f.n}
            className="post-carousel-slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${files.length}`}
          >
            <PostFileView
              post={post}
              file={f}
              active={i === at}
              onRatio={i === 0 ? (r) => setRatio(clampRatio(r)) : undefined}
            />
          </div>
        ))}
      </div>
      <span className="post-carousel-count tabular" aria-hidden>
        {at + 1}/{files.length}
      </span>
      {at > 0 && (
        <button
          type="button"
          className="post-carousel-arrow is-prev"
          aria-label="Previous"
          onClick={() => go(at - 1)}
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
      )}
      {at < files.length - 1 && (
        <button
          type="button"
          className="post-carousel-arrow is-next"
          aria-label="Next"
          onClick={() => go(at + 1)}
        >
          <ChevronRight size={18} aria-hidden />
        </button>
      )}
      <div className="post-carousel-dots" aria-hidden>
        {files.map((f, i) => (
          <span key={f.n} className={i === at ? 'is-on' : undefined} />
        ))}
      </div>
    </div>
  );
}

/** A comment's words, with each @username it names linked to that person. */
function CommentBody({
  comment,
  people,
}: {
  comment: FeedComment;
  people: Record<string, Person>;
}) {
  const named = new Map(
    (comment.mentions ?? []).flatMap((id) => {
      const p = people[id];
      return p?.username ? [[p.username, p] as const] : [];
    }),
  );
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of findMentions(comment.body, (u) => named.has(u))) {
    parts.push(comment.body.slice(at, m.start));
    parts.push(
      <Link key={m.start} to={`/profile/${named.get(m.username)!.id}`} className="post-mention">
        {comment.body.slice(m.start, m.end)}
      </Link>,
    );
    at = m.end;
  }
  parts.push(comment.body.slice(at));
  return <span className="post-comment-body">{parts}</span>;
}

/** The comment box: what is typed, Reply filling it in, and sending. `field` is its input. */
type CommentBox = ReturnType<typeof useCommentBox>;
type FieldRef = RefObject<HTMLInputElement | null>;

function useCommentBox(postId: string, field: FieldRef) {
  const add = useAddComment(postId);
  const [text, setText] = useState('');
  const { toast } = useToast();

  /** Reply: their @username at the start of the box (no threads), then type after it. */
  const reply = (username: string) => {
    const there = findMentions(text, (u) => u === username).length > 0;
    const next = there ? text : `@${username} ${text.trimStart()}`;
    setText(next);
    const input = field.current;
    if (!input) return;
    input.focus();
    requestAnimationFrame(() => input.setSelectionRange(next.length, next.length));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    add.mutate(body, {
      onSuccess: () => setText(''),
      onError: (err) => toast(err instanceof Error ? err.message : 'Could not post the comment'),
    });
  };

  return {
    text,
    setText,
    focus: () => field.current?.focus(),
    reply,
    submit,
    sending: add.isPending,
  };
}

function CommentForm({ box, field }: { box: CommentBox; field: FieldRef }) {
  return (
    <form className="post-comment-form" onSubmit={box.submit}>
      <input
        ref={field}
        className="input"
        value={box.text}
        onChange={(e) => box.setText(e.target.value)}
        placeholder="Say something"
        maxLength={500}
        aria-label="Your comment"
      />
      <Button
        type="submit"
        size="sm"
        variant="primary"
        disabled={!box.text.trim()}
        loading={box.sending}
      >
        Send
      </Button>
    </form>
  );
}

function CommentList({
  post,
  people,
  onReply,
}: {
  post: FeedPost;
  people: Record<string, Person>;
  onReply: (username: string) => void;
}) {
  const q = useComments(post.id, true);
  const remove = useDeleteComment(post.id);
  const who = { ...people, ...(q.data?.people ?? {}) };

  return (
    <>
      {q.isPending ? (
        <Spinner />
      ) : (
        q.data?.comments.map((c) => {
          const p = who[c.userId] ?? unknown(c.userId);
          return (
            <div key={c.id} className="post-comment">
              <Link to={`/profile/${c.userId}`} aria-label={p.name}>
                <Avatar name={p.name} url={p.avatarUrl} size="xs" />
              </Link>
              <div className="post-comment-main">
                <span className="post-comment-head">
                  <Link to={`/profile/${c.userId}`} className="post-name">
                    {p.name}
                  </Link>
                  <span className="post-when">{fmtAgo(c.createdAt)}</span>
                  {!c.you && p.username && (
                    <button
                      type="button"
                      className="post-comment-reply"
                      onClick={() => onReply(p.username!)}
                    >
                      Reply
                    </button>
                  )}
                </span>
                <CommentBody comment={c} people={who} />
              </div>
              {(c.you || post.you) && (
                <button
                  type="button"
                  className="post-comment-x"
                  aria-label="Delete comment"
                  title="Delete"
                  onClick={() => remove.mutate(c.id)}
                >
                  <X size={14} aria-hidden />
                </button>
              )}
            </div>
          );
        })
      )}
    </>
  );
}

function Comments({ post, people }: { post: FeedPost; people: Record<string, Person> }) {
  const field = useRef<HTMLInputElement>(null);
  const box = useCommentBox(post.id, field);
  return (
    <div className="post-comments">
      <CommentList post={post} people={people} onReply={box.reply} />
      <CommentForm box={box} field={field} />
    </div>
  );
}

/**
 * On a phone, a post on a screen of its own (owner, 2026-10-25): the post, every comment
 * under it, and the box pinned at the bottom, above the keyboard. The computer keeps the
 * comments opening under the post.
 */
function PostSheet({
  post,
  people,
  open,
  onClose,
}: {
  post: FeedPost;
  people: Record<string, Person>;
  open: boolean;
  onClose: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const box = useCommentBox(post.id, field);
  // On the body: inside the post it would take on the feed's text styles.
  return createPortal(
    <Modal
      open={open}
      onClose={onClose}
      title="Post"
      phone="full"
      initialFocus="dialog"
      className="post-sheet"
      actions={<CommentForm box={box} field={field} />}
    >
      <PostCard post={post} people={people} sheet={box} />
    </Modal>,
    document.body,
  );
}

/** What already does something when tapped, so a tap there never opens the post's screen. */
const TAPPABLE = 'a, button, input, textarea, video, dialog, .post-carousel, .post-menu-pop';

/** One post: who, when, the session or video shared, what they said, and the replies. */
export function PostCard({
  post,
  people,
  focus,
  sheet,
}: {
  post: FeedPost;
  people: Record<string, Person>;
  /** Opened from the notifications: scroll to it and outline it, its comments open if asked. */
  focus?: 'post' | 'comments';
  /** Shown on a phone's post screen (`PostSheet`), whose comment box this is. */
  sheet?: CommentBox;
}) {
  const author = people[post.userId] ?? unknown(post.userId);
  const like = useLikePost();
  const phone = useMediaQuery(NARROW_QUERY);
  const [editing, setEditing] = useState(false);
  const [trimming, setTrimming] = useState(false);
  // On a phone the comments are the post's own screen; it stays mounted once opened, so it
  // can slide away when closed.
  const [open, setOpen] = useState(focus === 'comments');
  const [sheetUsed, setSheetUsed] = useState(focus === 'comments');
  const [marked, setMarked] = useState(!!focus);
  const files = postFiles(post);
  const video = post.you ? files.find((f) => f.mime.startsWith('video/')) : undefined;

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`post-${post.id}`)?.scrollIntoView({ block: 'center' });
    const done = setTimeout(() => setMarked(false), 2400);
    return () => clearTimeout(done);
  }, [focus, post.id]);

  const openComments = () => {
    if (sheet) return sheet.focus();
    if (!phone) return setOpen((v) => !v);
    setOpen(true);
    setSheetUsed(true);
  };

  return (
    <Panel
      as="article"
      id={sheet ? undefined : `post-${post.id}`}
      className={`post${marked ? ' is-focus' : ''}`}
      onClick={
        phone && !sheet
          ? (e: React.MouseEvent) => {
              if (!(e.target as Element).closest(TAPPABLE)) openComments();
            }
          : undefined
      }
    >
      <header className="post-head">
        <Link to={`/profile/${post.userId}`} aria-label={author.name}>
          <Avatar name={author.name} url={author.avatarUrl} size="sm" />
        </Link>
        <div className="post-who">
          <span className="post-who-line">
            <Link to={`/profile/${post.userId}`} className="post-name">
              {author.name}
            </Link>
            {author.university && (
              <span className="chip chip-neutral post-uni" title={author.university.name}>
                {author.university.short ?? author.university.name}
              </span>
            )}
          </span>
          <span className="post-when">
            {showsUsername(author) && <span className="post-handle">@{author.username} · </span>}
            {fmtAgo(post.createdAt)}
            {post.friendsOnly && (
              <span className="post-audience">
                <Users size={12} aria-hidden /> Friends
              </span>
            )}
          </span>
        </div>
        <SessionSide session={post.session} />
        {post.session?.subject && <h3 className="post-title">{post.session.subject}</h3>}
      </header>

      {editing ? (
        <EditBody post={post} onDone={() => setEditing(false)} />
      ) : (
        post.body && <p className="post-body">{post.body}</p>
      )}
      {files.length > 1 ? (
        <Carousel post={post} files={files} />
      ) : (
        files[0] && <PostFileView post={post} file={files[0]} />
      )}

      <footer className="post-foot">
        <button
          type="button"
          className={`post-action${post.liked ? ' is-on' : ''}`}
          aria-pressed={post.liked}
          aria-label={post.liked ? 'Take your kudos back' : 'Give kudos'}
          title={post.liked ? 'Kudos given' : 'Give kudos'}
          onClick={() => like.mutate({ id: post.id, liked: post.liked })}
        >
          <ThumbsUp size={16} aria-hidden fill={post.liked ? 'currentColor' : 'none'} />
          {post.likes > 0 && <span className="tabular post-count">{post.likes}</span>}
        </button>
        <button
          type="button"
          className={`post-action${open && !phone ? ' is-on' : ''}`}
          aria-expanded={phone ? undefined : open}
          aria-haspopup={phone && !sheet ? 'dialog' : undefined}
          aria-label={open && !phone ? 'Hide comments' : 'Comments'}
          onClick={openComments}
        >
          <MessageCircle size={17} aria-hidden />
          {post.comments > 0 && <span className="tabular">{post.comments}</span>}
        </button>
        {post.session && <SessionWins session={post.session} />}
        <PostMenu
          post={post}
          onEdit={() => setEditing(true)}
          onTrim={video ? () => setTrimming(true) : undefined}
        />
      </footer>
      {sheet ? (
        <div className="post-comments">
          <CommentList post={post} people={people} onReply={sheet.reply} />
        </div>
      ) : (
        open && !phone && <Comments post={post} people={people} />
      )}
      {phone && !sheet && sheetUsed && (
        <PostSheet post={post} people={people} open={open} onClose={() => setOpen(false)} />
      )}
      {trimming && video && (
        <TrimVideoDialog post={post} file={video} onClose={() => setTrimming(false)} />
      )}
    </Panel>
  );
}
