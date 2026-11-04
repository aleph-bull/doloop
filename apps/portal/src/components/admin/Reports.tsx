import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Button, Input, Panel, Spinner, useToast } from '@komogon/ui';
import { adminKeys, adminSend, type AdminPost } from '../../lib/admin';
import type { Person } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useDeletePost } from '../../lib/queries';
import { PostCard } from '../social/PostCard';

type Found = { posts: AdminPost[]; people: Record<string, Person> };

/**
 * Reported posts (2026-11-03): each one beside who reported it and why, with Delete post and
 * Dismiss (keep it, drop the reports). Any post can be looked up by its ID, the number a
 * report email names; the email links here with `?post=<ID>`, which shows that one first.
 */
export function Reports() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('post')?.trim() || null;
  const [key, setKey] = useState(asked ?? '');
  const reports = useQuery({
    queryKey: adminKeys.reports,
    queryFn: () => adminSend<Found>('GET', '/api/admin/reports'),
  });
  const found = useQuery({
    queryKey: adminKeys.post(asked ?? ''),
    queryFn: () =>
      adminSend<{ post: AdminPost; people: Record<string, Person> }>(
        'GET',
        `/api/admin/posts/${encodeURIComponent(asked!)}`,
      ),
    enabled: asked !== null,
    retry: false,
  });

  const look = (next: string) => {
    const p = new URLSearchParams(params);
    if (next.trim()) p.set('post', next.trim().replace(/^#/, ''));
    else p.delete('post');
    setParams(p, { replace: true });
  };

  const listed = (reports.data?.posts ?? []).filter((r) => r.post.id !== found.data?.post.post.id);
  const people = { ...reports.data?.people, ...found.data?.people };

  return (
    <section className="flex flex-col gap-4" aria-label="Reports">
      <Panel className="p-5 flex flex-col gap-3">
        <div className="admin-tool">
          <h2 className="section-title">Reports</h2>
          <form
            className="admin-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              look(key);
            }}
          >
            <Input
              placeholder="Post ID"
              aria-label="Post ID"
              inputMode="numeric"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button type="submit">Find</Button>
          </form>
        </div>
        {asked && found.isError && <p className="muted text-sm">No post with ID {asked}.</p>}
        {reports.isPending ? (
          <Spinner />
        ) : (
          reports.data?.posts.length === 0 && <p className="muted text-sm">No reports</p>
        )}
      </Panel>
      {asked && found.isPending && <Spinner />}
      {found.data && (
        <ReportedPost
          item={found.data.post}
          people={people}
          onGone={() => {
            setKey('');
            look('');
          }}
        />
      )}
      {listed.map((item) => (
        <ReportedPost key={item.post.id} item={item} people={people} />
      ))}
    </section>
  );
}

/** One post, and beside it its ID, its author and its reports, with what to do about it. */
function ReportedPost({
  item,
  people,
  onGone,
}: {
  item: AdminPost;
  people: Record<string, Person>;
  onGone?: () => void;
}) {
  const qc = useQueryClient();
  const del = useDeletePost();
  const { toast } = useToast();
  const [sure, setSure] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const { post, reports } = item;
  const author = people[post.userId];

  const remove = () =>
    del.mutate(post.id, {
      onSuccess: () => {
        toast(`Post ${post.ref} deleted`);
        onGone?.();
      },
      onError: (err) => toast(err instanceof Error ? err.message : 'Could not delete it'),
    });

  const dismiss = async () => {
    setDismissing(true);
    try {
      await adminSend('DELETE', `/api/admin/posts/${post.id}/reports`);
      toast('Reports dismissed');
      await Promise.all([
        qc.invalidateQueries({ queryKey: adminKeys.reports }),
        qc.invalidateQueries({ queryKey: ['admin', 'post'] }),
      ]);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not dismiss it');
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className="admin-report">
      <PostCard post={post} people={people} />
      <Panel className="p-5 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-medium tabular">ID {post.ref}</p>
          <p className="muted text-sm admin-list-main">
            {author?.name ?? 'Someone'}
            {author?.username && ` @${author.username}`}
            {item.authorEmail && ` · ${item.authorEmail}`}
          </p>
        </div>
        {reports.length > 0 ? (
          <ul className="admin-list">
            {reports.map((r) => {
              const by = people[r.reporterId];
              return (
                <li key={r.id}>
                  <span className="admin-list-main">{r.reason || 'No reason given'}</span>
                  <span className="muted text-sm">
                    {by?.name ?? 'Someone'}
                    {r.reporterEmail && ` · ${r.reporterEmail}`} · {fmtDate(r.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted text-sm">Not reported.</p>
        )}
        {sure ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Are you sure?</span>
            <Button size="sm" variant="danger" loading={del.isPending} onClick={remove}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => setSure(true)}>
              Delete post
            </Button>
            {reports.length > 0 && (
              <Button size="sm" variant="ghost" loading={dismissing} onClick={() => void dismiss()}>
                Dismiss
              </Button>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
