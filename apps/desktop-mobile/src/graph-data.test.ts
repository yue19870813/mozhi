import { expect, it } from 'vitest';
import { graphData, graphPresets } from './graph-data';
it('generates reproducible budgets without self-links or duplicate edges', () => {
  for (const { nodes, edges } of graphPresets) {
    const data = graphData(nodes, edges);
    expect(data.length).toBe(nodes + edges);
    expect(new Set(data.map(e => e.data.id)).size).toBe(data.length);
    expect(data.slice(nodes).every(e => e.data.source !== e.data.target)).toBe(true);
    expect(new Set(data.slice(nodes).map(e => `${e.data.source}:${e.data.target}`)).size).toBe(edges);
  }
  expect(graphData(20, 40)).toEqual(graphData(20, 40));
});
