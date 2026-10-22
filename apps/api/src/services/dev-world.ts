import { randomUUID } from 'node:crypto';
import {
  addDays,
  dayOfWeek,
  focusLabel,
  levelForXp,
  startTimer,
  toLocalDate,
  zonedTimeUtc,
  type ISODate,
  type SessionReview,
  type TimerState,
} from '@komogon/core';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  friendships,
  groupMembers,
  groups,
  jamMembers,
  jams,
  nodes,
  nudges,
  plannedBlocks,
  postComments,
  postLikes,
  posts,
  sessions,
  streakEvents,
  tags,
  users,
  xpTransactions,
} from '../db/schema';
import { newJamCode } from '../routes/jams';
import { unlockNewBadges } from './achievements';
import { devEmail, markDev, type DevWorld } from './dev-accounts';
import { ensureUser, syncStreak } from './users';

/**
 * Jerry's world, for the "I'm a dev" sign-in: Jerry has studied for sixteen weeks across
 * three courses, holds a streak, and has five friends (three accepted, one asking him, one
 * he asked) who post, give kudos and comment, share a study group and a jam with him, nudge
 * him, and two of whom are studying right now. Everything is written straight to the
 * database, in batches, as of `now`, with the same deterministic randomness every time, so
 * Jerry always looks the same apart from the dates. The settings are the app's defaults
 * apart from names and bios.
 */

const DAY = 86_400_000;
const POMODORO = { workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4 };

interface Person {
  id: string;
  name: string;
  /** Session ids by days ago, for posts. */
  sessionsByDay: Map<number, { id: string; minutes: number; subject: string; endedAt: Date }>;
  /** A task to hang a live session on. */
  liveTask: string;
}

interface Friend {
  name: string;
  bio?: string;
  /** Rough minutes on a study day, and how many of the last 56 days they studied. */
  perDay: number;
  days: number;
  joinedDaysAgo: number;
  course: string;
  tasks: string[];
}

const FRIENDS: Friend[] = [
  {
    name: 'Noah',
    perDay: 130,
    days: 46,
    joinedDaysAgo: 110,
    course: 'ECO101',
    tasks: ['Problem set 4', 'Midterm review'],
  },
  {
    name: 'Priya',
    bio: 'Library most evenings.',
    perDay: 85,
    days: 38,
    joinedDaysAgo: 95,
    course: 'PHY131',
    tasks: ['Lab report', 'Weekly reading'],
  },
  {
    name: 'Leo',
    perDay: 70,
    days: 30,
    joinedDaysAgo: 80,
    course: 'CSC108',
    tasks: ['Assignment 2'],
  },
  {
    name: 'Sofia',
    perDay: 60,
    days: 26,
    joinedDaysAgo: 60,
    course: 'BIO120',
    tasks: ['Lab report'],
  },
  {
    name: 'Ethan',
    perDay: 45,
    days: 20,
    joinedDaysAgo: 40,
    course: 'PSY100',
    tasks: ['Weekly reading'],
  },
];

/** Jerry's courses: the tasks open now, and a name for the finished ones before them. */
const COURSES = [
  {
    title: 'STATS203',
    tag: { name: 'Midterms', color: 'red' as const },
    open: [
      { title: 'Midterm 1 - Probabilities', kind: 'assessment' as const, est: 240, due: 7 },
      { title: 'Problem set 5', kind: 'task' as const, est: 180, due: 3 },
    ],
    past: (n: number) => `Problem set ${n}`,
  },
  {
    title: 'ECO220',
    tag: { name: 'Econ', color: 'green' as const },
    open: [
      { title: 'Weekly reading', kind: 'task' as const, est: 90, due: 2 },
      { title: 'Essay outline', kind: 'task' as const, est: 300, due: 12 },
    ],
    past: (n: number) => `Reading week ${n}`,
  },
  {
    title: 'CSC148',
    tag: { name: 'CS', color: 'blue' as const },
    open: [
      { title: 'Lab 6', kind: 'task' as const, est: 120, due: 4 },
      { title: 'Assignment 2', kind: 'task' as const, est: 600, due: 10 },
    ],
    past: (n: number) => `Lab ${n}`,
  },
];

