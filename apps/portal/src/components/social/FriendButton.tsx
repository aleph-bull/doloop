import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, UserMinus, UserPlus } from 'lucide-react';
import { Button, useToast } from '@komogon/ui';
import { fmtDate } from '../../lib/format';
import type { FriendshipStatus } from '../../lib/api';
import {
  useAcceptFriendRequest,
  useDeleteFriendRequest,
  useRemoveFriend,
  useSendFriendRequest,
} from '../../lib/queries';

/**
 * Where you stand with someone, as the one button that moves it on: Add friend, Requested
 * (which takes it back), Accept and Decline, or Friends with a way to remove them.
 */
export function FriendButton({
  userId,
  friendship,
  remove = false,
  acceptsRequests = true,
}: {
  userId: string;
  friendship: FriendshipStatus;
  /** Show Remove once you are friends (on their profile). */
  remove?: boolean;
  /** They take friend requests; when not, nothing is offered. */
  acceptsRequests?: boolean;
}) {
  const send = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const del = useDeleteFriendRequest();
  const unfriend = useRemoveFriend();
  const { toast } = useToast();
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not do that');
  // The Friends chip opens a small card: since when, and a remove that asks first.
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false);
        setSure(false);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSure(false);
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  switch (friendship.status) {
    case 'friends':
      if (!remove)
        return (
          <span className="chip chip-neutral">
            <Check size={13} aria-hidden /> Friends
          </span>
        );
      return (
        <span className="friend-state friend-wrap" ref={wrap}>
          <button
            type="button"
            className="chip chip-neutral friend-chip"
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => {
              setOpen((v) => !v);
              setSure(false);
            }}
          >
            <Check size={13} aria-hidden /> Friends
            <ChevronDown size={12} aria-hidden />
          </button>
          {open && (
            <span className="friend-pop" role="dialog" aria-label="Friends">
              {friendship.since && (
                <span className="friend-pop-since">
                  Friends since {fmtDate(friendship.since, { year: 'numeric' })}
                </span>
              )}
              {sure ? (
                <span className="friend-pop-sure">
                  <span>Are you sure?</span>
                  <span className="friend-pop-actions">
                    <Button
                      size="sm"
                      variant="danger"
                      loading={unfriend.isPending}
                      onClick={() =>
                        unfriend.mutate(userId, {
                          onSuccess: () => setOpen(false),
                          onError: fail,
                        })
                      }
                    >
                      Remove
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
                      Keep
                    </Button>
                  </span>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setSure(true)}>
                  <UserMinus size={14} aria-hidden /> Remove friend
                </Button>
              )}
            </span>
          )}
        </span>
      );
    case 'requested':
      return (
        <Button
          size="sm"
          variant="ghost"
          title="Take the request back"
          loading={del.isPending}
          onClick={() =>
            friendship.requestId && del.mutate(friendship.requestId, { onError: fail })
          }
        >
          Requested
        </Button>
      );
    case 'incoming':
      return (
        <span className="friend-state">
          <Button
            size="sm"
            variant="primary"
            loading={accept.isPending}
            onClick={() =>
              friendship.requestId && accept.mutate(friendship.requestId, { onError: fail })
            }
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={del.isPending}
            onClick={() =>
              friendship.requestId && del.mutate(friendship.requestId, { onError: fail })
            }
          >
            Decline
          </Button>
        </span>
      );
    default:
      if (!acceptsRequests) return <span className="chip chip-neutral">Not taking requests</span>;
      return (
        <Button
          size="sm"
          variant="secondary"
          loading={send.isPending}
          onClick={() => send.mutate(userId, { onError: fail })}
        >
          <UserPlus size={14} aria-hidden /> Add friend
        </Button>
      );
  }
}
