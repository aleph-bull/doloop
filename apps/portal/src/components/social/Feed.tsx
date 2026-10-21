import { useState } from 'react';
import { Link } from 'react-router';
import { Button, EmptyState, Segmented, Spinner } from '@komogon/ui';
import type { FeedScope } from '../../lib/api';
import { useFeed } from '../../lib/queries';
import { ErrorPanel } from '../ErrorState';
import { Composer } from './Composer';
import { FriendsCard, MiniLeaderboard, ProfileCard } from './FeedSide';
import { PostCard } from './PostCard';

/**
 * The feed: you on the left, the posts in the middle, the leaderboard on the right. Narrower,
 * the sides go and the posts have the page.
 */
export function Feed() {
  const [scope, setScope] = useState<FeedScope>('everyone');
  const feed = useFeed(scope);
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];
  const people = Object.assign({}, ...(feed.data?.pages.map((p) => p.people) ?? []));

  return (
    <div className="feed-wrap">
      <div className="feed-layout">
        <div className="feed-side is-left">
          <ProfileCard />
          <FriendsCard />
        </div>
        <div className="feed">
          <Composer />
          <div className="feed-bar">
            <Segmented
              ariaLabel="Whose posts"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'everyone', label: 'Everyone' },
                { value: 'friends', label: 'Friends' },
              ]}
            />
          </div>
          {feed.isError ? (
            <ErrorPanel message="The feed could not load." onRetry={() => feed.refetch()} />
          ) : feed.isPending ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : posts.length === 0 ? (
            <EmptyState
              title={scope === 'friends' ? 'Nothing from friends yet' : 'Nothing here yet'}
              body={
                scope === 'friends' ? (
                  <>
                    Add people in the <Link to="/social?tab=friends">Friends</Link> tab, and their
                    posts show up here.
                  </>
                ) : (
                  'Share a session to start it off.'
                )
              }
            />
          ) : (
            <>
              {posts.map((p) => (
                <PostCard key={p.id} post={p} people={people} />
              ))}
              {feed.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="ghost"
                    loading={feed.isFetchingNextPage}
                    onClick={() => void feed.fetchNextPage()}
                  >
                    Show more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="feed-side is-right">
          <MiniLeaderboard />
        </div>
      </div>
    </div>
  );
}
