import { Check, UserMinus, UserPlus } from 'lucide-react';
import { Button, useToast } from '@komogon/ui';
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
}: {
  userId: string;
  friendship: FriendshipStatus;
  /** Show Remove once you are friends (on their profile). */
  remove?: boolean;
}) {
  const send = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const del = useDeleteFriendRequest();
  const unfriend = useRemoveFriend();
  const { toast } = useToast();
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not do that');

  switch (friendship.status) {
    case 'friends':
      return (
        <span className="friend-state">
          <span className="chip chip-neutral">
            <Check size={13} aria-hidden /> Friends
          </span>
          {remove && (
            <Button
              size="sm"
              variant="ghost"
              loading={unfriend.isPending}
              onClick={() => unfriend.mutate(userId, { onError: fail })}
            >
              <UserMinus size={14} aria-hidden /> Remove
            </Button>
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
