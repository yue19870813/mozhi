import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAttachmentImage } from './attachment-image';
import { t, useLanguage } from './i18n';
import { markdownMindmap, mindmapLayout } from './mindmap';

export function MindmapPreview({ content, title, path = '' }: { content: string; title: string; path?: string }) {
  useLanguage();
  const tree = useMemo(() => markdownMindmap(content, title, path), [content, title, path]);
  // Remount the interactive canvas on content changes so old collapsed IDs cannot hide new branches.
  return <MindmapCanvas key={path + '\0' + content + '\0' + title} tree={tree} path={path}/>;
}
function ImageViewer({ image, close }: { image: { url: string; alt: string }; close: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    button.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') { event.preventDefault(); button.current?.focus(); }
    }
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (previous instanceof HTMLElement || previous instanceof SVGElement) previous.focus();
    };
  }, [close]);
  return createPortal(<div className="mindmap-image-viewer" role="dialog" aria-modal="true" aria-label={t('图片预览')}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <button ref={button} className="mindmap-image-close" onClick={close} aria-label={t('关闭图片预览')}>×</button>
    <img src={image.url} alt={image.alt || t('图片附件')}/>
  </div>, document.body);
}
function ImageThumbnail({ path, image, y, open }: { path: string; image: { url: string; alt: string }; y: number; open: (image: { url: string; alt: string }) => void }) {
  const url = useAttachmentImage(path, image.url);
  const [failed, setFailed] = useState(false);
  return url && !failed ? <image className="mindmap-thumbnail" href={url} x="12" y={y} width="224" height="120" preserveAspectRatio="xMidYMid meet"
    role="button" tabIndex={0} aria-label={t('查看图片：{0}', image.alt || t('图片附件'))}
    onError={() => setFailed(true)} onClick={event => { event.stopPropagation(); open({ url, alt: image.alt }); }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); open({ url, alt: image.alt }); } }}/>
    : <text x="12" y={y + 60}>{t('图片附件：')}{image.alt || t('不可用')}</text>;
}
function MindmapCanvas({ tree, path }: { tree: ReturnType<typeof markdownMindmap>; path: string }) {
  const [preview, setPreview] = useState<{ url: string; alt: string } | null>(null);
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
          <text x="12" y={-height / 2 + 24}>
            {lines.map((line, index) => <tspan key={index} x="12" dy={index ? 20 : 0}>{line}</tspan>)}
          </text>
          {node.images?.map((image, index) => <ImageThumbnail key={`${index}:${image.url}`} path={path} image={image} y={-height / 2 + lines.length * 20 + 16 + index * 132} open={setPreview}/>)}
          {node.children.length > 0 && <text className="mindmap-toggle" x="242" y="5" textAnchor="middle">{collapsed.has(node.id) ? '+' : '−'}</text>}
        </g>)}
      </g>
    </svg>
    {preview && <ImageViewer image={preview} close={() => setPreview(null)}/>}
  </section>;
}
