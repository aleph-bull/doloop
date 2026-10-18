import type { FastifyInstance } from 'fastify';
import {
  addDays,
  buildIndex,
  consistency,
  cumulativeHours,
  dailyBySubject,
  dashboardStats,
  focusQuality,
  getHighlights,
  hoursForecast,
  levelProgress,
  personalRecords,
  planKept,
  rangeRecap,
  sessionHistogram,
  startOfWeekMonday,
  studyHeatmap,
  studyPersonality,
  studyVsGrades,
  subjectBreakdown,
  timeOfDayClock,
  toLocalDate,
  weekdayProfile,
  type HighlightKey,
  type StudyNode,
  type SubjectSlice,
} from '@komogon/core';
import { z } from 'zod';
import type { Db } from '../db/client';
import { gradeBook } from '../services/grades';
import { listNodes } from '../services/nodes';
import { loadCompletedSessions, paceContext } from '../services/pace';
import { listBlocks } from '../services/planned-blocks';
import { routineTickDates } from '../services/routines';
import { screenFacts, type FetchLike, type TmdbCredentials } from '../services/tmdb';
import { settingsOf, syncStreak } from '../services/users';

/**
 * The highlight cards the charts already say, left out of the smart insights so the page
 * never states the same thing twice.
 */
const SHOWN_BY_CHARTS: ReadonlySet<HighlightKey> = new Set([
  'hours-total',
  'hours-up',
  'best-week',
  'best-day',
  'streak',
  'planned-kept',
  'sessions-up',
]);

/** Categorical slots, by the order courses sit in the task tree; see `colorIndex`. */
const SLOTS = 5;

/**
 * A slice's colour slot follows the course, not its rank this week: a course keeps its
 * colour whichever range is showing. The fixed order is the task tree's, and time with no
 * course (free sessions, routines, the folded tail) is the neutral -1.
 */
function withColorIndex(slices: SubjectSlice[], roots: StudyNode[]) {
  const order = new Map(roots.map((r, i) => [r.id, i]));
  return slices.map((s) => {
    const i = order.get(s.key);
    return { ...s, colorIndex: i === undefined ? -1 : i % SLOTS };
  });
}

export function recapRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  tmdb: TmdbCredentials | null = null,
  fetchFn?: FetchLike,
) {
  /** The numbers behind the dashboard's stat strip. */
  app.get('/api/analytics/dashboard', async (req) => {
    const now = clock();
    const [sessions, streak] = await Promise.all([
      loadCompletedSessions(db, req.user.id),
      syncStreak(db, req.user, now),
    ]);
    const settings = settingsOf(req.user);
    const stats = dashboardStats({
      sessions,
      timezone: req.user.timezone,
      now,
      goalMinutes: settings.goals.weeklyMinutes,
      streak: streak.streak,
    });
    return { ...stats, now };
  });

  /**
   * Everything the Analytics page draws for a week, a month, or all time. One call, so the
   * page can hold its previous render while a range change loads rather than flashing.
   */
  app.get('/api/analytics/recap', async (req) => {
    const now = clock();
    const { range } = z
      .object({ range: z.enum(['week', 'month', 'all']).default('week') })
      .parse(req.query);
    const tz = req.user.timezone;
    const settings = settingsOf(req.user);
    const [sessions, nodes, blocks, streakSync, ctx, grades, routineTicks] = await Promise.all([
      loadCompletedSessions(db, req.user.id),
      listNodes(db, req.user.id, true),
      listBlocks(db, req.user.id),
      syncStreak(db, req.user, now),
      paceContext(db, req.user, now),
      gradeBook(db, req.user),
      routineTickDates(db, req.user.id),
    ]);
    const streak = streakSync.streak;
    const today = toLocalDate(now, tz);
    const weekStart = startOfWeekMonday(today);
    const live = nodes.filter((n) => !n.archived);
    const roots = buildIndex(live).roots;

    const period =
      range === 'all'
        ? null
        : rangeRecap({
            sessions,
            timezone: tz,
            now,
            range,
            goalMinutes: settings.goals.weeklyMinutes,
          });
    const from = period?.from;
    const to = period?.to;
    const inRange = from
      ? sessions.filter((s) => {
          const d = toLocalDate(s.startedAt, tz);
          return d >= from && d <= to!;
        })
      : sessions;

    const subjects = withColorIndex(
      subjectBreakdown({ nodes, sessions, timezone: tz, from, to, limit: 5 }),
      roots,
    );
    const cumulative = cumulativeHours(sessions, tz);
    const last28 = sessions
      .filter((s) => toLocalDate(s.startedAt, tz) >= addDays(today, -27))
      .reduce((a, s) => a + s.workSeconds / 60, 0);

    // Smart insights: the highlight engine's cards the charts do not already make.
    const highlights = getHighlights({
      nodes: live,
      sessions,
      plannedBlocks: blocks,
      streak,
      timezone: tz,
      policy: ctx.policy,
      maxComfortableMinutesPerDay: settings.pace.maxComfortableMinutesPerDay,
      now,
      weekStart,
    }).highlights.filter((h) => !SHOWN_BY_CHARTS.has(h.key));

    const gradedCourses = grades.courses
      .filter((c) => c.grade.percent !== null)
      .map((c) => ({
        nodeId: c.node.id,
        title: c.node.title,
        percent: c.grade.percent!,
        minutes: subjects.find((s) => s.key === c.node.id)?.minutes ?? 0,
      }));
    // Study against grades reads every minute on a course, whatever range is showing.
    const allTimeByCourse = subjectBreakdown({ nodes, sessions, timezone: tz, limit: 999 });
    for (const g of gradedCourses)
      g.minutes = allTimeByCourse.find((s) => s.key === g.nodeId)?.minutes ?? 0;

    return {
      now,
      range,
      period,
      subjects,
      dailySubjects:
        period && range === 'week'
          ? dailyBySubject({
              nodes,
              sessions,
              timezone: tz,
              from: period.from,
              to: period.to,
              limit: 5,
            })
          : null,
      clock: timeOfDayClock(inRange, tz),
      weekday: weekdayProfile(inRange, tz),
      histogram: sessionHistogram(inRange),
      focus: focusQuality(inRange),
      plan: period ? planKept(blocks, sessions, period.from, period.to, tz, now) : null,
      cumulative,
      heatmap: range === 'all' ? studyHeatmap({ sessions, timezone: tz, now, weeks: 26 }) : null,
      consistency: consistency({
        sessions,
        timezone: tz,
        now,
        minMinutes: settings.streak.minMinutes,
        streak,
      }),
      streak: { current: streak.current, longest: streak.longest, freezesHeld: streak.freezesHeld },
      records: personalRecords({
        sessions,
        nodes,
        timezone: tz,
        now,
        weekStart,
        streak,
        routineTicks,
      }),
      personality: studyPersonality({ sessions, timezone: tz, now }),
      forecast: hoursForecast({
        totalMinutes: cumulative.totalMinutes,
        last28Minutes: last28,
        now,
        timezone: tz,
      }),
      studyVsGrades: studyVsGrades(gradedCourses),
      insights: highlights.slice(0, 3),
      level: { xp: req.user.xp, ...levelProgress(req.user.xp) },
      totals: {
        minutes: cumulative.totalMinutes,
        sessions: sessions.length,
        rangeMinutes: inRange.reduce((a, s) => a + s.workSeconds / 60, 0),
        rangeSessions: inRange.length,
      },
    };
  });

  /** Film and TV facts for the equivalents strip. Public data, cached on both sides. */
  app.get('/api/equivalents/screens', async () => screenFacts(tmdb, fetchFn));
}
