import { ComponentNode } from '../../../../types/dashboard';

export type TemplateGaugeType = 'needle' | 'bar' | 'digital' | 'combination' | 'none';

export function detectTemplateType(node: ComponentNode): TemplateGaugeType {
  const all = flattenNodes([node]);
  const hasNeedle  = all.some(n => n.type === 'needle-gauge');
  const hasBar     = all.some(n => n.type === 'bar-gauge' || n.type === 'sprite-bar-gauge' || n.type === 'graph-bar-gauge');
  const hasDigital = all.some(n => n.type === 'text-gauge' || n.type === 'sprite-text-gauge');
  if (hasNeedle && (hasBar || hasDigital)) return 'combination';
  if (hasNeedle)  return 'needle';
  if (hasBar)     return 'bar';
  if (hasDigital) return 'digital';
  return 'none';
}

export function deepCopyNode(node: ComponentNode): ComponentNode {
  return {
    ...node,
    id: `${node.type}-${Math.random().toString(36).slice(2, 9)}`,
    children: node.children?.map(deepCopyNode),
  };
}

// Every ComponentNode field that holds a bare sprite filename (not a File
// relation). Used to figure out what a template needs copied into a
// dashboard's own folder before it will render.
const FILE_FIELDS: (keyof ComponentNode)[] = [
  'file', 'nightFile', 'backgroundFile',
  'fileGreen', 'fileYellow', 'fileRed', 'fileBlue', 'fileWhite', 'fileChequered',
  'fileBlack', 'fileBlackWhite', 'fileBlackOrange', 'fileOrange', 'fileInPit', 'fileOff',
  'ctrlOffFile', 'ctrlOnFile', 'ctrlPressedFile',
  'sliderThumbFile', 'encoderKnobFile', 'encoderBtnOnFile', 'encoderBtnOffFile',
];

export function collectFileRefs(node: ComponentNode): string[] {
  const files = new Set<string>();
  for (const n of flattenNodes([node])) {
    for (const field of FILE_FIELDS) {
      const val = n[field];
      if (typeof val === 'string' && val) files.add(val);
    }
  }
  return [...files];
}

export function isDescendantOf(nodes: ComponentNode[], ancestorId: string, candidateId: string): boolean {
  const ancestor = findNodeById(nodes, ancestorId);
  if (!ancestor?.children?.length) return false;
  return flattenNodes(ancestor.children).some(n => n.id === candidateId);
}

function insertNodeRelative(
  nodes: ComponentNode[],
  targetId: string,
  node: ComponentNode,
  pos: 'before' | 'after',
): ComponentNode[] {
  const idx = nodes.findIndex(n => n.id === targetId);
  if (idx >= 0) {
    const result = [...nodes];
    result.splice(pos === 'before' ? idx : idx + 1, 0, node);
    return result;
  }
  return nodes.map(n =>
    n.children ? { ...n, children: insertNodeRelative(n.children, targetId, node, pos) } : n,
  );
}

export function moveNode(
  nodes: ComponentNode[],
  nodeId: string,
  targetId: string,
  mode: 'before' | 'after' | 'inside',
): ComponentNode[] {
  if (nodeId === targetId) return nodes;
  const movingNode = findNodeById(nodes, nodeId);
  if (!movingNode) return nodes;
  const oldParentId = findParentId(nodes, nodeId);
  const withoutNode = deleteNodeById(nodes, nodeId);
  // x/y are relative to the parent container — a node moving into a
  // different parent (e.g. dropped onto/inside a group) has its coordinate
  // origin change out from under it, so it must be re-zeroed or it renders
  // at whatever offset it used to be from a completely different origin.
  const newParentId = mode === 'inside' ? targetId : findParentId(withoutNode, targetId);
  const nodeToInsert = newParentId !== oldParentId ? { ...movingNode, x: 0, y: 0 } : movingNode;
  if (mode === 'inside') return addChildToNode(withoutNode, targetId, nodeToInsert);
  return insertNodeRelative(withoutNode, targetId, nodeToInsert, mode);
}

export function findNodeById(nodes: ComponentNode[], id: string): ComponentNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findParentId(nodes: ComponentNode[], id: string): string | null {
  for (const node of nodes) {
    if (node.children?.some(c => c.id === id)) return node.id;
    if (node.children) {
      const found = findParentId(node.children, id);
      if (found !== null) return found;
    }
  }
  return null;
}

export function updateNodeById(
  nodes: ComponentNode[],
  id: string,
  patch: Partial<ComponentNode>,
): ComponentNode[] {
  return nodes.map(node => {
    if (node.id === id) return { ...node, ...patch };
    if (node.children) return { ...node, children: updateNodeById(node.children, id, patch) };
    return node;
  });
}

export function deleteNodeById(nodes: ComponentNode[], id: string): ComponentNode[] {
  return nodes
    .filter(n => n.id !== id)
    .map(n => n.children ? { ...n, children: deleteNodeById(n.children, id) } : n);
}

export function addChildToNode(
  nodes: ComponentNode[],
  parentId: string | null,
  child: ComponentNode,
): ComponentNode[] {
  if (parentId === null) return [...nodes, child];
  return nodes.map(node => {
    if (node.id === parentId) return { ...node, children: [...(node.children ?? []), child] };
    if (node.children) return { ...node, children: addChildToNode(node.children, parentId, child) };
    return node;
  });
}

export function flattenNodes(nodes: ComponentNode[]): ComponentNode[] {
  const result: ComponentNode[] = [];
  const walk = (ns: ComponentNode[]) => {
    for (const n of ns) {
      result.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return result;
}

// Computes the axis-aligned bounding box of every node in canvas coordinates.
// Children of groups are offset by the group's absolute position; the group's
// own bounds are the union of its children.
export function getAbsoluteNodeBounds(
  nodes: ComponentNode[],
  offsetX: number = 0,
  offsetY: number = 0,
): Map<string, { x: number; y: number; w: number; h: number }> {
  const result = new Map<string, { x: number; y: number; w: number; h: number }>();

  for (const node of nodes) {
    const absX = offsetX + node.x;
    const absY = offsetY + node.y;

    if (node.type === 'needle-gauge') {
      const w = node.width ?? 100;
      const h = node.height ?? 100;
      const rx = node.rotationX ?? Math.round(w / 2);
      const ry = node.rotationY ?? Math.round(h * 0.94);
      result.set(node.id, { x: absX - rx, y: absY - ry, w, h });
    } else if (node.children?.length) {
      const childMap = getAbsoluteNodeBounds(node.children, absX, absY);
      childMap.forEach((b, id) => result.set(id, b));
      const childBounds = Array.from(childMap.values());
      const minX = Math.min(...childBounds.map(b => b.x));
      const minY = Math.min(...childBounds.map(b => b.y));
      const maxX = Math.max(...childBounds.map(b => b.x + b.w));
      const maxY = Math.max(...childBounds.map(b => b.y + b.h));
      result.set(node.id, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    } else {
      result.set(node.id, { x: absX, y: absY, w: node.width ?? 100, h: node.height ?? 100 });
    }
  }

  return result;
}

export function reorderChildren(
  nodes: ComponentNode[],
  parentId: string | null,
  fromIndex: number,
  toIndex: number,
): ComponentNode[] {
  if (parentId === null) {
    const arr = [...nodes];
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
    return arr;
  }
  return nodes.map(node => {
    if (node.id === parentId) {
      const arr = [...(node.children ?? [])];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return { ...node, children: arr };
    }
    if (node.children) return { ...node, children: reorderChildren(node.children, parentId, fromIndex, toIndex) };
    return node;
  });
}
