import type { Session, StudyNode } from './types';

export interface NodeIndex {
  byId: Map<string, StudyNode>;
  /** Non-archived children, sorted by sortOrder. */
  childrenOf: Map<string, StudyNode[]>;
  roots: StudyNode[];
  sessionsByNode: Map<string, Session[]>;
}

/** Build lookup maps once per request; every calculation takes the index rather than raw arrays. */
export function buildIndex(nodes: StudyNode[], sessions: Session[] = []): NodeIndex {
  const byId = new Map<string, StudyNode>();
  const childrenOf = new Map<string, StudyNode[]>();
  const roots: StudyNode[] = [];
  for (const n of nodes) byId.set(n.id, n);
  for (const n of nodes) {
    if (n.archived) continue;
    if (n.parentId && byId.has(n.parentId)) {
      const list = childrenOf.get(n.parentId) ?? [];
      list.push(n);
      childrenOf.set(n.parentId, list);
    } else {
      roots.push(n);
    }
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  roots.sort((a, b) => a.sortOrder - b.sortOrder);

  const sessionsByNode = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = sessionsByNode.get(s.nodeId) ?? [];
    list.push(s);
    sessionsByNode.set(s.nodeId, list);
  }
  return { byId, childrenOf, roots, sessionsByNode };
}

export function childrenOf(index: NodeIndex, nodeId: string): StudyNode[] {
  return index.childrenOf.get(nodeId) ?? [];
}

/** All descendant ids (not including the node itself), depth-first. */
export function descendantIds(index: NodeIndex, nodeId: string): string[] {
  const out: string[] = [];
  const stack = [...childrenOf(index, nodeId)];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n.id);
    stack.push(...childrenOf(index, n.id));
  }
  return out;
}

/** Ancestor chain from the node's parent up to the root. */
export function ancestors(index: NodeIndex, nodeId: string): StudyNode[] {
  const out: StudyNode[] = [];
  let cur = index.byId.get(nodeId);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    const p = index.byId.get(cur.parentId);
    if (!p) break;
    out.push(p);
    cur = p;
  }
  return out;
}

/** The root course for a node (or the node itself if it is a root). */
export function rootOf(index: NodeIndex, nodeId: string): StudyNode | undefined {
  const chain = ancestors(index, nodeId);
  return chain.length ? chain[chain.length - 1] : index.byId.get(nodeId);
}

/** True if the node or any ancestor is an assessment (drives the "prepared" review question). */
export function isUnderAssessment(index: NodeIndex, nodeId: string): boolean {
  const n = index.byId.get(nodeId);
  if (!n) return false;
  if (n.kind === 'assessment') return true;
  return ancestors(index, nodeId).some((a) => a.kind === 'assessment');
}

/** Sessions on the node and all of its descendants. */
export function sessionsForSubtree(index: NodeIndex, nodeId: string): Session[] {
  const ids = [nodeId, ...descendantIds(index, nodeId)];
  const out: Session[] = [];
  for (const id of ids) {
    const list = index.sessionsByNode.get(id);
    if (list) out.push(...list);
  }
  return out;
}

/** Effective colour: own, else nearest ancestor's, else null. */
export function effectiveColor(index: NodeIndex, nodeId: string): string | null {
  const n = index.byId.get(nodeId);
  if (!n) return null;
  if (n.color) return n.color;
  for (const a of ancestors(index, nodeId)) if (a.color) return a.color;
  return null;
}
