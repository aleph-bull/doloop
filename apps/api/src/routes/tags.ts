import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { createTag, deleteTag, listTags, updateTag } from '../services/tags';
import { createTagSchema, updateTagSchema, uuid } from '../validation';

/** The tag list for tasks. Which task has which tag is on the node (`tagIds`). */
export function tagRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/tags', async (req) => ({ tags: await listTags(db, req.user.id) }));

  app.post('/api/tags', async (req, reply) => {
    const body = createTagSchema.parse(req.body);
    const tag = await createTag(db, req.user.id, body, clock());
    return reply.code(201).send({ tag });
  });

  app.patch('/api/tags/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = updateTagSchema.parse(req.body);
    return { tag: await updateTag(db, req.user.id, id, body) };
  });

  app.delete('/api/tags/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await deleteTag(db, req.user.id, id);
    return reply.code(204).send();
  });
}
