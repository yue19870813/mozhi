import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type Layouts } from 'cytoscape';
import { graphData, graphPresets } from './graph-data';
export function Graph() {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const layout = useRef<Layouts | null>(null);
  const frame = useRef(0);
  const [preset, setPreset] = useState(0);
  const [status, setStatus] = useState('准备图谱');
  const [running, setRunning] = useState(false);
  const [measurement, setMeasurement] = useState<object | null>(null);
  const [selected, setSelected] = useState('');
  useEffect(() => {
    const start = performance.now();
    const { nodes, edges } = graphPresets[preset];
    const instance = cytoscape({ container: container.current!, elements: graphData(nodes, edges), pixelRatio: 1, minZoom: 0.03, maxZoom: 6,
      style: [
        { selector: 'node', style: { width: 8, height: 8, 'background-color': '#6da8ea', label: '', 'font-size': 11, color: '#e5e9f0', 'text-valign': 'bottom', 'text-margin-y': 8 } },
        { selector: 'node[group = 1]', style: { 'background-color': '#a69ae4' } },
        { selector: 'node[group = 2]', style: { 'background-color': '#73c7b0' } },
        { selector: 'node[group = 3]', style: { 'background-color': '#d5b677' } },
        { selector: 'edge', style: { width: 0.6, 'line-color': '#597391', opacity: 0.23, 'curve-style': 'haystack' } },
        { selector: 'node:selected', style: { width: 16, height: 16, label: 'data(label)', 'background-color': '#ffffff', 'border-width': 3, 'border-color': '#6da8ea' } },
      ], layout: { name: 'grid', padding: 40 },
    });
    cy.current = instance;
    instance.on('tap', 'node', event => setSelected(`${event.target.data('label')} · ${event.target.degree()} 条连接（合成样本）`));
    setMeasurement(null); setSelected(''); setRunning(false);
    frame.current = requestAnimationFrame(() => { setStatus(`已加载 ${nodes.toLocaleString()} 个节点 · ${edges.toLocaleString()} 条边，初始化 ${(performance.now() - start).toFixed(0)} ms`); });
    return () => { cancelAnimationFrame(frame.current); layout.current?.stop(); layout.current = null; instance.destroy(); cy.current = null; };
  }, [preset]);
  function forceLayout() {
    const instance = cy.current!;
    setRunning(true); setStatus('正在计算力导向布局，可随时停止');
    const started = performance.now();
    const current = instance.layout({ name: 'cose', animate: true, animationThreshold: 0, refresh: 10, numIter: 150, randomize: true, fit: true, padding: 45, nodeRepulsion: () => 4500, idealEdgeLength: () => 65 });
    layout.current = current;
    current.one('layoutstop', () => {
      setRunning(false);
      setStatus(`布局已停止 · ${(performance.now() - started).toFixed(0)} ms`);
      setMeasurement({ ...graphPresets[preset], layoutMs: performance.now() - started, renderer: 'Cytoscape canvas', algorithm: 'cose', maxIterations: 150, userAgent: navigator.userAgent });
    });
    current.run();
  }
  function measure() {
    const instance = cy.current!;
    layout.current?.stop(); setRunning(true); setStatus('正在采样 180 帧缩放与平移，请保持窗口在前台');
    const initialPan = { ...instance.pan() }, initialZoom = instance.zoom();
    const times: number[] = [];
    let previous = 0, started = 0;
    const tick = (now: number) => {
      if (document.hidden) { setRunning(false); setStatus('窗口失去前台，采样已取消'); return; }
      if (!started) started = now;
      if (previous) times.push(now - previous);
      previous = now;
      const phase = times.length / 20;
      instance.viewport({ zoom: initialZoom * (1 + 0.12 * Math.sin(phase)), pan: { x: initialPan.x + Math.sin(phase) * 40, y: initialPan.y + Math.cos(phase) * 30 } });
      if (times.length < 180 && now - started < 15000) { frame.current = requestAnimationFrame(tick); return; }
      instance.viewport({ zoom: initialZoom, pan: initialPan });
      const sorted = [...times].sort((a,b) => a-b);
      const fps = 1000 / (times.reduce((a,b) => a+b, 0) / times.length);
      const p95FrameMs = sorted[Math.ceil(sorted.length * 0.95) - 1];
      setMeasurement({ ...graphPresets[preset], fps, p95FrameMs, sampledFrames: times.length, durationMs: now - started, pixelRatio: 1, viewport: { width: container.current?.clientWidth, height: container.current?.clientHeight }, userAgent: navigator.userAgent, timestamp: new Date().toISOString(), method: 'requestAnimationFrame + scripted pan/zoom; not GPU render timing' });
      setStatus(`平移 / 缩放 ${fps.toFixed(1)} FPS · 帧间隔 p95 ${p95FrameMs.toFixed(1)} ms`); setRunning(false);
    };
    frame.current = requestAnimationFrame(tick);
  }
  return <section className="graph-panel">
    <div className="section-heading"><div><p className="eyebrow">KNOWLEDGE, CONNECTED</p><h1>让关联浮现</h1><p className="subtle">可复现的合成图谱，用于确定显示预算。</p></div><select aria-label="图谱规模" value={preset} disabled={running} onChange={e => setPreset(Number(e.target.value))}>{graphPresets.map((p,i) => <option key={p.nodes} value={i}>{p.label}</option>)}</select></div>
    <div className="graph-canvas" ref={container} aria-label="图谱性能样本" />
    <div className="graph-overlay"><span className="dot"/> 笔记节点 <span className="legend-line"/> 显式引用 <span>颜色仅区分合成分组</span></div>
    {selected && <div className="node-card">{selected}</div>}
    <div className="graph-controls"><button onClick={() => cy.current?.fit(undefined, 40)}>适应视图</button><button disabled={running} onClick={forceLayout}>力导向布局</button><button disabled={running} onClick={measure}>测量缩放帧率</button>{running && <button onClick={() => { cancelAnimationFrame(frame.current); layout.current?.stop(); setRunning(false); setStatus('已手动停止，本轮结果不用于验收'); setMeasurement(null); }}>停止</button>}</div>
    <p className="graph-status" role="status">{status}</p>
    {measurement && <details className="graph-report"><summary>查看测量记录</summary><textarea aria-label="图谱测量记录" readOnly value={JSON.stringify(measurement, null, 2)}/></details>}
  </section>;
}
