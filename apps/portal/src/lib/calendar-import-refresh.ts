import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { keys } from './queries';

/** A background import becomes visible without reloading the portal. */
export function useCalendarImportRefresh() {
  const qc = useQueryClient();
  const google = useQuery({
    queryKey: keys.google,
    queryFn: api.googleStatus,
    refetchInterval: 60_000,
  });
  const outlook = useQuery({
    queryKey: ['calendar', 'outlook'],
    queryFn: api.outlookStatus,
    refetchInterval: 60_000,
  });
  const googleAt = google.data?.lastSyncAt;
  const outlookAt = outlook.data?.lastSyncAt;
  const googleCheckedAt = google.dataUpdatedAt;
  const outlookCheckedAt = outlook.dataUpdatedAt;
  useEffect(() => {
    if (!googleAt && !outlookAt) return;
    for (const key of [keys.nodes, keys.pace, keys.commitments, ['blocks']])
      void qc.invalidateQueries({ queryKey: key });
  }, [qc, googleAt, outlookAt, googleCheckedAt, outlookCheckedAt]);
}
