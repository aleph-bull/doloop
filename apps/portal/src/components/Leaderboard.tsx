import { useQuery } from '@tanstack/react-query';
import { Panel, Spinner } from '@komogon/ui';
import { apiBaseUrl, authHeaders } from '../lib/api';
import { fmtHours } from '../lib/format';

interface LeaderboardEntry {
  rank: number;
  name: string;
  focusMinutes: number;
  you: boolean;
}

/** The ten people with the most focused time, by the name each chose. */
export function Leaderboard() {
  const board = useQuery({
    queryKey: ['leaderboard'],
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl(true)}/api/leaderboard`, {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(res.statusText);
      return ((await res.json()) as { entries: LeaderboardEntry[] }).entries;
    },
    staleTime: 60_000,
  });

  if (board.isPending) return <Spinner />;
  if (board.isError)
    return (
      <Panel className="p-5">
        <p>The leaderboard couldn't load. Try again in a moment.</p>
      </Panel>
    );

  return (
    <Panel className="p-5 flex flex-col gap-3">
      <p className="muted text-sm">
        The ten people with the most focused time so far. Names are the ones each person chose in
        Settings.
      </p>
      {board.data.length === 0 ? (
        <p>No finished sessions yet. Yours could be the first.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Name</th>
                <th>Focused</th>
              </tr>
            </thead>
            <tbody>
              {board.data.map((e) => (
                <tr key={e.rank} aria-current={e.you ? 'true' : undefined}>
                  <td className="tabular">{e.rank}</td>
                  <td>
                    {e.name}
                    {e.you && <span className="muted"> (you)</span>}
                  </td>
                  <td className="tabular">{fmtHours(e.focusMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
