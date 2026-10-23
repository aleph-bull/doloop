import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Play, ThumbsUp, Timer, Trash2, X } from 'lucide-react';
import { Button, Panel, Spinner, useToast } from '@komogon/ui';
import { api, type FeedPost, type Person, type PostSession } from '../../lib/api';
import { timeRange } from '../../lib/calendar';
import { fmtAgo } from '../../lib/format';
import {
  useAddComment,
  useComments,
  useDeleteComment,
  useDeletePost,
  useLikePost,
} from '../../lib/queries';
import { Avatar } from './Avatar';

const unknown = (id: string): Person => ({
  id,
  name: 'Someone',
  avatarUrl: null,
  university: null,
});

/** Minutes as a big number with a small unit: "1.5 h", "45 min". */
export function figure(minutes: number): { value: string; unit: string } {
  if (minutes < 60) return { value: String(Math.max(1, Math.round(minutes))), unit: 'min' };
  const h = minutes / 60;
  return { value: String(h >= 100 ? Math.round(h) : Math.round(h * 10) / 10), unit: 'h' };
}

/** The session on a post: focus, elapsed when shown, what it was on, and when, small. */
export function SessionRow({ session }: { session: PostSession }) {
  const focus = figure(session.minutes);
  const elapsed = session.elapsedMinutes !== null ? figure(session.elapsedMinutes) : null;
  return (
    <div className="post-session">
      <Timer size={18} aria-hidden className="post-session-icon" />
      <span className="post-session-part">
        <span className="post-session-figure tabular">
          {focus.value}
          <small>{focus.unit}</small>
        </span>
        <span className="post-session-label">focus</span>
      </span>
      {elapsed && (
        <span className="post-session-part">
          <span className="post-session-figure tabular">
            {elapsed.value}
            <small>{elapsed.unit}</small>
          </span>
          <span className="post-session-label">elapsed</span>
        </span>
      )}
      {session.subject && <span className="post-session-subject">on {session.subject}</span>}
      {session.startedAt && session.endedAt && (
        <span className="post-session-times tabular">
          {timeRange(session.startedAt, session.endedAt)}
        </span>
      )}
    </div>
  );
}

/**
 * Where a post's file plays from: a short-lived R2 link straight into `src`, or, for a file
 * the API keeps, the bytes fetched with the token and played from a blob. `retry` asks for
 * a fresh link when one has run out.
 */
function usePostFile(post: FeedPost, enabled: boolean) {
  const link = useQuery({
    queryKey: ['social', 'media-url', post.id],
    queryFn: () => api.postMediaUrl(post.id),
    enabled,
    // Links last an hour; ask again well before that.
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
  });
  const inApi = link.data !== undefined && link.data.url === null;
  const bytes = useQuery({
    queryKey: ['social', 'media', post.id],
    queryFn: () => api.postMedia(post.id),
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

/** A picture on a post. */
function PostImage({ post }: { post: FeedPost }) {
  const file = usePostFile(post, true);
  if (file.isError) return <p className="muted text-sm">Could not load the picture.</p>;
  if (!file.src) return <div className="post-image is-loading" aria-hidden />;
  return <img className="post-image" src={file.src} alt="" onError={file.retry} />;
}

/** The poster until it is asked to play; then the video. */
function PostVideo({ post }: { post: FeedPost }) {
  const [playing, setPlaying] = useState(false);
  const file = usePostFile(post, playing);

  if (playing && file.src)
    return (
      <video
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
      style={post.media?.poster ? { backgroundImage: `url(${post.media.poster})` } : undefined}
    >
      <span className="post-play" aria-hidden>
        {playing ? <Spinner /> : <Play size={22} fill="currentColor" />}
      </span>
      {file.isError && <span className="post-video-error">Could not load the video.</span>}
    </button>
  );
}

function Comments({ post, people }: { post: FeedPost; people: Record<string, Person> }) {
  const q = useComments(post.id, true);
  const add = useAddComment(post.id);
  const remove = useDeleteComment(post.id);
  const [text, setText] = useState('');
  const { toast } = useToast();
  const who = { ...people, ...(q.data?.people ?? {}) };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    add.mutate(body, {
      onSuccess: () => setText(''),
      onError: (err) => toast(err instanceof Error ? err.message : 'Could not post the comment'),
    });
  };

  return (
    <div className="post-comments">
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
                </span>
                <span className="post-comment-body">{c.body}</span>
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
      <form className="post-comment-form" onSubmit={submit}>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something"
          maxLength={500}
          aria-label="Your comment"
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={!text.trim()}
          loading={add.isPending}
        >
          Send
        </Button>
      </form>
    </div>
  );
}

/** One post: who, when, the session or video shared, what they said, and the replies. */
export function PostCard({
  post,
  people,
  focus,
}: {
  post: FeedPost;
  people: Record<string, Person>;
  /** Opened from the notifications: scroll to it and outline it, its comments open if asked. */
  focus?: 'post' | 'comments';
}) {
  const author = people[post.userId] ?? unknown(post.userId);
  const like = useLikePost();
  const del = useDeletePost();
  const { toast } = useToast();
  const [open, setOpen] = useState(focus === 'comments');
  const [marked, setMarked] = useState(!!focus);

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`post-${post.id}`)?.scrollIntoView({ block: 'center' });
    const done = setTimeout(() => setMarked(false), 2400);
    return () => clearTimeout(done);
  }, [focus, post.id]);

  return (
    <Panel as="article" id={`post-${post.id}`} className={`post${marked ? ' is-focus' : ''}`}>
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
          <span className="post-when">{fmtAgo(post.createdAt)}</span>
        </div>
        {post.you && (
          <Button
            icon
            size="sm"
            variant="ghost"
            aria-label="Delete post"
            title="Delete"
            className="post-delete"
            loading={del.isPending}
            onClick={() =>
              del.mutate(post.id, {
                onError: (err) => toast(err instanceof Error ? err.message : 'Could not delete it'),
              })
            }
          >
            <Trash2 size={15} aria-hidden />
          </Button>
        )}
      </header>

      {post.session && <SessionRow session={post.session} />}

      {post.body && <p className="post-body">{post.body}</p>}
      {post.media &&
        (post.media.mime.startsWith('image/') ? (
          <PostImage post={post} />
        ) : (
          <PostVideo post={post} />
        ))}

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
          className={`post-action${open ? ' is-on' : ''}`}
          aria-expanded={open}
          aria-label={open ? 'Hide comments' : 'Comments'}
          onClick={() => setOpen((v) => !v)}
        >
          <MessageCircle size={17} aria-hidden />
          {post.comments > 0 && <span className="tabular">{post.comments}</span>}
        </button>
      </footer>
      {open && <Comments post={post} people={people} />}
    </Panel>
  );
}
