import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-10-21T18:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' });
  await t.api({ method: 'GET', url: '/api/me', token: t.tokenB });
});
afterAll(() => t.close());

const newTag = (name: string, color?: string, token?: string) =>
  t.api({ method: 'POST', url: '/api/tags', payload: { name, color }, token });

describe('tags', () => {
  let econ: string;
  let career: string;
  let course: string;

  it('makes tags, each new one in the next unused colour', async () => {
    const a = await newTag('Econ');
    expect(a.statusCode).toBe(201);
    expect(a.json().tag).toMatchObject({ name: 'Econ', color: 'red' });
    econ = a.json().tag.id;
    const b = await newTag('Career', 'blue');
    expect(b.json().tag.color).toBe('blue');
    career = b.json().tag.id;
    expect((await newTag('Third')).json().tag.color).toBe('orange');
    const list = (await t.api({ method: 'GET', url: '/api/tags' })).json().tags;
    expect(list.map((x: { name: string }) => x.name)).toEqual(['Econ', 'Career', 'Third']);
  });

  it('refuses a name already used, whatever the case', async () => {
    const res = await newTag('econ');
    expect(res.statusCode).toBe(400);
    expect(res.json().message ?? res.json().error).toMatch(/already a tag called Econ/);
    // Someone else can have their own Econ.
    expect((await newTag('Econ', undefined, t.tokenB)).statusCode).toBe(201);
  });

  it('puts tags on a task, in order, each once', async () => {
    course = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'ECO220', kind: 'course', tagIds: [career] },
      })
    ).json().node.id;
    const res = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${course}`,
      payload: { tagIds: [econ, career, econ] },
    });
    expect(res.json().node.tagIds).toEqual([econ, career]);
    const plain = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Plain' } })
    ).json().node;
    expect(plain.tagIds).toEqual([]);
  });

  it("won't take a tag that isn't yours", async () => {
    const theirs = (await newTag('Mine only', undefined, t.tokenB)).json().tag.id;
    const res = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${course}`,
      payload: { tagIds: [theirs] },
    });
    expect(res.statusCode).toBe(400);
    const edit = await t.api({
      method: 'PATCH',
      url: `/api/tags/${econ}`,
      payload: { name: 'Hijacked' },
      token: t.tokenB,
    });
    expect(edit.statusCode).toBe(404);
  });

  it('renames and recolours', async () => {
    const res = await t.api({
      method: 'PATCH',
      url: `/api/tags/${econ}`,
      payload: { name: 'Economics', color: 'green' },
    });
    expect(res.json().tag).toMatchObject({ name: 'Economics', color: 'green' });
    const bad = await t.api({
      method: 'PATCH',
      url: `/api/tags/${econ}`,
      payload: { color: 'teal' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('deleting a tag takes it off every task', async () => {
    expect((await t.api({ method: 'DELETE', url: `/api/tags/${econ}` })).statusCode).toBe(204);
    const nodes = (await t.api({ method: 'GET', url: '/api/nodes' })).json().nodes;
    expect(nodes.find((n: { id: string }) => n.id === course).tagIds).toEqual([career]);
  });

  it('null clears the tags', async () => {
    const res = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${course}`,
      payload: { tagIds: null },
    });
    expect(res.json().node.tagIds).toEqual([]);
  });

  it('tags go out with the data export', async () => {
    const data = (await t.api({ method: 'GET', url: '/api/me/export' })).json();
    expect(data.tags.map((x: { name: string }) => x.name).sort()).toEqual(['Career', 'Third']);
  });
});
