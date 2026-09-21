import type { ElementDefinition } from 'cytoscape';
export type GraphPreset = { label: string; nodes: number; edges: number };
export const graphPresets: GraphPreset[] = [{ label: '局部 · 200 / 1,000', nodes: 200, edges: 1000 }, { label: '移动预算 · 1,000 / 3,000', nodes: 1000, edges: 3000 }, { label: '桌面预算 · 3,000 / 10,000', nodes: 3000, edges: 10000 }];
export function graphData(nodes: number, edges: number): ElementDefinition[] {
  const result: ElementDefinition[] = Array.from({ length: nodes }, (_, i) => ({ data: { id: `n${i}`, label: `笔记 ${i + 1}`, group: i % 4 } }));
  const pairs = new Set<string>();
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  // Use upper bits: LCG low bits correlate, especially for power-of-two budgets.
  while (pairs.size < Math.min(edges, nodes * (nodes - 1))) {
    const a = (random() >>> 8) % nodes, b = (random() >>> 8) % nodes;
    const key = `${a}:${b}`;
    if (a === b || pairs.has(key)) continue;
    pairs.add(key); result.push({ data: { id: `e${pairs.size}`, source: `n${a}`, target: `n${b}` } });
  }
  return result;
}
