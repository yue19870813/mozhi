import type { Core } from 'cytoscape';

export type LabelBox = { id: string; x1: number; x2: number; y1: number; y2: number };

// Force layouts are approximate. Resolve remaining intersections using the
// rendered node + label bounds, including bottom-aligned multiline titles.
export function separateLabelBoxes(boxes: LabelBox[], gap = 16): Map<string, number> {
  const placed: LabelBox[] = [];
  const offsets = new Map<string, number>();
  for (const original of [...boxes].sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1 || a.id.localeCompare(b.id))) {
    const box = { ...original };
    const neighbors = placed.filter(other => box.x1 < other.x2 + gap && box.x2 + gap > other.x1)
      .sort((a, b) => a.y1 - b.y1);
    for (const other of neighbors) {
      if (box.y1 < other.y2 + gap && box.y2 + gap > other.y1) {
        const offset = other.y2 + gap - box.y1;
        box.y1 += offset;
        box.y2 += offset;
      }
    }
    offsets.set(box.id, box.y1 - original.y1);
    placed.push(box);
  }
  return offsets;
}

export function separateGraphLabels(graph: Core) {
  const nodes = graph.nodes();
  const offsets = separateLabelBoxes(nodes.map(node => ({
    id: node.id(), ...node.boundingBox({ includeLabels: true, includeOverlays: false }),
  })));
  graph.batch(() => {
    nodes.forEach(node => {
      const offset = offsets.get(node.id()) ?? 0;
      if (offset) node.position('y', node.position('y') + offset);
    });
  });
}

export function fitGraph(graph: Core) {
  graph.fit(undefined, 40);
  if (graph.zoom() > 1.5) {
    graph.zoom(1.5);
    graph.center();
  }
}
