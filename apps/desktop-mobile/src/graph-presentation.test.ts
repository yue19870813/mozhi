import cytoscape, { type Core } from 'cytoscape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindGraphInteractions, graphStyles, nodeDiameter, tooltipPosition } from './graph-presentation';

describe('graph node sizes', () => {
  it('uses bounded square-root sizes independent of the visible graph', () => {
    expect(nodeDiameter(0)).toBe(14);
    expect(nodeDiameter(10)).toBe(28);
    expect(nodeDiameter(40)).toBe(42);
    expect(nodeDiameter(4000)).toBe(42);
    for (let count = 1; count <= 40; count++) expect(nodeDiameter(count)).toBeGreaterThan(nodeDiameter(count - 1));
    expect(nodeDiameter(-1)).toBe(14);
    expect(nodeDiameter(NaN)).toBe(14);
  });
});

describe('graph interaction', () => {
  let graph: Core;
  let controller: ReturnType<typeof bindGraphInteractions>;
  function setup() {
    vi.useFakeTimers();
    graph = cytoscape({ headless: true, styleEnabled: true, layout: { name: 'preset' },
      style: graphStyles('dark', true),
      elements: [
        ...['a', 'b', 'c', 'isolated'].map((id, i) => ({ data: { id, label: id, incomingCount: i, diameter: nodeDiameter(i) } })),
        { data: { id: 'ab', source: 'a', target: 'b' } },
        { data: { id: 'bc', source: 'b', target: 'c' } },
      ],
    });
    const callbacks = { onSelect: vi.fn(), onHover: vi.fn(), onOpen: vi.fn() };
    controller = bindGraphInteractions(graph, callbacks);
    return callbacks;
  }
  afterEach(() => { controller?.destroy(); graph?.destroy(); vi.useRealTimers(); });

  it('temporarily highlights one-hop neighbors and restores selection after hover', () => {
    const callbacks = setup();
    controller.select('a');
    graph.$id('c').emit('mouseover');
    expect(graph.$id('a').hasClass('muted')).toBe(true);
    expect(graph.$id('b').hasClass('related')).toBe(true);
    expect(graph.$id('bc').hasClass('related')).toBe(true);
    expect(graph.$id('ab').hasClass('muted')).toBe(true);
    expect(graph.$id('c').width()).toBeCloseTo(nodeDiameter(2));
    vi.advanceTimersByTime(149);
    expect(callbacks.onHover).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(1);
    expect(callbacks.onHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c', count: 2 }));
    graph.$id('c').emit('mouseout');
    expect(graph.$(':selected').map(node => node.id())).toEqual(['a']);
    expect(graph.$id('c').hasClass('muted')).toBe(true);
    expect(graph.$id('ab').hasClass('related')).toBe(true);
    expect(callbacks.onHover).toHaveBeenLastCalledWith(null);
  });

  it('selects only the last tapped node, clears on background tap and opens on double tap', () => {
    const callbacks = setup();
    graph.$id('a').emit('tap'); graph.$id('b').emit('tap');
    expect(graph.$(':selected').map(node => node.id())).toEqual(['b']);
    graph.$id('b').emit('dbltap');
    expect(callbacks.onOpen).toHaveBeenCalledWith('b');
    graph.emit('tap');
    expect(graph.$(':selected').length).toBe(0);
    expect(graph.$('.muted').length).toBe(0);
    expect(callbacks.onSelect).toHaveBeenLastCalledWith('');
  });

  it('cancels pending tooltips while dragging, navigating or disposing', () => {
    const callbacks = setup();
    for (const event of ['grab', 'pan', 'zoom']) {
      graph.$id('a').emit('mouseover');
      if (event === 'grab') graph.$id('a').emit('grab'); else graph.emit(event);
      vi.advanceTimersByTime(200);
      expect(callbacks.onHover).toHaveBeenLastCalledWith(null);
      expect(graph.$('.hovered').length).toBe(0);
      graph.$id('a').emit('free');
    }
    graph.$id('a').emit('mouseover'); controller.clearHover();
    vi.advanceTimersByTime(200);
    expect(callbacks.onHover).toHaveBeenLastCalledWith(null);
    graph.$id('a').emit('mouseover'); controller.destroy();
    vi.advanceTimersByTime(200);
    expect(callbacks.onHover).toHaveBeenLastCalledWith(null);
  });

  it('theme updates preserve sizes, positions, viewport and selection', () => {
    setup(); controller.select('b');
    graph.$id('b').position({ x: 80, y: 120 });
    graph.viewport({ zoom: 1.2, pan: { x: 10, y: 20 } });
    graph.style(graphStyles('light', true));
    expect(graph.$id('b').position()).toEqual({ x: 80, y: 120 });
    expect(graph.zoom()).toBe(1.2);
    expect(graph.pan()).toEqual({ x: 10, y: 20 });
    expect(graph.$id('b').selected()).toBe(true);
    expect(graph.$id('b').width()).toBeCloseTo(nodeDiameter(1));
    expect(graph.$id('b').numericStyle('transition-duration')).toBe(0);
  });
});

it('keeps hover information within the canvas at all edges', () => {
  for (const anchor of [{ x: -10, y: -100 }, { x: 700, y: 600 }, { x: 200, y: 100 }]) {
    const position = tooltipPosition(anchor, { width: 720, height: 450 }, { width: 260, height: 120 });
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.left + 260).toBeLessThanOrEqual(708);
    expect(position.top + 120).toBeLessThanOrEqual(438);
  }
});
