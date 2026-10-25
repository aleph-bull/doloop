import type { FastifyInstance } from 'fastify';
import {
  badgeByKey,
  GAMBLER_FOCUS_SECONDS,
  jackTotals,
  levelProgress,
  lifetimeStats,
  personName,
  studyHeatmap,
  timeOfDayClock,
  universityById,
  weekdayProfile,
  weekStreakNumbers,
  type ClockProfile,
  type Heatmap,
  type RhythmProfile,
} from '@komogon/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { posts, userAssets, users } from '../db/schema';
import { notFound } from '../errors';
import { listAchievements } from '../services/achievements';
import { loadCompletedSessions } from '../services/pace';
import type { Person } from '../services/people';
import { nameTierOf, rollCounts } from '../services/rolls';
import { settingsOf } from '../services/users';
import { sameWorld } from '../services/dev-accounts';
import { dt } from '../services/sessions-mapper';
import { uuid } from '../validation';
import { liveAmong, type LiveMember } from './groups';
import {
  friendIds,
  friendshipWith,
  loadPosts,
  type FeedPost,
  type FriendshipStatus,
} from './social';

/** How many weeks of squares a profile shows. */
export const PROFILE_HEATMAP_WEEKS = 26;
/** The newest posts a profile returns. */
export const PROFILE_POSTS_LIMIT = 50;
/** How many badges a profile shows: the ones that paid the most XP. */
export const PROFILE_TOP_BADGES = 4;

export interface PublicProfile {
  id: string;
  /** The chosen name, or "Someone"; never an email. */
  name: string;
  /** Without the @. */
  username: string | null;
  university: { id: string; name: string; short?: string } | null;
  bio: string | null;
  /** The profile picture as a data URL, or null for the initial. */
  avatarUrl: string | null;
  joinedAt: string;
  /** This is the person asking. */
  you: boolean;
  friendCount: number;
  /** Where the person asking stands with this profile; 'none' on your own. */
  friendship: FriendshipStatus;
  /** Over 45 minutes of focus with Jack mode on: a die by the name. */
  gambler: boolean;
  /** The rarest roll on Achievements, as its tier (core rolls.ts): its title shows; 0 for none. */
  rollBest: number;
  /** The rarity the name is coloured by, or null. */
  nameTier: number | null;
  /** They take friend requests (Settings › Social). */
  acceptsRequests: boolean;
}

export interface ProfileStats {
  totalMinutes: number;
  totalSessions: number;
  /** Distinct days with a session, since joining. */
  activeDays: number;
  avgMinutesPerActiveDay: number;
  longestSessionMinutes: number;
  bestDay: { date: string; minutes: number } | null;
  last28Minutes: number;
  streak: { current: number; longest: number; weeks: { current: number; longest: number } };
  level: number;
  /** How far into the level they are, 0 to 1. The XP itself stays on Achievements. */
  levelRatio: number;
  /** Break Jack mode's slot machine gave and took, all time; null before the first spin. */
  jack: { rolls: number; wonSeconds: number; lostSeconds: number } | null;
  /** Rolls on Achievements: how many, and per rarity (index i is tier i + 1); null before the first. */
  rolls: { count: number; counts: number[] } | null;
}

export interface ProfileBadge {
  key: string;
  name: string;
  description: string;
  unlockedAt: string;
}

/** Study numbers are null when the person keeps them to themselves (Settings › Social). */
export interface ProfileResponse {
  profile: PublicProfile;
  stats: ProfileStats | null;
  heatmap: Heatmap | null;
  weekday: RhythmProfile | null;
  /** Their biggest badges by the XP each paid, biggest first; empty before the first. */
  badges: ProfileBadge[] | null;
  /** When in the day they study, all time, by the hour in their own timezone. */
  clock: ClockProfile | null;
  posts: FeedPost[];
  people: Record<string, Person>;
  /** In a session right now: shown to friends, when they let friends see it. */
  live: LiveMember | null;
}

/**
 * Profiles: the public face of an account. Anyone signed in can open anyone's, so only what
 * a person chose to share is here (name, university, bio, picture) plus study totals and
 * posts. The email, settings and tasks never leave the account.
 */
