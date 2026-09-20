import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { archiveNode, createNode, deleteNode, listNodes, updateNode } from '../services/nodes';
import { dailyPlan, paceSnapshot, paceToJson } from '../services/pace';
import { listBlocks } from '../services/planned-blocks';
import { buildIndex, descendantIds } from '@doloop/core';
import { createNodeSchema, updateNodeSchema, uuid } from '../validation';

const idParams = z.object({ id: uuid });

export function nodeRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/nodes', async (req) => {
    const q = z.object({ archived: z.enum(['true', 'false']).optional() }).parse(req.query);
    return { nodes: await listNodes(db, req.user.id, q.archived === 'true') };
  });

  app.post('/api/nodes', async (req, reply) => {
    const body = createNodeSchema.parse(req.body);
    const node = await createNode(db, req.user.id, body, clock());
    return reply.code(201).send({ node });
  });

  app.patch('/api/nodes/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const body = updateNodeSchema.parse(req.body);
    return { node: await updateNode(db, req.user.id, id, body, clock()) };
  });

  app.post('/api/nodes/:id/archive', async (req) => {
    const { id } = idParams.parse(req.params);
    return { archivedIds: await archiveNode(db, req.user.id, id, clock()) };
  });

  app.delete('/api/nodes/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await deleteNode(db, req.user.id, id);
    return reply.code(204).send();
  });

  /** Pace for every node plus the ordered daily plan, in one call. */
  app.get('/api/pace', async (req) => {
    const now = clock();
    const snap = await paceSnapshot(db, req.user, now);
    const blocks = (await listBlocks(db, req.user.id, now)).filter((b) => !b.cancelled && b.nodeId);
    const index = buildIndex(snap.nodes);
    const planned: Record<string, number> = {};
    for (const n of snap.nodes) {
      const ids = new Set([n.id, ...descendantIds(index, n.id)]);
      planned[n.id] = blocks
        .filter((b) => ids.has(b.nodeId!))
        .reduce(
          (a, b) =>
            a + (Date.parse(b.endAt) - Math.max(Date.parse(b.startAt), Date.parse(now))) / 60_000,
          0,
        );
    }
    return {
      now,
      pace: paceToJson(snap.pace),
      plannedMinutes: planned,
      plan: await dailyPlan(db, req.user, now),
    };
  });
}
