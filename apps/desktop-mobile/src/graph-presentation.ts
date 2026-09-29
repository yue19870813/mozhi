import type { Core, Css, NodeSingular, StylesheetStyle } from 'cytoscape';

export function nodeDiameter(count: number): number {
  const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
  return 14 + 28 * Math.sqrt(Math.min(safeCount, 40) / 40);
}

export const graphColors = {
  dark: { background: '#0C1220', text: '#CDDCEC', edge: '#577A9F', bright: '#8CEAF1', rim: '#B4E8FF', glow: '#40BCEB', gradient: '#E0F6FF #73BDF4 #397CC4' },
  light: { background: '#F4F7FC', text: '#304761', edge: '#829BB6', bright: '#087C9C', rim: '#5796CA', glow: '#328BBA', gradient: '#D9F2FF #508EC8 #245886' },
};

// Cytoscape supports underlays, which the installed type definitions omit.
type ModernNodeStyle = Css.Node & {
  'background-fill'?: 'radial-gradient';
  'underlay-color'?: string;
  'underlay-opacity'?: number;
  'underlay-padding'?: number;
  'underlay-shape'?: 'ellipse';
};

export function graphStyles(theme: string, reducedMotion: boolean): StylesheetStyle[] {
  const light = theme === 'light';
  const colors = graphColors[light ? 'light' : 'dark'];
  const node: ModernNodeStyle = {
    width: 'data(diameter)', height: 'data(diameter)',
    'background-color': colors.glow, 'background-fill': 'radial-gradient',
    'background-gradient-stop-colors': colors.gradient.split(' '),
    'background-gradient-stop-positions': ['0%', '55%', '100%'],
    'border-width': 1, 'border-color': colors.rim, 'border-opacity': .85,
    'underlay-color': colors.glow, 'underlay-opacity': light ? .05 : .09,
    'underlay-padding': 6, 'underlay-shape': 'ellipse',
    label: 'data(label)', 'font-size': 12, 'font-family': '-apple-system, BlinkMacSystemFont, PingFang SC, sans-serif',
    'min-zoomed-font-size': 5.4, color: colors.text, 'text-valign': 'bottom',
    'text-halign': 'center', 'text-margin-y': 10, 'text-wrap': 'wrap',
    'text-max-width': '120px', 'text-overflow-wrap': 'anywhere',
    'text-background-color': colors.background, 'text-background-opacity': .72,
    'text-background-padding': '2px', 'text-background-shape': 'roundrectangle',
    'overlay-opacity': 0,
    'transition-property': 'opacity, border-color, underlay-opacity, color',
    'transition-duration': reducedMotion ? 0 : 160,
    'transition-timing-function': 'ease-out',
  };
  const focus: ModernNodeStyle = {
    'border-width': 2, 'border-color': colors.bright,
    'underlay-opacity': light ? .16 : .25, 'underlay-padding': 8,
    color: colors.bright, 'z-index': 10,
  };
  return [
    { selector: 'node', style: node },
    { selector: 'edge', style: {
      width: 1, 'line-color': colors.edge, opacity: light ? .4 : .32,
      'curve-style': 'bezier', 'target-arrow-shape': 'triangle',
      'target-arrow-color': colors.edge, 'arrow-scale': .65,
      'transition-property': 'opacity, line-color, target-arrow-color',
      'transition-duration': reducedMotion ? 0 : 160,
    } },
    { selector: 'node.related', style: { 'border-color': colors.bright, color: colors.text } },
    { selector: 'edge.related', style: {
      width: 1.6, opacity: .9, 'line-color': colors.bright, 'target-arrow-color': colors.bright,
    } },
    { selector: 'node:selected', style: focus },
    { selector: '.muted', style: { opacity: .2 } },
    { selector: 'node.hovered', style: { ...focus, opacity: 1 } },
    { selector: '.exporting', style: { 'transition-property': 'none', 'transition-duration': 0 } },
  ];
}

export type HoverInfo = { id: string; title: string; count: number; x: number; y: number };
type InteractionCallbacks = {
  onSelect: (id: string) => void;
  onHover: (info: HoverInfo | null) => void;
  onOpen: (id: string) => void;
};

export function bindGraphInteractions(graph: Core, callbacks: InteractionCallbacks) {
  let selected = '', hovered = '', dragging = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function applyFocus() {
    const focus = graph.getElementById(hovered || selected);
    graph.batch(() => {
      graph.elements().removeClass('muted related hovered');
      if (focus.length) {
        const neighborhood = focus.closedNeighborhood();
        neighborhood.addClass('related');
        graph.elements().not(neighborhood).addClass('muted');
      }
      if (hovered) graph.getElementById(hovered).addClass('hovered');
    });
  }

  function clearHover() {
    clearTimeout(timer);
    if (!hovered) return;
    hovered = '';
    callbacks.onHover(null);
    applyFocus();
  }

  function select(id: string) {
    selected = graph.getElementById(id).isNode() ? id : '';
    graph.batch(() => {
      graph.nodes().unselect();
      if (selected) graph.getElementById(selected).select();
    });
    callbacks.onSelect(selected);
    applyFocus();
  }

  const enter = (event: { target: NodeSingular }) => {
    if (dragging) return;
    clearTimeout(timer);
    callbacks.onHover(null);
    const node = event.target;
    hovered = node.id();
    applyFocus();
    timer = setTimeout(() => {
      if (hovered !== node.id() || graph.destroyed() || dragging) return;
      const position = node.renderedPosition();
      callbacks.onHover({ id: node.id(), title: node.data('label'), count: node.data('incomingCount'),
        x: position.x + node.renderedWidth() / 2 + 14, y: position.y });
    }, 150);
  };
  const leave = () => clearHover();
  const tap = (event: { target: Core | NodeSingular }) => {
    if (event.target === graph) { clearHover(); select(''); }
    else if ('isNode' in event.target && event.target.isNode()) select(event.target.id());
  };
  const open = (event: { target: NodeSingular }) => callbacks.onOpen(event.target.id());
  const startDrag = () => { dragging = true; clearHover(); };
  const endDrag = () => { dragging = false; };
  graph.on('mouseover', 'node', enter);
  graph.on('mouseout', 'node', leave);
  graph.on('tap', tap);
  graph.on('dbltap', 'node', open);
  graph.on('grab', 'node', startDrag);
  graph.on('free', 'node', endDrag);
  graph.on('pan zoom', leave);
  return {
    select, clearHover,
    destroy() {
      clearTimeout(timer);
      graph.off('mouseover', 'node', enter);
      graph.off('mouseout', 'node', leave);
      graph.off('tap', tap);
      graph.off('dbltap', 'node', open);
      graph.off('grab', 'node', startDrag);
      graph.off('free', 'node', endDrag);
      graph.off('pan zoom', leave);
    },
  };
}

export function tooltipPosition(anchor: { x: number; y: number }, view: { width: number; height: number }, tooltip: { width: number; height: number }) {
  return {
    left: Math.max(12, Math.min(anchor.x, view.width - tooltip.width - 12)),
    top: Math.max(12, Math.min(anchor.y + 14, view.height - tooltip.height - 12)),
  };
}
