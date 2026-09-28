import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type Layouts } from 'cytoscape';
import { workspace, errorText, native, type ParsedNote } from './api';
import type { GraphFilterState } from './GraphFilters';
type Data = { nodes: ParsedNote[]; edges: { source: string; target: string; count: number }[]; truncated: boolean };
export function KnowledgeGraph({ current, revision, onOpen, active, filters, theme }: {
  current: string; revision: number; onOpen: (path: string) => void; active: boolean; filters: GraphFilterState; theme: string;
}) {
  const host = useRef<HTMLDivElement>(null), cy = useRef<Core | null>(null), layout = useRef<Layouts | null>(null);
  const [message, setMessage] = useState(''), [selected, setSelected] = useState('');
  const open = useRef(onOpen); open.current = onOpen;
  const snapshot = useRef<{ query: string; zoom: number; pan: {x:number;y:number}; selected: string; positions: Map<string,{x:number;y:number}> } | null>(null);
  const center = filters.scope === 'local' ? current : null;
  const query = JSON.stringify({ center, depth: filters.depth, tag: filters.tag, directory: filters.directory, keyword: filters.keyword, includeIsolated: filters.isolated });
  useEffect(() => {
    if (!native) { setMessage('知识图谱需要桌面应用；浏览器仅提供编辑界面演示。'); return; }
    let disposed = false;
    const timer = setTimeout(() => {
      workspace<Data>({action:'graph', query:JSON.parse(query)}).then(data => {
        if (disposed || !host.current) return;
        const saved = snapshot.current?.query === query ? snapshot.current : null;
        const styles = getComputedStyle(document.documentElement);
        const graph = cytoscape({container:host.current,elements:[...data.nodes.map(n=>({data:{id:n.path,label:n.title},position:saved?.positions.get(n.path)})),...data.edges.map((e,i)=>({data:{id:`edge-${i}`,source:e.source,target:e.target,count:e.count}}))],
          minZoom:.05,maxZoom:5,pixelRatio:1,
          style:[{selector:'node',style:{width:12,height:12,'background-color':styles.getPropertyValue('--accent').trim(),label:'data(label)','font-size':12,color:styles.getPropertyValue('--text').trim(),'text-valign':'bottom','text-margin-y':7}},{selector:'edge',style:{width:1,'line-color':styles.getPropertyValue('--muted').trim(),opacity:.45,'curve-style':'bezier','target-arrow-shape':'triangle','target-arrow-color':styles.getPropertyValue('--muted').trim(),'arrow-scale':.6}},{selector:'node:selected',style:{'border-width':3,'border-color':styles.getPropertyValue('--text').trim(),width:20,height:20}},{selector:'.muted',style:{opacity:.18}}],layout:{name:saved?'preset':'grid'}});
        cy.current=graph;
        function highlight(id:string) {
          const node=graph.getElementById(id);graph.elements().removeClass('muted');
          if(node.length){graph.elements().not(node.closedNeighborhood()).addClass('muted');node.select();setSelected(id);}else setSelected('');
        }
        graph.on('tap','node',event=>highlight(event.target.id()));
        graph.on('dbltap','node',event=>open.current(event.target.id()));
        graph.on('zoom',()=>{graph.style().selector('node').style('label',graph.zoom()<.45?'':'data(label)').update();});
        if(saved){graph.zoom(saved.zoom);graph.pan(saved.pan);highlight(saved.selected);}
        else {setSelected('');const next=graph.layout({name:'cose',animate:false,numIter:120,randomize:true,padding:40});layout.current=next;next.run();}
        setMessage(`${data.nodes.length} 篇笔记 · ${data.edges.length} 条关系${data.truncated?' · 已按性能预算截断，请增加筛选条件':''}`);
      }).catch(e=>{if(!disposed)setMessage(errorText(e));});
    }, 200);
    return()=>{
      disposed=true;clearTimeout(timer);layout.current?.stop();
      if(cy.current){const graph=cy.current;snapshot.current={query,zoom:graph.zoom(),pan:graph.pan(),selected:graph.$('node:selected').first().id()??'',positions:new Map(graph.nodes().map(node=>[node.id(),{...node.position()}]))};graph.destroy();cy.current=null;}
    };
  },[query,revision,theme]);
  useEffect(()=>{
    if(!active)return;
    const resize=()=>{const graph=cy.current;if(graph){const pan={...graph.pan()},zoom=graph.zoom();graph.resize();graph.viewport({pan,zoom});}};
    const observer=new ResizeObserver(resize);if(host.current)observer.observe(host.current);resize();
    return()=>observer.disconnect();
  },[active]);
  async function exportPng(full:boolean) {try {if(cy.current) await workspace({action:'export_png',data:cy.current.png({full,scale:1,maxWidth:4096,maxHeight:4096,bg:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()})});}catch(e){setMessage(errorText(e));}}
  return <section className="graph-panel"><div className="section-heading"><h1>{center?'局部图谱':'全局图谱'}</h1></div>
    <div className="graph-canvas" ref={host} role="img" aria-label="笔记引用关系图"/>
    <div className="graph-overlay">单击查看关联 · 双击打开笔记 {selected&&<button onClick={()=>onOpen(selected)}>打开 {selected}</button>}</div>
    <div className="graph-controls"><button disabled={!native} onClick={()=>cy.current?.fit(undefined,40)}>适应视图</button><button disabled={!native} onClick={()=>layout.current?.stop()}>停止布局</button><button disabled={!native} onClick={()=>void exportPng(false)}>导出当前视野</button><button disabled={!native} onClick={()=>void exportPng(true)}>导出完整图谱</button></div><p className="graph-status" role="status">{message}</p>
  </section>;
}
