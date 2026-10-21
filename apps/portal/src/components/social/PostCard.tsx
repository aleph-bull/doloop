import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Heart, MessageCircle, Play, Timer, Trash2, X } from 'lucide-react';
import { Button, Panel, Spinner, useToast } from '@komogon/ui';
import { api, type FeedPost, type Person } from '../../lib/api';
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
function figure(minutes: number): { value: string; unit: string } {
  if (minutes < 60) return { value: String(Math.max(1, Math.round(minutes))), unit: 'min' };
  const h = minutes / 60;
  return { value: String(h >= 100 ? Math.round(h) : Math.round(h * 10) / 10), unit: 'h' };
}

/** The poster until it is asked to play; then the video, fetched with the token. */
function PostVideo({ post }: { post: FeedPost }) {
  const [playing, setPlaying] = useState(false);
  const media = useQuery({
    queryKey: ['social', 'media', post.id],
    queryFn: () => api.postMedia(post.id),
    enabled: playing,
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!media.data) return;
    const next = URL.createObjectURL(media.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [media.data]);

  if (playing && url)
    return <video className="post-video" src={url} controls autoPlay loop playsInline />;
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
      {media.isError && <span className="post-video-error">Could not load the video.</span>}
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
export function PostCard({ post, people }: { post: FeedPost; people: Record<string, Person> }) {
  const author = people[post.userId] ?? unknown(post.userId);
  const like = useLikePost();
  const del = useDeletePost();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const fig = post.session ? figure(post.session.minutes) : null;

  return (
    <Panel as="article" className="post">
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

      {post.session && fig && (
        <div className="post-session">
          <Timer size={18} aria-hidden className="post-session-icon" />
          <span className="post-session-figure tabular">
            {fig.value}
            <small>{fig.unit}</small>
          </span>
          {post.session.subject && (
            <span className="post-session-subject">on {post.session.subject}</span>
          )}
        </div>
      )}

      {post.body && <p className="post-body">{post.body}</p>}
      {post.media && <PostVideo post={post} />}

      <footer className="post-foot">
        <button
          type="button"
          className={`post-action${post.liked ? ' is-on' : ''}`}
          aria-pressed={post.liked}
          aria-label={post.liked ? 'Unlike' : 'Like'}
          onClick={() => like.mutate({ id: post.id, liked: post.liked })}
        >
          <Heart size={17} aria-hidden fill={post.liked ? 'currentColor' : 'none'} />
          {post.likes > 0 && <span className="tabular">{post.likes}</span>}
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
