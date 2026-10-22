import {
  POST_PLATFORM_INFO,
  postCaption,
  postElsewhereNote,
  sessionLine,
  type PostPlatform,
} from '@komogon/core';
import { Timer } from 'lucide-react';
import { useState } from 'react';
import { Button, Modal, Toggle } from '@komogon/ui';
import { useAvatar, useMe } from '../../lib/queries';
import { PlatformMark } from '../PlatformMark';
import { Avatar } from '../social/Avatar';
import { CompressOffer } from '../social/CompressOffer';
import { figure } from '../social/PostCard';

/** Where the video is going: Komodon's own feed, or one of the other sites. */
export type PostTarget = 'social' | PostPlatform;

/** The longest line a post on Social takes (POST_MAX_LENGTH in the API). */
const SOCIAL_MAX = 500;

export interface PreviewVideo {
  url: string;
  blob: Blob;
  mime: string;
  /** Its length as the player reads it, or as planned. */
  seconds: number;
}

export interface PostPreviewProps {
  /** The preview open, and where to; null while closed. */
  target: PostTarget | null;
  video: PreviewVideo;
  /** What the post says about the session: its focused minutes and what it was on. */
  session: { minutes: number; subject: string | null } | null;
  /** The phone's share menu carries the video to the apps (the button's words change). */
  shareSheet: boolean;
  /** Biggest video a post on Social takes; over it, compressing is offered first. */
  maxBytes: number;
  /** Post on Social; resolves true once it is up. */
  onShare: (input: { body: string; showTime: boolean }, blob: Blob) => Promise<boolean>;
  /** Hand the video and its caption to another site. */
  onPostTo: (platform: PostPlatform, caption: string) => void;
  onClose: () => void;
}

/**
 * The post before it goes out: on Social, the post as the feed will show it, with room to
 * say something and a switch for the time studied; elsewhere, the video with the caption
 * that goes with it. Nothing is sent until the last button.
 */
export function PostPreview({
  target,
  video,
  session,
  shareSheet,
  maxBytes,
  onShare,
  onPostTo,
  onClose,
}: PostPreviewProps) {
  const [text, setText] = useState('');
  const [showTime, setShowTime] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Over Social's limit: the offer to compress shows in place of the buttons. */
  const [oversize, setOversize] = useState(false);
  // The last place asked for stays drawn while the dialog fades out.
  const [shown, setShown] = useState<PostTarget>(target ?? 'social');
  if (target && target !== shown) setShown(target);
  const me = useMe().data?.user;
  const avatar = useAvatar().data?.dataUrl ?? null;
  const name = me?.settings.profile.name || 'You';
  const audience = me?.settings.social.posts === 'friends' ? 'Friends' : 'Everyone';

  const close = () => {
    if (busy) return;
    setOversize(false);
    onClose();
  };

  const social = shown === 'social';
  const site = shown === 'social' ? null : POST_PLATFORM_INFO[shown];
  const caption = postCaption({ text, session, showTime });
  const fig = session && showTime ? figure(session.minutes) : null;
  const note = social ? null : postElsewhereNote({ seconds: video.seconds, mime: video.mime });
  const tooLong = site?.captionMax !== undefined && caption.length > site.captionMax;

  const share = async (blob = video.blob) => {
    if (blob.size > maxBytes) return setOversize(true);
    setOversize(false);
    setBusy(true);
    try {
      if (await onShare({ body: text.trim(), showTime }, blob)) {
        setText('');
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={target !== null}
      onClose={close}
      persistent={busy}
      className="post-preview-dialog"
      title={social ? 'Share to Social' : `Post it on ${site!.name}`}
      actions={
        oversize ? undefined : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            {social ? (
              <Button variant="primary" onClick={() => void share()} loading={busy}>
                Post
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  onPostTo(shown, caption);
                  onClose();
                }}
              >
                <PlatformMark platform={shown} />{' '}
                {shareSheet ? 'Open the share menu' : `Post on ${site!.name}`}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="post-preview">
        <div className="post-preview-fields">
          <label className="field">
            <span className="field-label">{social ? 'Say something' : 'Caption'}</span>
            <textarea
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, SOCIAL_MAX))}
              placeholder={social ? 'How did it go?' : 'What do you want to say with it?'}
              rows={3}
              autoFocus
            />
          </label>
          {session && session.minutes > 0 && (
            <Toggle
              checked={showTime}
              onChange={setShowTime}
              label="Show how long I studied"
              description={sessionLine(session.minutes, session.subject)}
            />
          )}
          <p className="field-hint">
            {social
              ? audience === 'Friends'
                ? 'Your friends see it on the feed and your profile.'
                : 'Everyone signed in sees it on the feed and your profile.'
              : shareSheet
                ? 'Your phone’s share menu opens with the video and the caption. Pick the app there. The caption is copied too, in case the app leaves it out.'
                : site!.withCaption
                  ? `The video downloads and ${site!.name} opens in a new tab with the caption written in.`
                  : `The video downloads, ${site!.name} opens in a new tab, and the caption is copied to paste there.`}
          </p>
          {tooLong && (
            <p className="field-hint timelapse-size-warn" role="status">
              {site!.name} takes up to {site!.captionMax} characters; this is {caption.length}.
            </p>
          )}
          {note && (
            <p className="field-hint timelapse-size-warn" role="status">
              {note}
            </p>
          )}
        </div>

        <div className="post-preview-card" aria-label="How the post will look">
          <span className="post-preview-label">Preview</span>
          {social ? (
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
              </header>
              {fig && (
                <div className="post-session">
                  <Timer size={18} aria-hidden className="post-session-icon" />
                  <span className="post-session-figure tabular">
                    {fig.value}
                    <small>{fig.unit}</small>
                  </span>
                  {session?.subject && (
                    <span className="post-session-subject">on {session.subject}</span>
                  )}
                </div>
              )}
              {text.trim() && <p className="post-body">{text.trim()}</p>}
              <PreviewVideoPlayer url={video.url} />
            </article>
          ) : (
            <div className="post post-preview-post">
              <PreviewVideoPlayer url={video.url} />
              {caption ? (
                <p className="post-body">{caption}</p>
              ) : (
                <p className="muted text-sm">No caption.</p>
              )}
            </div>
          )}
        </div>
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

/** The made video, playing quietly on a loop, at its own shape. */
function PreviewVideoPlayer({ url }: { url: string }) {
  return (
    <video className="post-preview-video" src={url} autoPlay muted loop playsInline controls />
  );
}
