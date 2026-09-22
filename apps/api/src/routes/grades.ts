import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { createComponent, deleteComponent, gradeBook, updateComponent } from '../services/grades';
import { componentSchema, updateComponentSchema, uuid } from '../validation';

export function gradeRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  /** Every course with its running grade, plus the GPA across them. */
  app.get('/api/grades', async (req) => gradeBook(db, req.user));

  app.post('/api/grades/components', async (req, reply) => {
    const body = componentSchema.parse(req.body);
    const component = await createComponent(db, req.user.id, body, clock());
    reply.code(201);
    return { component };
  });

  app.patch('/api/grades/components/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = updateComponentSchema.parse(req.body);
    return { component: await updateComponent(db, req.user.id, id, body, clock()) };
  });

  app.delete('/api/grades/components/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await deleteComponent(db, req.user.id, id);
    reply.code(204);
  });
}
