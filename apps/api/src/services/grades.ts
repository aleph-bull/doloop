import {
  courseGrade,
  gpa,
  withDefaults,
  type CourseGrade,
  type GradeComponent,
  type Gpa,
  type StudyNode,
} from '@komogon/core';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { gradeComponents, type GradeComponentRow, type UserRow } from '../db/schema';
import { notFound } from '../errors';
import type { componentSchema, updateComponentSchema } from '../validation';
import type { z } from 'zod';
import { listNodes, getNodeRow } from './nodes';
import { dt } from './sessions-mapper';

export function toComponent(row: GradeComponentRow): GradeComponent {
  return {
    id: row.id,
    userId: row.userId,
    nodeId: row.nodeId,
    title: row.title,
    weight: row.weight,
    score: row.score,
    sortOrder: row.sortOrder,
  };
}

export async function listComponents(db: Db, userId: string): Promise<GradeComponent[]> {
  const rows = await db.query.gradeComponents.findMany({
    where: eq(gradeComponents.userId, userId),
    orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.createdAt)],
  });
  return rows.map(toComponent);
}

export async function createComponent(
  db: Db,
  userId: string,
  input: z.infer<typeof componentSchema>,
  now: string,
): Promise<GradeComponent> {
  // Ownership of the course is checked before anything is written under it.
  await getNodeRow(db, userId, input.nodeId);
  const siblings = await db.query.gradeComponents.findMany({
    where: and(eq(gradeComponents.userId, userId), eq(gradeComponents.nodeId, input.nodeId)),
    columns: { sortOrder: true },
  });
  const last = siblings.reduce((m, c) => Math.max(m, c.sortOrder), 0);
  const [row] = await db
    .insert(gradeComponents)
    .values({
      userId,
      nodeId: input.nodeId,
      title: input.title,
      weight: input.weight,
      score: input.score ?? null,
      sortOrder: input.sortOrder ?? last + 1,
      createdAt: dt(now),
      updatedAt: dt(now),
    })
    .returning();
  return toComponent(row!);
}

export async function updateComponent(
  db: Db,
  userId: string,
  id: string,
  patch: z.infer<typeof updateComponentSchema>,
  now: string,
): Promise<GradeComponent> {
  const existing = await db.query.gradeComponents.findFirst({
    where: and(eq(gradeComponents.id, id), eq(gradeComponents.userId, userId)),
  });
  if (!existing) throw notFound('Grade item not found');
  const [row] = await db
    .update(gradeComponents)
    .set({ ...patch, updatedAt: dt(now) })
    .where(eq(gradeComponents.id, id))
    .returning();
  return toComponent(row!);
}

export async function deleteComponent(db: Db, userId: string, id: string): Promise<void> {
  const existing = await db.query.gradeComponents.findFirst({
    where: and(eq(gradeComponents.id, id), eq(gradeComponents.userId, userId)),
  });
  if (!existing) throw notFound('Grade item not found');
  await db.delete(gradeComponents).where(eq(gradeComponents.id, id));
}

export interface GradeBook {
  courses: Array<{ node: StudyNode; grade: CourseGrade; components: GradeComponent[] }>;
  gpa: Gpa;
}

/**
 * Every course with its running grade. Only root courses are listed: a grade belongs to
 * the thing the registrar marks, not to each assignment under it.
 */
export async function gradeBook(db: Db, user: UserRow): Promise<GradeBook> {
  const [nodes, components] = await Promise.all([
    listNodes(db, user.id),
    listComponents(db, user.id),
  ]);
  const scale = withDefaults(user.settings).grading.scale;
  const byNode = new Map<string, GradeComponent[]>();
  for (const c of components) {
    const list = byNode.get(c.nodeId) ?? [];
    list.push(c);
    byNode.set(c.nodeId, list);
  }

  // Courses with grading switched off are still listed - otherwise turning grading off
  // would hide the switch that turns it back on - but they carry no grade, so the average
  // below skips them.
  const courses = nodes
    .filter((n) => n.kind === 'course' && !n.archived)
    .map((node) => {
      const own = byNode.get(node.id) ?? [];
      return { node, grade: courseGrade({ node, components: own, scale }), components: own };
    });

  return {
    courses,
    gpa: gpa({
      grades: courses.map((c) => c.grade),
      weightOf: (id) => courses.find((c) => c.node.id === id)?.node.gradeCredits ?? 1,
    }),
  };
}
