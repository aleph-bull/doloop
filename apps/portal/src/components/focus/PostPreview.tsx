import { memo, useCallback, useDeferredValue, useState } from 'react';
import { Button, Modal, Toggle } from '@komogon/ui';
import { useAvatar, useMe } from '../../lib/queries';
import { Avatar } from '../social/Avatar';
import { CompressOffer } from '../social/CompressOffer';
import type { PostSession } from '../../lib/api';
import { SessionSide } from '../social/PostCard';

/** The longest line a post on Social takes (POST_MAX_LENGTH in the API). */
const SOCIAL_MAX = 500;

export interface PreviewVideo {
  url: string;
  blob: Blob;
}

export interface PostPreviewProps {
  open: boolean;
  video: PreviewVideo;
  /** What the post says about the session: focus, elapsed, what it was on, start and end. */
  session: PostSession | null;
  /** Biggest video a post takes; over it, compressing is offered first. */
  maxBytes: number;
  /** Post it; resolves true once it is up. */
  onShare: (
    input: { body: string; showTime: boolean; showElapsed: boolean; friendsOnly: boolean },
    blob: Blob,
  ) => Promise<boolean>;
  onClose: () => void;
}

/**
 * The post before it goes up on Social, as the feed will show it, with room to say
 * something and a switch for the time studied. Nothing is sent until Post.
 *
 * Typing stays quick: the box updates at once, and the post beside it follows a moment
 * behind (a deferred copy of the text), drawn by a memoised card that skips the rest.
 */
export function PostPreview({
  open,
  video,
  session,
  maxBytes,
  onShare,
  onClose,
}: PostPreviewProps) {
  const [text, setText] = useState('');
  const [showTime, setShowTime] = useState(true);
  const [showElapsed, setShowElapsed] = useState(false);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Over the limit: the offer to compress shows in place of the buttons. */
  const [oversize, setOversize] = useState(false);
  const shownText = useDeferredValue(text);
  const me = useMe().data?.user;
  const avatar = useAvatar().data?.dataUrl ?? null;
  const name = me?.settings.profile.name || 'You';
  // Settings › Social can keep every post to friends; then there is nothing to choose.
  const allFriends = me?.settings.social.posts === 'friends';
  const audience = allFriends || friendsOnly ? 'Friends' : 'Everyone';

  const close = useCallback(() => {
    if (busy) return;
    setOversize(false);
    onClose();
  }, [busy, onClose]);

  const share = async (blob = video.blob) => {
    if (blob.size > maxBytes) return setOversize(true);
    setOversize(false);
    setBusy(true);
    try {
      if (
        await onShare(
          { body: text.trim(), showTime, showElapsed, friendsOnly: friendsOnly || allFriends },
          blob,
        )
      ) {
        setText('');
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      persistent={busy}
      className="post-preview-dialog"
      title="Share to Social"
      actions={
        oversize ? undefined : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void share()} loading={busy}>
              Post
            </Button>
          </>
        )
      }
    >
      <div className="post-preview">
        <div className="post-preview-fields">
          <label className="field">
            <span className="field-label">Say something</span>
            <textarea
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, SOCIAL_MAX))}
              placeholder="How did it go?"
              rows={3}
              autoFocus
            />
          </label>
          {session && session.minutes > 0 && (
            <Toggle checked={showTime} onChange={setShowTime} label="Show time" />
          )}
          {session && session.minutes > 0 && showTime && session.elapsedMinutes !== null && (
            <Toggle checked={showElapsed} onChange={setShowElapsed} label="Time elapsed" />
          )}
          {!allFriends && (
            <Toggle checked={friendsOnly} onChange={setFriendsOnly} label="Friends only" />
          )}
        </div>
        <PreviewPost
          name={name}
          avatar={avatar}
          audience={audience}
          session={
            session && showTime
              ? { ...session, elapsedMinutes: showElapsed ? session.elapsedMinutes : null }
              : null
          }
          body={shownText.trim()}
          videoUrl={video.url}
        />
      </div>
      {oversize && (
        <CompressOffer
          key={video.url}
          file={video.blob}
          maxBytes={maxBytes}
          actionLabel="Compress and post"
          onDone={(blob) => void share(blob)}
          onCancel={() => setOversize(false)}
        />
      )}
    </Modal>
  );
}

/**
 * The post as the feed shows it. Memoised on plain values, so a keystroke redraws it only
 * once the deferred text has caught up, and the video element is left alone.
 */
const PreviewPost = memo(function PreviewPost({
  name,
  avatar,
  audience,
  session,
  body,
  videoUrl,
}: {
  name: string;
  avatar: string | null;
  audience: string;
  /** Null when the time is left off the post. */
  session: PostSession | null;
  body: string;
  videoUrl: string;
}) {
  return (
    <div className="post-preview-card" aria-label="How the post will look">
      <span className="post-preview-label">Preview</span>
      <article className="post post-preview-post">
        <header className="post-head">
          <Avatar name={name} url={avatar} size="sm" />
          <div className="post-who">
            <span className="post-who-line">
              <span className="post-name">{name}</span>
              <span className="chip chip-neutral">{audience}</span>
            </span>
            <span className="post-when">Just now</span>
          </div>
          <SessionSide session={session} />
          {session?.subject && <h3 className="post-title">{session.subject}</h3>}
        </header>
        {body && <p className="post-body">{body}</p>}
        {/* Still until pressed, like a post on the feed: a looping video under the box
            being typed in keeps the page repainting. */}
        <video
          className="post-preview-video"
          src={videoUrl}
          preload="metadata"
          controls
          playsInline
        />
      </article>
    </div>
  );
});
