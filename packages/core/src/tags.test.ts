import { describe, expect, it } from 'vitest';
import {
  TAG_COLORS,
  inheritedTagIds,
  nextTagColor,
  sortByTagColor,
  tagColorRank,
  tagsOf,
  type Tag,
} from './tags';

const tag = (id: string, color: Tag['color']): Tag => ({ id, name: id, color, sortOrder: 0 });
const byId = new Map(
  [tag('econ', 'green'), tag('career', 'red'), tag('rotman', 'blue')].map((t) => [t.id, t]),
);

describe('nextTagColor', () => {
  it('takes the first colour nobody has yet', () => {
    expect(nextTagColor([])).toBe('red');
    expect(nextTagColor([{ color: 'red' }, { color: 'yellow' }])).toBe('orange');
  });
  it('goes round again once every colour is taken', () => {
    const all = TAG_COLORS.map((color) => ({ color }));
    expect(nextTagColor(all)).toBe('red');
    expect(nextTagColor([...all, { color: 'red' as const }])).toBe('orange');
  });
});

describe('tagsOf', () => {
  it('keeps the order held and drops deleted tags', () => {
    expect(tagsOf(['rotman', 'gone', 'econ'], byId).map((t) => t.id)).toEqual(['rotman', 'econ']);
    expect(tagsOf(undefined, byId)).toEqual([]);
  });
});

describe('inheritedTagIds', () => {
  it('takes its own tags, then its parents', () => {
    const nodes = new Map([
      ['course', { parentId: null, tagIds: ['econ', 'career'] }],
      ['unit', { parentId: 'course', tagIds: [] }],
      ['hw', { parentId: 'unit', tagIds: ['rotman', 'econ'] }],
    ]);
    expect(inheritedTagIds('hw', nodes)).toEqual(['rotman', 'econ', 'career']);
    expect(inheritedTagIds('unit', nodes)).toEqual(['econ', 'career']);
  });
  it('stops on a loop or a missing parent', () => {
    const nodes = new Map([
      ['a', { parentId: 'b', tagIds: ['x'] }],
      ['b', { parentId: 'a', tagIds: ['y'] }],
      ['c', { parentId: 'gone', tagIds: ['z'] }],
    ]);
    expect(inheritedTagIds('a', nodes)).toEqual(['x', 'y']);
    expect(inheritedTagIds('c', nodes)).toEqual(['z']);
  });
});

describe('sortByTagColor', () => {
  it('groups by the first tag colour in palette order, untagged last', () => {
    const rows = [
      { id: 'a', tagIds: [] },
      { id: 'b', tagIds: ['rotman'] },
      { id: 'c', tagIds: ['econ', 'career'] },
      { id: 'd', tagIds: ['career'] },
      { id: 'e' },
    ];
    expect(sortByTagColor(rows, byId).map((r) => r.id)).toEqual(['d', 'c', 'b', 'a', 'e']);
  });
  it('keeps the manual order inside one colour', () => {
    const rows = [
      { id: 'x', tagIds: ['econ'] },
      { id: 'y', tagIds: ['career'] },
      { id: 'z', tagIds: ['econ'] },
    ];
    expect(sortByTagColor(rows, byId).map((r) => r.id)).toEqual(['y', 'x', 'z']);
  });
  it('ranks a node whose only tag was deleted as untagged', () => {
    expect(tagColorRank(['gone'], byId)).toBe(9);
  });
});
