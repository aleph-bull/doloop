import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  pushBlockCreated,
  pushBlockDeleted,
  pushBlockUpdated,
  type CalendarDeps,
} from '../services/calendar-sync';
import {
  createBlock,
  deleteBlock,
  getBlockRow,
  listBlocks,
  updateBlock,
} from '../services/planned-blocks';
import { isoDateTime, plannedBlockSchema, uuid } from '../validation';
import { toPlannedBlock } from '../services/sessions-mapper';

const idParams = z.object({ id: uuid });

export function plannedBlockRoutes(
  app: FastifyInstance,
  db: Db,
  clock: () => string,
  calendar: CalendarDeps | null = null,
) {
  app.get('/api/planned-blocks', async (req) => {
    const q = z
      .object({ from: isoDateTime.optional(), to: isoDateTime.optional() })
      .parse(req.query);
    return { blocks: await listBlocks(db, req.user.id, q.from, q.to) };
  });

  app.post('/api/planned-blocks', async (req, reply) => {
    const body = plannedBlockSchema.parse(req.body);
    const block = await createBlock(db, req.user.id, body, clock());
    await pushBlockCreated(db, calendar, await getBlockRow(db, req.user.id, block.id));
    return reply
      .code(201)
      .send({ block: toPlannedBlock(await getBlockRow(db, req.user.id, block.id)) });
  });

  app.patch('/api/planned-blocks/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const body = plannedBlockSchema
      .partial()
      .extend({ cancelled: z.boolean().optional() })
      .parse(req.body);
    const block = await updateBlock(db, req.user.id, id, body, clock());
    await pushBlockUpdated(db, calendar, await getBlockRow(db, req.user.id, block.id));
    return { block };
  });

  app.delete('/api/planned-blocks/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const row = await getBlockRow(db, req.user.id, id);
    await deleteBlock(db, req.user.id, id);
    await pushBlockDeleted(db, calendar, row);
    return reply.code(204).send();
  });
}