export function profileRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  const idParam = z.object({ id: z.union([z.literal('me'), uuid]) });

  app.get('/api/profiles/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const userId = id === 'me' ? req.user.id : id;
    const row =
      userId === req.user.id
        ? req.user
        : await db.query.users.findFirst({ where: eq(users.id, userId) });
    // An account that never finished onboarding has nothing to show, and no name to show it
    // under. Real people and dev accounts can't see each other.
    if (!row || row.onboardedAt === null || !sameWorld(req.user, row))
      throw notFound('No such profile');
    const now = clock();
    const settings = settingsOf(row);
    const you = row.id === req.user.id;
    const showStats = you || settings.social.stats;
    const friendship = await friendshipWith(db, req.user.id, row.id);
    // A post kept to friends shows only to the author and their friends.
    const ownCircle = you || friendship.status === 'friends';
    const [sessions, avatar, page, friends, held, rolled] = await Promise.all([
      loadCompletedSessions(db, row.id),
      db.query.userAssets.findFirst({
        where: and(eq(userAssets.userId, row.id), eq(userAssets.kind, 'avatar')),
      }),
      loadPosts(
        db,
        req.user.id,
        ownCircle
          ? eq(posts.userId, row.id)
          : and(eq(posts.userId, row.id), eq(posts.friendsOnly, false)),
        PROFILE_POSTS_LIMIT,
      ),
      friendIds(db, row.id),
      showStats ? listAchievements(db, row.id) : Promise.resolve([]),
      showStats && row.rollCount > 0 ? rollCounts(db, row.id) : Promise.resolve(null),
    ]);
    const tz = row.timezone;
    const lifetime = lifetimeStats({
      sessions,
      timezone: tz,
      now,
      joinedAt: row.createdAt.toISOString(),
    });
    const jack = jackTotals(sessions);
    const uni = universityById(settings.profile.university);
    const showPosts =
      you || friendship.status === 'friends' || settings.social.posts === 'everyone';
    const showLive = !you && friendship.status === 'friends' && settings.social.live;
    const [live = null] = showLive ? await liveAmong(db, [row.id], dt(now)) : [];
    const response: ProfileResponse = {
      profile: {
        id: row.id,
        name: personName(settings.profile.name, row.username),
        username: row.username,
        university: uni ? { id: uni.id, name: uni.name, short: uni.short } : null,
        bio: settings.profile.bio?.trim() || null,
        avatarUrl: avatar ? `data:${avatar.mime};base64,${avatar.data}` : null,
        joinedAt: row.createdAt.toISOString(),
        you,
        friendCount: friends.length,
        friendship,
        acceptsRequests: settings.social.requests,
        gambler: jack.focusSeconds > GAMBLER_FOCUS_SECONDS,
        rollBest: row.rollBest,
        nameTier: nameTierOf(row),
      },
      stats: showStats
        ? {
            totalMinutes: lifetime.totalMinutes,
            totalSessions: lifetime.totalSessions,
            activeDays: lifetime.activeDays,
            avgMinutesPerActiveDay: lifetime.avgMinutesPerActiveDay,
            longestSessionMinutes: lifetime.longestSessionMinutes,
            bestDay: lifetime.bestDay,
            last28Minutes: lifetime.last28Minutes,
            streak: {
              current: row.streak.current,
              longest: row.streak.longest,
              weeks: weekStreakNumbers(row.streak),
            },
            level: row.level,
            levelRatio: levelProgress(row.xp).ratio,
            jack:
              jack.rolls > 0
                ? { rolls: jack.rolls, wonSeconds: jack.wonSeconds, lostSeconds: jack.lostSeconds }
                : null,
            rolls: rolled ? { count: row.rollCount, counts: rolled } : null,
          }
        : null,
      heatmap: showStats
        ? studyHeatmap({
            sessions,
            timezone: tz,
            now,
            weeks: PROFILE_HEATMAP_WEEKS,
            since: row.createdAt.toISOString(),
          })
        : null,
      weekday: showStats ? weekdayProfile(sessions, tz) : null,
      badges: showStats ? topBadges(held) : null,
      clock: showStats ? timeOfDayClock(sessions, tz) : null,
      posts: showPosts ? page.posts : [],
      people: showPosts ? page.people : {},
      live,
    };
    return response;
  });
}

/**
 * The badges that paid the most XP, biggest first; between two that paid the same, the
 * newer one. A key no longer in the catalogue is skipped.
 */
export function topBadges(
  held: Array<{ key: string; unlockedAt: string }>,
  count = PROFILE_TOP_BADGES,
): ProfileBadge[] {
  return held
    .flatMap((a) => {
      const def = badgeByKey(a.key);
      return def ? [{ def, unlockedAt: a.unlockedAt }] : [];
    })
    .sort((a, b) => b.def.xp - a.def.xp || b.unlockedAt.localeCompare(a.unlockedAt))
    .slice(0, count)
    .map(({ def, unlockedAt }) => ({
      key: def.key,
      name: def.name,
      description: def.description,
      unlockedAt,
    }));
}
