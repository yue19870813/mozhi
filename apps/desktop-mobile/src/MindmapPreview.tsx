import { useMemo, useRef, useState } from 'react';
import { t, useLanguage } from './i18n';
import { markdownMindmap, mindmapLayout } from './mindmap';

export function MindmapPreview({ content, title }: { content: string; title: string }) {
  useLanguage();
  const tree = useMemo(() => markdownMindmap(content, title), [content, title]);
  // Remount the interactive canvas on content changes so old collapsed IDs cannot hide new branches.
  return <MindmapCanvas key={content + '\0' + title} tree={tree}/>;
}
function MindmapCanvas({ tree }: { tree: ReturnType<typeof markdownMindmap> }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // Long notes start with the main branches visible instead of unreadably tiny text.
    const all = mindmapLayout(tree, new Set()).nodes;
    return new Set(all.length > 30 ? tree.children.filter(node => node.children.length).map(node => node.id) : []);
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const layout = useMemo(() => mindmapLayout(tree, collapsed), [tree, collapsed]);
  const positions = new Map(layout.nodes.map(n => [n.node.id, n]));
  function toggle(id: string) {
    setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function scale(factor: number) { setZoom(value => Math.max(0.2, Math.min(40, value * factor))); }
  return <section className="mindmap-preview" aria-label={t('脑图预览')}>
    <div className="mindmap-toolbar">
      <button onClick={() => scale(1.25)} aria-label={t('放大脑图')}>＋</button>
      <button onClick={() => scale(0.8)} aria-label={t('缩小脑图')}>−</button>
      <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{t('适应视图')}</button>
      <button onClick={() => setCollapsed(new Set())}>{t('展开全部')}</button>
      <span>{t('拖动画布移动，点击分支折叠或展开')}</span>
    </div>
    <svg className="mindmap-canvas" aria-label={t('脑图预览')} viewBox={`0 0 ${layout.width} ${layout.height}`}
      onPointerDown={event => { if (event.button !== 0 || (event.target as Element).closest('[role="button"]')) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!drag.current) return; const rect = event.currentTarget.getBoundingClientRect(); const ratio = Math.max(layout.width / rect.width, layout.height / rect.height); const dx = (event.clientX - drag.current.x) * ratio; const dy = (event.clientY - drag.current.y) * ratio; setPan(p => ({ x: p.x + dx, y: p.y + dy })); drag.current = { x: event.clientX, y: event.clientY }; }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <g transform={`translate(${layout.width / 2 + pan.x} ${layout.height / 2 + pan.y}) scale(${zoom}) translate(${-layout.width / 2} ${-layout.height / 2})`}>
        {layout.nodes.filter(n => n.parent).map(n => { const parent = positions.get(n.parent!)!; return <path className="mindmap-edge" key={n.node.id} d={`M${parent.x + 260},${parent.y} C${parent.x + 290},${parent.y} ${n.x - 30},${n.y} ${n.x},${n.y}`}/>; })}
        {layout.nodes.map(({ node, x, y, height, lines }) => <g key={node.id} transform={`translate(${x} ${y})`} className="mindmap-node" role={node.children.length ? 'button' : undefined} tabIndex={node.children.length ? 0 : undefined} aria-label={node.label} aria-expanded={node.children.length ? !collapsed.has(node.id) : undefined} onClick={() => { if (node.children.length) toggle(node.id); }} onKeyDown={event => { if (node.children.length && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(node.id); } }}>
          <title>{node.label}</title><rect y={-height / 2} width="260" height={height} rx="8"/>
          <text x="12" y={-(lines.length - 1) * 10}>
            {lines.map((line, index) => <tspan key={index} x="12" dy={index ? 20 : 0}>{line}</tspan>)}
          </text>
          {node.children.length > 0 && <text className="mindmap-toggle" x="242" y="5" textAnchor="middle">{collapsed.has(node.id) ? '+' : '−'}</text>}
        </g>)}
      </g>
    </svg>
  </section>;
}
