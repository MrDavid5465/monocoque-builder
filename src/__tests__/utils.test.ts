import { describe, it, expect } from 'vitest';
import {
  findNodeById,
  findParentId,
  updateNodeById,
  deleteNodeById,
  addChildToNode,
  flattenNodes,
  reorderChildren,
  moveNode,
  isDescendantOf,
  detectTemplateType,
  deepCopyNode,
} from '../components/Telemetry/DashboardDesigner/components/utils';
import { ComponentNode } from '../types/dashboard';

function node(id: string, type: ComponentNode['type'] = 'static-sprite', children?: ComponentNode[]): ComponentNode {
  return { id, type, name: id, x: 0, y: 0, ...(children ? { children } : {}) };
}

// ─── flattenNodes ─────────────────────────────────────────────────────────────

describe('flattenNodes', () => {
  it('returns empty array for empty input', () => {
    expect(flattenNodes([])).toEqual([]);
  });

  it('returns root-level nodes', () => {
    const nodes = [node('a'), node('b')];
    expect(flattenNodes(nodes).map(n => n.id)).toEqual(['a', 'b']);
  });

  it('includes all descendants in depth-first order', () => {
    const tree = [node('a', 'group', [node('b', 'group', [node('c')]), node('d')])];
    expect(flattenNodes(tree).map(n => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ─── findNodeById ─────────────────────────────────────────────────────────────

describe('findNodeById', () => {
  const tree = [node('a', 'group', [node('b', 'group', [node('c')])])];

  it('finds a root node', () => {
    expect(findNodeById(tree, 'a')?.id).toBe('a');
  });

  it('finds a deeply nested node', () => {
    expect(findNodeById(tree, 'c')?.id).toBe('c');
  });

  it('returns null when not found', () => {
    expect(findNodeById(tree, 'z')).toBeNull();
  });
});

// ─── findParentId ─────────────────────────────────────────────────────────────

describe('findParentId', () => {
  const tree = [node('a', 'group', [node('b', 'group', [node('c')])])];

  it('returns the direct parent id', () => {
    expect(findParentId(tree, 'b')).toBe('a');
  });

  it('finds parent of a deeply nested node', () => {
    expect(findParentId(tree, 'c')).toBe('b');
  });

  it('returns null for a root node', () => {
    expect(findParentId(tree, 'a')).toBeNull();
  });
});

// ─── updateNodeById ───────────────────────────────────────────────────────────

describe('updateNodeById', () => {
  it('updates a root node', () => {
    const tree = [node('a')];
    const result = updateNodeById(tree, 'a', { name: 'updated' });
    expect(result[0].name).toBe('updated');
  });

  it('updates a nested node without touching siblings', () => {
    const tree = [node('root', 'group', [node('child1'), node('child2')])];
    const result = updateNodeById(tree, 'child1', { x: 99 });
    expect(result[0].children![0].x).toBe(99);
    expect(result[0].children![1].x).toBe(0);
  });

  it('returns tree unchanged when id not found', () => {
    const tree = [node('a')];
    expect(updateNodeById(tree, 'z', { x: 1 })).toEqual(tree);
  });
});

// ─── deleteNodeById ───────────────────────────────────────────────────────────

describe('deleteNodeById', () => {
  it('deletes a root node', () => {
    const tree = [node('a'), node('b')];
    expect(deleteNodeById(tree, 'a').map(n => n.id)).toEqual(['b']);
  });

  it('deletes a nested node', () => {
    const tree = [node('root', 'group', [node('child1'), node('child2')])];
    const result = deleteNodeById(tree, 'child1');
    expect(result[0].children!.map(n => n.id)).toEqual(['child2']);
  });

  it('returns tree unchanged when id not found', () => {
    const tree = [node('a')];
    expect(deleteNodeById(tree, 'z')).toEqual(tree);
  });
});

// ─── addChildToNode ───────────────────────────────────────────────────────────

describe('addChildToNode', () => {
  it('appends to root when parentId is null', () => {
    const tree = [node('a')];
    const result = addChildToNode(tree, null, node('b'));
    expect(result.map(n => n.id)).toEqual(['a', 'b']);
  });

  it('appends to specified parent', () => {
    const tree = [node('parent', 'group', [node('existing')])];
    const result = addChildToNode(tree, 'parent', node('new'));
    expect(result[0].children!.map(n => n.id)).toEqual(['existing', 'new']);
  });

  it('creates children array when parent has none', () => {
    const tree = [node('parent')];
    const result = addChildToNode(tree, 'parent', node('child'));
    expect(result[0].children!.map(n => n.id)).toEqual(['child']);
  });
});

// ─── reorderChildren ──────────────────────────────────────────────────────────

describe('reorderChildren', () => {
  it('reorders root-level nodes', () => {
    const tree = [node('a'), node('b'), node('c')];
    expect(reorderChildren(tree, null, 0, 2).map(n => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('reorders children of a specific parent', () => {
    const tree = [node('p', 'group', [node('x'), node('y'), node('z')])];
    const result = reorderChildren(tree, 'p', 2, 0);
    expect(result[0].children!.map(n => n.id)).toEqual(['z', 'x', 'y']);
  });

  it('is a no-op when fromIndex equals toIndex', () => {
    const tree = [node('a'), node('b')];
    expect(reorderChildren(tree, null, 0, 0).map(n => n.id)).toEqual(['a', 'b']);
  });
});

// ─── moveNode ─────────────────────────────────────────────────────────────────

describe('moveNode', () => {
  it('is a no-op when nodeId equals targetId', () => {
    const tree = [node('a'), node('b')];
    expect(moveNode(tree, 'a', 'a', 'before')).toEqual(tree);
  });

  it('moves a node before the target', () => {
    const tree = [node('a'), node('b'), node('c')];
    expect(moveNode(tree, 'c', 'a', 'before').map(n => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('moves a node after the target', () => {
    const tree = [node('a'), node('b'), node('c')];
    expect(moveNode(tree, 'a', 'b', 'after').map(n => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('moves a node inside the target group', () => {
    const tree = [node('a'), node('group1', 'group', [node('child')])];
    const result = moveNode(tree, 'a', 'group1', 'inside');
    expect(result.map(n => n.id)).toEqual(['group1']);
    expect(result[0].children!.map(n => n.id)).toEqual(['child', 'a']);
  });

  it('resets x/y to 0 when a node moves into a different parent', () => {
    const tree = [
      { ...node('a'), x: 100, y: 200 },
      node('group1', 'group', [node('child')]),
    ];
    const result = moveNode(tree, 'a', 'group1', 'inside');
    const moved = result[0].children!.find(n => n.id === 'a')!;
    expect(moved.x).toBe(0);
    expect(moved.y).toBe(0);
  });

  it('does not reset x/y when reordering within the same parent', () => {
    const tree = [{ ...node('a'), x: 100, y: 200 }, node('b'), node('c')];
    const result = moveNode(tree, 'c', 'a', 'before');
    const moved = result.find(n => n.id === 'a')!;
    expect(moved.x).toBe(100);
    expect(moved.y).toBe(200);
  });
});

// ─── isDescendantOf ───────────────────────────────────────────────────────────

describe('isDescendantOf', () => {
  const tree = [node('root', 'group', [node('child', 'group', [node('grandchild')])])];

  it('returns true for a direct child', () => {
    expect(isDescendantOf(tree, 'root', 'child')).toBe(true);
  });

  it('returns true for a grandchild', () => {
    expect(isDescendantOf(tree, 'root', 'grandchild')).toBe(true);
  });

  it('returns false for an ancestor', () => {
    expect(isDescendantOf(tree, 'child', 'root')).toBe(false);
  });

  it('returns false when ancestor has no children', () => {
    expect(isDescendantOf(tree, 'grandchild', 'child')).toBe(false);
  });
});

// ─── detectTemplateType ───────────────────────────────────────────────────────

describe('detectTemplateType', () => {
  it('detects needle-only', () => {
    expect(detectTemplateType(node('n', 'needle-gauge'))).toBe('needle');
  });

  it('detects bar gauge', () => {
    expect(detectTemplateType(node('b', 'bar-gauge'))).toBe('bar');
  });

  it('detects sprite-bar-gauge as bar', () => {
    expect(detectTemplateType(node('b', 'sprite-bar-gauge'))).toBe('bar');
  });

  it('detects graph-bar-gauge as bar', () => {
    expect(detectTemplateType(node('b', 'graph-bar-gauge'))).toBe('bar');
  });

  it('detects text gauge as digital', () => {
    expect(detectTemplateType(node('t', 'text-gauge'))).toBe('digital');
  });

  it('detects combination when needle + bar present as children', () => {
    const combo = node('g', 'group', [node('n', 'needle-gauge'), node('b', 'bar-gauge')]);
    expect(detectTemplateType(combo)).toBe('combination');
  });

  it('detects combination when needle + digital present', () => {
    const combo = node('g', 'group', [node('n', 'needle-gauge'), node('t', 'text-gauge')]);
    expect(detectTemplateType(combo)).toBe('combination');
  });

  it('returns none for non-gauge types (group, static-sprite)', () => {
    expect(detectTemplateType(node('g', 'group'))).toBe('none');
  });
});

// ─── deepCopyNode ─────────────────────────────────────────────────────────────

describe('deepCopyNode', () => {
  it('produces a new id for the copy', () => {
    const original = node('orig', 'needle-gauge');
    const copy = deepCopyNode(original);
    expect(copy.id).not.toBe('orig');
  });

  it('preserves type, name, and position', () => {
    const original = { ...node('orig', 'text-gauge'), name: 'Speed', x: 100, y: 200 };
    const copy = deepCopyNode(original);
    expect(copy.type).toBe('text-gauge');
    expect(copy.name).toBe('Speed');
    expect(copy.x).toBe(100);
    expect(copy.y).toBe(200);
  });

  it('recursively copies children with new ids', () => {
    const original = node('parent', 'group', [node('child')]);
    const copy = deepCopyNode(original);
    expect(copy.children).toHaveLength(1);
    expect(copy.children![0].id).not.toBe('child');
  });
});
