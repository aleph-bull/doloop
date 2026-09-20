import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { createBlock, deleteBlock, listBlocks, updateBlock } from '../services/planned-blocks';
import { isoDateTime, plannedBlockSchema, uuid } from '../validation';

const idParams = z.object({ id: uuid });

export function plannedBlockRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/planned-blocks', async (req) => {
    const q = z
      .object({ from: isoDateTime.optional(), to: isoDateTime.optional() })
      .parse(req.query);
    return { blocks: await listBlocks(db, req.user.id, q.from, q.to) };
  });

  app.post('/api/planned-blocks', async (req, reply) => {
    const body = plannedBlockSchema.parse(req.body);
    const block = await createBlock(db, req.user.id, body, clock());
    return reply.code(201).send({ block });
  });

  app.patch('/api/planned-blocks/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const body = plannedBlockSchema
      .partial()
      .extend({ cancelled: z.boolean().optional() })
      .parse(req.body);
    return { block: await updateBlock(db, req.user.id, id, body, clock()) };
  });

  app.delete('/api/planned-blocks/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await deleteBlock(db, req.user.id, id);
    return reply.code(204).send();
  });
}