/** Sixteen weeks: two-week stretches of finished work behind the current one. */
const HISTORY_DAYS = 112;
const WINDOW = 14;

export async function buildJerryWorld(
  db: Db,
  world: DevWorld,
  tz: string,
  nowIso: string,
): Promise<{ id: string; email: string }> {
  const now = new Date(nowIso);
  const today = toLocalDate(now, tz);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  /** A local time on the day `daysAgo` before today. */
  const at = (daysAgo: number, hour: number, minute = 0) =>
    zonedTimeUtc(addDays(today, -daysAgo), hour, minute, tz);

  /* ---------- people ---------- */

  const makePerson = async (
    name: string,
    bio: string | null,
    joinedDaysAgo: number,
  ): Promise<{ id: string; email: string }> => {
    const identity = { id: randomUUID(), email: devEmail() };
    await ensureUser(db, identity, tz);
    const createdAt = at(joinedDaysAgo, 12);
    await markDev(db, identity.id, world, createdAt);
    await db
      .update(users)
      .set({
        settings: { profile: { name, bio } } as never,
        onboardedAt: new Date(createdAt.getTime() + 5 * 60_000),
      })
      .where(eqId(identity.id));
    return identity;
  };

  /** Each task's course title, by task id, for what the posts say. */
  const courseOf = new Map<string, string>();

  /**
   * Finished sessions, written in batches, with their calendar records and XP. `plan` is a
   * list of [days ago, minutes, task id, task title]. Returns the sessions by day.
   */
  const writeSessions = async (
    userId: string,
    plan: Array<[number, number, string, string]>,
    calendar: boolean,
  ) => {
    const byDay = new Map<
      number,
      { id: string; minutes: number; subject: string; endedAt: Date }
    >();
    const hourOf = new Map<number, number>();
    const rows = plan.map(([daysAgo, minutes, nodeId, subject]) => {
      const pomodoro = rand() < 0.55;
      const startHour = hourOf.get(daysAgo) ?? pick([9, 10, 14, 16, 19]);
      let start = at(daysAgo, startHour, Math.floor(rand() * 40));
      const breakSeconds = pomodoro ? Math.floor(minutes / 25) * 5 * 60 : 0;
      let end = new Date(start.getTime() + minutes * 60_000 + breakSeconds * 1000);
      // Today's study is already over, so it never sits in the future.
      if (end > now) {
        end = new Date(now.getTime() - 20 * 60_000);
        start = new Date(end.getTime() - minutes * 60_000 - breakSeconds * 1000);
      }
      hourOf.set(daysAgo, startHour + Math.ceil(minutes / 60) + 1);
      const workSeconds = minutes * 60;
      const timer: TimerState = {
        mode: pomodoro ? 'pomodoro' : 'unlimited',
        phase: 'ended',
        phaseStartedAt: start.toISOString(),
        phaseEndsAt: null,
        resumePhase: null,
        resumeRemainingMs: null,
        cycle: pomodoro ? Math.floor(minutes / 25) : 0,
        workSeconds,
        breakSeconds,
        idleSeconds: 0,
        plannedEndAt: null,
        autoEnded: false,
        showTimer: true,
        endedAt: end.toISOString(),
      };
      const review: SessionReview = {
        skipped: false,
        prepared: 3 + Math.floor(rand() * 3),
        distracted: rand() < 0.7 ? 'no' : 'a-little',
        completedCount: null,
        correctCount: null,
        mood: null,
        effort: 2 + Math.floor(rand() * 3),
        extraMinutesAdded: null,
        note: null,
      };
      return {
        row: {
          id: randomUUID(),
          userId,
          nodeId,
          startedAt: start,
          endedAt: end,
          mode: timer.mode,
          workSeconds,
          breakSeconds,
          pomodoroConfigSnapshot: pomodoro ? POMODORO : null,
          review,
          // 2 XP a focused minute and 10% for the review, as a real session pays.
          xpAwarded: Math.round(minutes * 2 * 1.1),
          timer,
          lastSeenAt: end,
        },
        daysAgo,
        subject,
      };
    });
    for (const chunk of chunks(rows, 100)) {
      await db.insert(sessions).values(chunk.map((r) => r.row));
      if (calendar)
        await db.insert(plannedBlocks).values(
          chunk.map((r) => ({
            userId,
            nodeId: r.row.nodeId,
            startAt: r.row.startedAt,
            endAt: r.row.endedAt,
            source: 'session' as const,
            title: r.subject,
            sessionId: r.row.id,
            createdAt: r.row.endedAt,
            updatedAt: r.row.endedAt,
          })),
        );
      await db.insert(xpTransactions).values(
        chunk.map((r) => ({
          userId,
          at: r.row.endedAt,
          delta: r.row.xpAwarded,
          kind: 'session' as const,
          ref: r.row.id,
        })),
      );
    }
    for (const r of rows) {
      if (byDay.has(r.daysAgo)) continue;
      const course = courseOf.get(r.row.nodeId);
      byDay.set(r.daysAgo, {
        id: r.row.id,
        minutes: r.row.workSeconds / 60,
        // As a real post names it: "Course · Task".
        subject: course ? focusLabel({ subject: course, child: r.subject }) : r.subject,
        endedAt: r.row.endedAt,
      });
    }
    const xp = rows.reduce((sum, r) => sum + r.row.xpAwarded, 0);
    await db
      .update(users)
      .set({ xp, level: levelForXp(xp) })
      .where(eqId(userId));
    return byDay;
  };

  /* ---------- Jerry ---------- */

  const jerry = await makePerson(
    'Jerry',
    'Second year. Trying to keep the streak through midterms.',
    HISTORY_DAYS,
  );
  const nodeAt = (daysAgo: number) => at(daysAgo, 12);
  const tagIds: string[] = [];
  for (const c of COURSES) {
    const [t] = await db
      .insert(tags)
      .values({
        userId: jerry.id,
        name: c.tag.name,
        color: c.tag.color,
        sortOrder: tagIds.length + 1,
      })
      .returning({ id: tags.id });
    tagIds.push(t!.id);
  }
  // Each course with its open tasks, and a finished task for every two weeks before.
  const openTasks: Array<{ id: string; title: string }> = [];
  const pastTasks = new Map<number, Array<{ id: string; title: string }>>();
  const windows = Math.floor(HISTORY_DAYS / WINDOW);
  for (const [i, c] of COURSES.entries()) {
    const [course] = await db
      .insert(nodes)
      .values({
        userId: jerry.id,
        title: c.title,
        kind: 'course',
        sortOrder: i + 1,
        tagIds: [tagIds[i]!],
        createdAt: nodeAt(HISTORY_DAYS),
        updatedAt: nodeAt(HISTORY_DAYS),
      })
      .returning({ id: nodes.id });
    const open = await db
      .insert(nodes)
      .values(
        c.open.map((t, k) => ({
          userId: jerry.id,
          parentId: course!.id,
          title: t.title,
          kind: t.kind,
          estimatedMinutes: t.est,
          dueAt: at(-t.due, 23, 59),
          sortOrder: windows + k + 1,
          createdAt: nodeAt(WINDOW),
          updatedAt: nodeAt(WINDOW),
        })),
      )
      .returning({ id: nodes.id, title: nodes.title });
    openTasks.push(...open);
    for (const t of open) courseOf.set(t.id, c.title);
    for (let w = 1; w < windows; w++) {
      // Window w covers 14w to 14w+13 days ago; older windows have the lower numbers.
      const done = w * WINDOW - 1;
      const [past] = await db
        .insert(nodes)
        .values({
          userId: jerry.id,
          parentId: course!.id,
          title: c.past(windows - w),
          kind: 'task',
          dueAt: at(done, 23, 59),
          completedAt: at(done, 20),
          sortOrder: windows - w,
          createdAt: nodeAt(w * WINDOW + WINDOW - 1),
          updatedAt: at(done, 20),
        })
        .returning({ id: nodes.id, title: nodes.title });
      pastTasks.set(w, [...(pastTasks.get(w) ?? []), past!]);
      courseOf.set(past!.id, c.title);
    }
  }

  // Study days: the last five unbroken (today too once it's late enough), a gap before
  // them, a seventeen-day best run in the middle, Saturdays mostly off otherwise.
  const plan: Array<[number, number, string, string]> = [];
  const nowHour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(
      now,
    ),
  );
  for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
    const date: ISODate = addDays(today, -d);
    const recent = d >= 1 && d <= 5;
    const best = d >= 44 && d <= 60;
    let studies: boolean;
    if (d === 0) studies = nowHour >= 10;
    else if (recent || best) studies = true;
    else if (d === 6 || d === 43 || d === 61) studies = false;
    else studies = dayOfWeek(date) !== 6 && rand() > 0.15;
    if (!studies) continue;
    const w = Math.floor(d / WINDOW);
    const choices = w === 0 ? openTasks : (pastTasks.get(w) ?? openTasks);
    const total = d === 0 ? 40 : 60 + Math.floor(rand() * 80);
    const parts =
      total > 90 && rand() < 0.5 ? [Math.round(total * 0.55), Math.round(total * 0.45)] : [total];
    for (const minutes of parts) {
      const task = pick(choices);
      plan.push([d, minutes, task.id, task.title]);
    }
  }
  const jerryDays = await writeSessions(jerry.id, plan, true);
  // The finished tasks get estimates near what they took, so they read as met.
  for (const list of pastTasks.values())
    for (const t of list) {
      const spent = plan.filter((p) => p[2] === t.id).reduce((s, p) => s + p[1], 0);
      if (spent > 0)
        await db
          .update(nodes)
          .set({
            estimatedMinutes: Math.max(30, Math.round((spent * (0.85 + rand() * 0.3)) / 15) * 15),
          })
          .where(eqNode(t.id));
    }
  // Something planned on the calendar for the coming days.
  await db.insert(plannedBlocks).values(
    [1, 2, 4].map((ahead, k) => ({
      userId: jerry.id,
      nodeId: openTasks[k === 0 ? 0 : k === 1 ? 2 : 4]!.id,
      startAt: at(-ahead, 10),
      endAt: at(-ahead, 11, 30),
      source: 'app' as const,
      createdAt: now,
      updatedAt: now,
    })),
  );

  /* ---------- friends ---------- */

  const people = new Map<string, Person>();
  people.set('Jerry', {
    id: jerry.id,
    name: 'Jerry',
    sessionsByDay: jerryDays,
    liveTask: openTasks[0]!.id,
  });
  for (const f of FRIENDS) {
    const who = await makePerson(f.name, f.bio ?? null, f.joinedDaysAgo);
    const [course] = await db
      .insert(nodes)
      .values({ userId: who.id, title: f.course, kind: 'course', sortOrder: 1 })
      .returning({ id: nodes.id });
    const tasks = await db
      .insert(nodes)
      .values(
        f.tasks.map((title, k) => ({
          userId: who.id,
          parentId: course!.id,
          title,
          kind: 'task' as const,
          estimatedMinutes: 180,
          dueAt: at(-(5 + k * 2), 23, 59),
          sortOrder: k + 1,
        })),
      )
      .returning({ id: nodes.id, title: nodes.title });
    for (const t of tasks) courseOf.set(t.id, f.course);
    const fPlan: Array<[number, number, string, string]> = [];
    for (let d = Math.min(55, f.joinedDaysAgo - 1); d >= 1; d--) {
      if (rand() >= f.days / 56) continue;
      const count = rand() < 0.35 ? 2 : 1;
      for (let s = 0; s < count; s++) {
        const task = pick(tasks);
        fPlan.push([
          d,
          Math.max(25, Math.round((f.perDay / count) * (0.7 + rand() * 0.6))),
          task.id,
          task.title,
        ]);
      }
    }
    // Every friend studied on the days their posts below are about.
    for (const [name, d] of POSTS.map((p) => [p[0], p[1]] as const))
      if (name === f.name && !fPlan.some((p) => p[0] === d) && d > 0)
        fPlan.push([d, 60, tasks[0]!.id, tasks[0]!.title]);
    const byDay = await writeSessions(who.id, fPlan, false);
    people.set(f.name, { id: who.id, name: f.name, sessionsByDay: byDay, liveTask: tasks[0]!.id });
  }
  const id = (name: string) => people.get(name)!.id;

  /* ---------- friendships ---------- */

  const friendsSince = at(20, 12);
  const accepted: Array<[string, string]> = [
    ['Jerry', 'Noah'],
    ['Jerry', 'Priya'],
    ['Jerry', 'Leo'],
    ['Noah', 'Priya'],
    ['Priya', 'Leo'],
  ];
  await db.insert(friendships).values([
    ...accepted.map(([a, b]) => ({
      requesterId: id(a),
      addresseeId: id(b),
      status: 'accepted' as const,
      createdAt: friendsSince,
      respondedAt: new Date(friendsSince.getTime() + DAY),
    })),
    // Sofia is asking Jerry; Jerry asked Ethan.
    { requesterId: id('Sofia'), addresseeId: id('Jerry'), createdAt: at(1, 9) },
    { requesterId: id('Jerry'), addresseeId: id('Ethan'), createdAt: at(1, 9) },
  ]);

  /* ---------- posts, kudos, comments ---------- */

  const postIds: string[] = [];
  for (const [name, daysAgo, body] of POSTS) {
    const person = people.get(name)!;
    const session =
      person.sessionsByDay.get(daysAgo) ??
      [...person.sessionsByDay.entries()].sort((a, b) => a[0] - b[0])[0]?.[1];
    if (!session) continue;
    const createdAt = new Date(Math.min(at(daysAgo, 21, 5).getTime(), now.getTime() - 10 * 60_000));
    const [post] = await db
      .insert(posts)
      .values({
        userId: person.id,
        body,
        sessionId: session.id,
        minutes: Math.round(session.minutes),
        subject: session.subject,
        createdAt: createdAt < session.endedAt ? session.endedAt : createdAt,
      })
      .returning({ id: posts.id });
    postIds.push(post!.id);
  }
  const likers = ['Jerry', 'Noah', 'Priya', 'Leo', 'Sofia'];
  const likes = postIds.flatMap((postId) =>
    likers
      .filter(() => rand() < 0.55)
      .map((name) => ({ postId, userId: id(name), createdAt: now })),
  );
  if (likes.length) await db.insert(postLikes).values(likes).onConflictDoNothing();
  if (postIds.length >= 7)
    await db.insert(postComments).values([
      { postId: postIds[2]!, userId: id('Noah'), body: 'Nice. Same lab?', createdAt: at(3, 22) },
      {
        postId: postIds[2]!,
        userId: id('Jerry'),
        body: 'The titration one.',
        createdAt: at(3, 22, 20),
      },
      { postId: postIds[6]!, userId: id('Leo'), body: 'Good luck.', createdAt: now },
    ]);

  /* ---------- a study group, jams, a nudge ---------- */

  const [group] = await db
    .insert(groups)
    .values({ hostId: id('Noah'), name: 'Study group', code: newJamCode(), createdAt: at(20, 9) })
    .returning({ id: groups.id });
  await db.insert(groupMembers).values(
    ['Noah', 'Jerry', 'Priya', 'Leo'].map((name, k) => ({
      groupId: group!.id,
      userId: id(name),
      joinedAt: at(k === 0 ? 20 : 19, 9),
    })),
  );
  const [lab] = await db
    .insert(groups)
    .values({ hostId: id('Sofia'), name: 'Bio lab crew', code: newJamCode(), createdAt: at(10, 9) })
    .returning({ id: groups.id });
  await db
    .insert(groupMembers)
    .values({ groupId: lab!.id, userId: id('Sofia'), joinedAt: at(10, 9) });

  const jamStart = at(2, 9);
  const [push] = await db
    .insert(jams)
    .values({
      hostId: id('Noah'),
      title: 'Midterm push',
      code: newJamCode(),
      startsAt: jamStart,
      endsAt: new Date(jamStart.getTime() + 7 * DAY),
      createdAt: jamStart,
    })
    .returning({ id: jams.id });
  await db.insert(jamMembers).values([
    { jamId: push!.id, userId: id('Noah'), joinedAt: jamStart },
    { jamId: push!.id, userId: id('Jerry'), joinedAt: at(2, 10) },
    { jamId: push!.id, userId: id('Priya'), joinedAt: at(1, 20) },
  ]);
  const libraryStart = new Date(Math.min(at(0, 8).getTime(), now.getTime() - 60 * 60_000));
  const [library] = await db
    .insert(jams)
    .values({
      hostId: id('Leo'),
      title: 'Library day',
      code: newJamCode(),
      startsAt: libraryStart,
      endsAt: new Date(libraryStart.getTime() + DAY),
      createdAt: libraryStart,
    })
    .returning({ id: jams.id });
  await db
    .insert(jamMembers)
    .values({ jamId: library!.id, userId: id('Leo'), joinedAt: libraryStart });
  const readingStart = at(12, 9);
  const [reading] = await db
    .insert(jams)
    .values({
      hostId: id('Jerry'),
      title: 'Reading week',
      code: newJamCode(),
      startsAt: readingStart,
      endsAt: new Date(readingStart.getTime() + 3 * DAY),
      createdAt: readingStart,
    })
    .returning({ id: jams.id });
  await db.insert(jamMembers).values([
    { jamId: reading!.id, userId: id('Jerry'), joinedAt: readingStart },
    { jamId: reading!.id, userId: id('Noah'), joinedAt: at(12, 11) },
  ]);

  await db.insert(nudges).values({
    fromId: id('Noah'),
    toId: id('Jerry'),
    groupId: group!.id,
    at: new Date(now.getTime() - 2 * 60 * 60_000),
  });

  /* ---------- two friends studying right now ---------- */

  for (const [name, minutesAgo] of [
    ['Noah', 59],
    ['Priya', 21],
  ] as const) {
    const started = new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    await db.insert(sessions).values({
      userId: id(name),
      nodeId: people.get(name)!.liveTask,
      startedAt: new Date(started),
      mode: 'unlimited',
      timer: startTimer({ mode: 'unlimited', now: started, pomodoro: POMODORO }),
      lastSeenAt: now,
    });
  }

  // Everyone's streak judged now, as their own sign-in would (the friends never sign in,
  // and the leaderboard shows their streaks). The resets found in old history are dropped:
  // someone who has used the app for months saw those banners long ago.
  for (const person of people.values()) {
    const row = await db.query.users.findFirst({ where: eqId(person.id) });
    if (row) await syncStreak(db, row, nowIso);
  }
  await db.delete(streakEvents).where(
    inArray(
      streakEvents.userId,
      [...people.values()].map((p) => p.id),
    ),
  );
  // Badges earned on the way, paid like any others.
  const jerryRow = await db.query.users.findFirst({ where: eqId(jerry.id) });
  if (jerryRow) await unlockNewBadges(db, jerryRow, nowIso);
  return jerry;
}

/** [who, days ago, what they said] for the feed, oldest first. */
const POSTS: Array<[string, number, string]> = [
  ['Noah', 6, 'Econ problem set done before dinner for once.'],
  ['Priya', 5, 'Two hours in the library. The last chapter finally makes sense.'],
  ['Jerry', 4, 'Lab report in a day early. Took the evening off and the streak held.'],
  ['Leo', 3, 'Short one today, but a day is a day.'],
  ['Sofia', 2, ''],
  ['Priya', 1, 'Midterm week. Mornings only until Friday.'],
  ['Jerry', 1, 'Review starts now. Two hours a day until the midterm.'],
];

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const eqId = (userId: string) => eq(users.id, userId);
const eqNode = (nodeId: string) => eq(nodes.id, nodeId);
