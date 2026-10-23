import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { Bell, BellRing, MessageCircle, ThumbsUp } from 'lucide-react';
import { Modal, Spinner } from '@komogon/ui';
import type { NotificationPost, Person, SocialNotification } from '../../lib/api';
import { fmtAgo, fmtMinutes } from '../../lib/format';
import { useNotifications, useNotificationsSeen } from '../../lib/queries';
import { Avatar } from './Avatar';

const someone = (id: string): Person => ({
  id,
  name: 'Someone',
  username: null,
  avatarUrl: null,
  university: null,
});

const DAY_MS = 24 * 60 * 60_000;

/** Today, Yesterday, This week, Earlier: the headings the list is split under. */
function sectionOf(iso: string, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = Date.parse(iso);
  if (at >= today) return 'Today';
  if (at >= today - DAY_MS) return 'Yesterday';
  if (at >= today - 6 * DAY_MS) return 'This week';
  return 'Earlier';
}

/** Which post it was, in a few words: what it was on, else what it said. */
function postLabel(post: NotificationPost | undefined): string {
  if (!post) return 'Your post';
  if (post.subject) return post.subject;
  const body = post.body.trim();
  if (body) return body.length > 40 ? `${body.slice(0, 40).trimEnd()}…` : body;
  return post.minutes !== null ? `${fmtMinutes(post.minutes)} of focus` : 'Your post';
}

const KIND_ICON = { kudos: ThumbsUp, comment: MessageCircle, nudge: BellRing } as const;

/** One line: who, what they did, which post and when, with the post's picture at the end. */
function Row({
  n,
  person,
  post,
  onGo,
}: {
  n: SocialNotification;
  person: Person;
  post: NotificationPost | undefined;
  onGo: () => void;
}) {
  const Icon = KIND_ICON[n.kind];
  const to =
    n.kind === 'nudge'
      ? `/profile/${n.fromId}`
      : `/profile#post-${n.postId}${n.kind === 'comment' ? '-comments' : ''}`;
  return (
    <li>
      <Link to={to} className={`notif-row${n.unread ? ' is-new' : ''}`} onClick={onGo}>
        <span className="notif-who">
          <Avatar name={person.name} url={person.avatarUrl} size="xs" />
          <span className={`notif-kind is-${n.kind}`} aria-hidden>
            <Icon size={10} strokeWidth={2.5} />
          </span>
        </span>
        <span className="notif-text">
          <span className="notif-line">
            <strong>{person.name}</strong>{' '}
            {n.kind === 'kudos'
              ? 'gave you kudos'
              : n.kind === 'comment'
                ? `commented: ${n.comment ?? ''}`
                : 'nudged you'}
          </span>
          <span className="notif-meta">
            {n.kind === 'nudge' ? n.groupName : postLabel(post)}
            {(n.kind !== 'nudge' || n.groupName) && ' · '}
            {fmtAgo(n.at)}
            {n.unread && <span className="notif-dot" aria-label="New" />}
          </span>
        </span>
        {n.kind !== 'nudge' &&
          (post?.poster ? (
            <img className="notif-thumb" src={post.poster} alt="" />
          ) : (
            <span className="notif-thumb is-plain tabular" aria-hidden>
              {post?.minutes != null && (
                <>
                  {fmtMinutes(post.minutes)}
                  <small>focus</small>
                </>
              )}
            </span>
          ))}
      </Link>
    </li>
  );
}

/**
 * The bell beside the streak and level on your card: how many things are new, and the list
 * behind it, laid out like BeReal's notifications (picture, who and what, when, the post on
 * the right, under Today, Yesterday, This week and Earlier). Opening it makes them seen.
 * On a phone it is a round button at the top of Social instead (`round`).
 */
export function NotificationsBell({ round }: { round?: boolean }) {
  const q = useNotifications();
  const seen = useNotificationsSeen();
  const [open, setOpen] = useState(false);
  const unread = q.data?.unread ?? 0;

  const show = () => {
    setOpen(true);
    if (unread > 0) seen.mutate();
  };

  const now = new Date();
  const sections: Array<{ title: string; items: SocialNotification[] }> = [];
  for (const n of q.data?.notifications ?? []) {
    const title = sectionOf(n.at, now);
    const last = sections[sections.length - 1];
    if (last?.title === title) last.items.push(n);
    else sections.push({ title, items: [n] });
  }

  return (
    <>
      {round ? (
        <button
          type="button"
          className="social-top-btn"
          aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
          aria-haspopup="dialog"
          onClick={show}
        >
          <Bell size={20} aria-hidden />
          {unread > 0 && <span className="social-top-dot" />}
        </button>
      ) : (
        <button
          type="button"
          className="side-bell"
          aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
          aria-haspopup="dialog"
          onClick={show}
        >
          <span className="side-bell-icon">
            <Bell size={16} aria-hidden />
            {unread > 0 && <span className="side-bell-dot" />}
          </span>
          <span className="tabular">{unread}</span>
          <span className="side-stat-label">new</span>
        </button>
      )}
      {/* On the body: inside the figures' row it would take on their bold, centred text. */}
      {createPortal(
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Notifications"
          phone="full"
          initialFocus="dialog"
          className="notif-dialog"
        >
          {q.isPending ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : sections.length === 0 ? (
            <p className="muted text-sm notif-empty">Nothing yet.</p>
          ) : (
            <div className="notif-list">
              {sections.map((s) => (
                <section key={s.title} aria-label={s.title}>
                  <h3 className="notif-section">{s.title}</h3>
                  <ul>
                    {s.items.map((n) => (
                      <Row
                        key={n.id}
                        n={n}
                        person={q.data!.people[n.fromId] ?? someone(n.fromId)}
                        post={n.postId ? q.data!.posts[n.postId] : undefined}
                        onGo={() => setOpen(false)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Modal>,
        document.body,
      )}
    </>
  );
}
