import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { CRATE_FROM, CRATE_TICKETS, ROLL_TIERS_COUNT } from '@komogon/core';
import { z } from 'zod';
import type { Db } from '../db/client';
import { xpTransactions } from '../db/schema';
import { badRequest } from '../errors';
import { chooseOffers, inventoryOf, openOne } from '../services/crates';
import { rollCounts } from '../services/rolls';
import { addXp } from '../services/users';
import { dt } from '../services/sessions-mapper';

/**
 * Crates and the inventory (core crates.ts): the crates rolls offer, taken or let go, and
 * opened one at a time. `ticket` is injectable so tests can pick what a crate gives; it is
 * asked twice per crate, for the line of its table and for which pet.
 */
export function crateRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  ticket: () => number = () => randomInt(0, CRATE_TICKETS),
) {
  app.get('/api/inventory', async (req) => inventoryOf(db, req.user));

  /** Take the crates these offers are for (each gives up its roll), or keep the titles. */
  app.post('/api/crates/choose', async (req) => {
    const body = z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        choice: z.enum(['crate', 'title']),
      })
      .parse(req.body);
    const taken = await chooseOffers(db, req.user.id, body.ids, body.choice);
    return {
      /** The rarities that became crates. */
      taken,
      /** Rolls held per rarity afterwards (index i is tier i + 1). */
      held: await rollCounts(db, req.user.id),
      inventory: await inventoryOf(db, req.user),
    };
  });

  app.post('/api/crates/open', async (req) => {
    const { tier } = z
      .object({ tier: z.number().int().min(CRATE_FROM).max(ROLL_TIERS_COUNT) })
      .parse(req.body);
    const opened = await openOne(db, req.user.id, tier, ticket);
    if (!opened) throw badRequest('No crate to open.');
    if (opened.win.kind === 'xp') {
      const after = await addXp(db, req.user.id, opened.win.xp, { withLevel: true });
      req.user.xp = after.xp;
      req.user.xpEarned = after.xpEarned;
      req.user.level = after.level;
      await db.insert(xpTransactions).values({
        userId: req.user.id,
        at: dt(clock()),
        delta: opened.win.xp,
        kind: 'crate',
        ref: String(tier),
      });
    }
    return {
      win: opened.win,
      /** A pet they didn't have before. */
      isNew: opened.isNew,
      xp: req.user.xp,
      inventory: await inventoryOf(db, req.user),
    };
  });
}
