import { t, useLanguage } from './i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type Layouts } from 'cytoscape';
import { workspace, errorText, native, type ParsedNote } from './api';
import type { GraphFilterState } from './GraphFilters';
import { fitGraph, separateGraphLabels } from './graph-layout';
import { bindGraphInteractions, graphColors, graphStyles, nodeDiameter, tooltipPosition, type HoverInfo } from './graph-presentation';
import './knowledge-graph.css';

type Data = {
  nodes: ParsedNote[];
  edges: { source: string; target: string; count: number }[];
  incomingCounts: Record<string, number>;
  truncated: boolean;
};
type Snapshot = {
  query: string; zoom: number; pan: { x: number; y: number }; selected: string;
  positions: Map<string, { x: number; y: number }>;
  dimensions: Map<string, string>;
};

export function KnowledgeGraph({ current, revision, onOpen, active, filters, theme }: {
  current: string; revision: number; onOpen: (path: string) => void; active: boolean; filters: GraphFilterState; theme: string;
}) {
  useLanguage();
  const host = useRef<HTMLDivElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null), layout = useRef<Layouts | null>(null);
  const interaction = useRef<ReturnType<typeof bindGraphInteractions> | null>(null);
  const snapshot = useRef<Snapshot | null>(null);
  const [message, setMessage] = useState(''), [selected, setSelected] = useState('');
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [details, setDetails] = useState<Map<string, { title: string; count: number }>>(new Map());
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const open = useRef(onOpen); open.current = onOpen;
  const appearance = useRef({ theme, reducedMotion }); appearance.current = { theme, reducedMotion };
  const visible = useRef(active); visible.current = active;
  const center = filters.scope === 'local' ? current : null;
  const query = JSON.stringify({ center, depth: filters.depth, tag: filters.tag, directory: filters.directory, keyword: filters.keyword, includeIsolated: filters.isolated });

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (!native) { setMessage(t("知识图谱需要桌面应用；浏览器仅提供编辑界面演示。")); return; }
    let disposed = false;
    const timer = setTimeout(() => {
      setMessage(t("正在绘制知识星图…"));
      workspace<Data>({ action: 'graph', query: JSON.parse(query) }).then(data => {
        if (disposed || !host.current) return;
        const previous = snapshot.current?.query === query ? snapshot.current : null;
        const nodeDetails = new Map(data.nodes.map(note => [note.path, {
          title: note.title, count: data.incomingCounts[note.path] ?? 0,
        }]));
        const dimensions = new Map(data.nodes.map(note => [note.path,
          JSON.stringify([note.title, nodeDiameter(nodeDetails.get(note.path)!.count)]),
        ]));
        const sameDimensions = previous?.dimensions.size === dimensions.size
          && [...dimensions].every(([id, value]) => previous.dimensions.get(id) === value);
        const graph = cytoscape({
          container: host.current, minZoom: .05, maxZoom: 5, pixelRatio: 'auto', selectionType: 'single',
          elements: [
            ...data.nodes.map(note => ({
              data: { id: note.path, label: note.title, incomingCount: nodeDetails.get(note.path)!.count,
                diameter: nodeDiameter(nodeDetails.get(note.path)!.count) },
              position: previous?.positions.get(note.path),
            })),
            ...data.edges.map((edge, i) => ({ data: { id: `edge-${i}`, ...edge } })),
          ],
          style: graphStyles(appearance.current.theme, appearance.current.reducedMotion),
          layout: { name: previous ? 'preset' : 'grid', fit: false },
        });
        cy.current = graph;
        setDetails(nodeDetails);
        interaction.current = bindGraphInteractions(graph, {
          onSelect: setSelected,
          onHover: info => { if (visible.current || info === null) setHover(info); },
          onOpen: id => open.current(id),
        });
        if (sameDimensions && previous) {
          graph.viewport({ zoom: previous.zoom, pan: previous.pan });
        } else {
          const next = graph.layout({ name: 'cose', animate: false, numIter: 300,
            randomize: !previous, fit: false, nodeDimensionsIncludeLabels: true,
            componentSpacing: 90, nodeRepulsion: () => 8000, idealEdgeLength: () => 120 });
          layout.current = next;
          next.run();
          separateGraphLabels(graph);
          fitGraph(graph);
        }
        interaction.current.select(previous?.selected ?? '');
        setMessage(t("{0} 篇笔记 · {1} 条关系{2}", data.nodes.length, data.edges.length, data.truncated ? t(' · 已按性能预算截断，请增加筛选条件') : ''));
      }).catch(error => { if (!disposed) setMessage(errorText(error)); });
    }, 200);
    return () => {
      disposed = true;
      clearTimeout(timer);
      interaction.current?.destroy(); interaction.current = null;
      layout.current?.stop(); layout.current = null;
      setHover(null);
      if (cy.current) {
        const graph = cy.current;
        snapshot.current = { query, zoom: graph.zoom(), pan: { ...graph.pan() },
          selected: graph.$('node:selected').first().id() ?? '',
          positions: new Map(graph.nodes().map(node => [node.id(), { ...node.position() }])),
          dimensions: new Map(graph.nodes().map(node => [node.id(), JSON.stringify([node.data('label'), node.data('diameter')])])),
        };
        graph.destroy(); cy.current = null;
      }
    };
  }, [query, revision]);

  useEffect(() => {
    cy.current?.style(graphStyles(theme, reducedMotion));
  }, [theme, reducedMotion]);

  useEffect(() => {
    if (!active) { interaction.current?.clearHover(); return; }
    const resize = () => {
      const graph = cy.current;
      if (graph) {
        const pan = { ...graph.pan() }, zoom = graph.zoom();
        interaction.current?.clearHover();
        graph.resize(); graph.viewport({ pan, zoom });
      }
    };
    const observer = new ResizeObserver(resize);
    if (host.current) observer.observe(host.current);
    resize();
    return () => observer.disconnect();
  }, [active]);

  useLayoutEffect(() => {
    if (!hover || !tooltip.current || !host.current) return;
    const placement = tooltipPosition(hover,
      { width: host.current.clientWidth, height: host.current.clientHeight },
      { width: tooltip.current.offsetWidth, height: tooltip.current.offsetHeight });
    tooltip.current.style.left = `${placement.left}px`;
    tooltip.current.style.top = `${placement.top}px`;
  }, [hover]);

  async function exportPng(full: boolean) {
    const graph = cy.current;
    if (!graph) return;
    try {
      graph.elements().addClass('exporting').stop(true, true);
      interaction.current?.clearHover();
      const data = graph.png({ full, scale: 1, maxWidth: 4096, maxHeight: 4096,
        bg: graphColors[theme === 'light' ? 'light' : 'dark'].background });
      graph.elements().removeClass('exporting');
      await workspace({ action: 'export_png', data });
    } catch (error) {
      if (!graph.destroyed()) graph.elements().removeClass('exporting');
      setMessage(errorText(error));
    }
  }

  const selectedDetails = details.get(selected);
  return <section className="graph-panel knowledge-graph" data-graph-theme={theme}>
    <div className="section-heading graph-heading">
      <div><p className="graph-eyebrow">{t("连接你的思考")}</p><h1>{center ? t("局部图谱") : t("知识星图")}</h1></div>
      <div className="graph-size-legend" title={t("按整个笔记库的不同引用来源计算；同一篇重复引用只计一次")}>
        <span className="legend-orbs" aria-hidden="true"><i/><i/><i/></span><span>{t("全库被引用笔记数")}</span>
      </div>
    </div>
    <div className="graph-stage" onMouseLeave={() => interaction.current?.clearHover()}>
      <div className="graph-canvas" ref={host} role="img" aria-label={t("笔记引用关系图，节点越大表示被更多笔记引用")}/>
      <div className="graph-stage-caption" aria-hidden="true"><span/> {center ? t("局部连接") : t("全局连接")}</div>
      {hover && <div className="graph-tooltip" ref={tooltip} role="tooltip">
        <strong>{hover.title}</strong><span>{hover.id}</span><em>{t("被")} {hover.count} {t("篇笔记引用 · 全库统计")}</em>
      </div>}
      <div className="graph-controls" aria-label={t("图谱操作")}>
        <button disabled={!native} onClick={() => { if (cy.current) fitGraph(cy.current); }}>{t("适应视图")}</button>
        <button disabled={!native} onClick={() => layout.current?.stop()}>{t("停止布局")}</button>
        <span className="graph-control-divider" aria-hidden="true"/>
        <button disabled={!native} onClick={() => void exportPng(false)}>{t("导出当前视野")}</button>
        <button disabled={!native} onClick={() => void exportPng(true)}>{t("导出完整图谱")}</button>
      </div>
    </div>
    <div className="graph-overlay">
      {selectedDetails ? <div className="graph-selection"><span><strong>{selectedDetails.title}</strong><small title={selected}>{selected} {t("· 被")} {selectedDetails.count} {t("篇笔记引用")}</small></span><button onClick={() => onOpen(selected)}>{t("打开笔记 ↗")}</button></div>
        : <span className="graph-gesture-hint">{t("悬停探索关联 · 单击选中 · 双击打开笔记")}</span>}
      <p className="graph-status" role="status">{t(message)}</p>
    </div>
  </section>;
}
