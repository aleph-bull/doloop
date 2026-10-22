/**
 * Tags on tasks, Notion-style: a name and one colour from a fixed palette. The colours are
 * names, not hex, so each theme can draw them in its own tint.
 */

/** The palette, in the order the tag menus show it: the rainbow, then brown and grey. */
export const TAG_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'brown',
  'gray',
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
  sortOrder: number;
}

/** A new tag's colour: the first in the palette no tag has yet, then round again. */
export function nextTagColor(tags: Array<Pick<Tag, 'color'>>): TagColor {
  const used = new Set(tags.map((t) => t.color));
  return TAG_COLORS.find((c) => !used.has(c)) ?? TAG_COLORS[tags.length % TAG_COLORS.length]!;
}

/** The node's tags in the order it holds them, skipping ids whose tag was deleted. */
export function tagsOf(tagIds: readonly string[] | undefined, byId: Map<string, Tag>): Tag[] {
  return (tagIds ?? []).map((id) => byId.get(id)).filter((t): t is Tag => !!t);
}

/**
 * A node's own tags, then the ones its parent and their parents carry, each once. A tag on a
 * course shows on every task in it.
 */
export function inheritedTagIds(
  nodeId: string,
  byId: Map<string, { parentId: string | null; tagIds?: string[] }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(nodeId);
  while (cur && !seen.has(nodeId)) {
    for (const id of cur.tagIds ?? []) if (!out.includes(id)) out.push(id);
    seen.add(nodeId);
    if (!cur.parentId || seen.has(cur.parentId)) break;
    nodeId = cur.parentId;
    cur = byId.get(nodeId);
  }
  return out;
}
