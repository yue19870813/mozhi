import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type Layouts } from 'cytoscape';
import { workspace, errorText, type ParsedNote } from './api';
type Data = { nodes: ParsedNote[]; edges: { source: string; target: string; count: number }[]; truncated: boolean };
export function KnowledgeGraph({ current, notes, revision, onOpen }: { current: string; notes: ParsedNote[]; revision: number; onOpen: (path: string) => void }) {
  const host = useRef<HTMLDivElement>(null), cy = useRef<Core | null>(null), layout = useRef<Layouts | null>(null);
  const [scope,setScope] = useState('global'), [depth,setDepth] = useState(1), [tag,setTag] = useState(''), [directory,setDirectory] = useState(''), [keyword,setKeyword] = useState(''), [isolated,setIsolated] = useState(true), [message,setMessage] = useState(''), [selected,setSelected] = useState('');
  const open = useRef(onOpen); open.current = onOpen;
  useEffect(() => {
    let disposed = false;
    workspace<Data>({action:'graph',query:{center:scope==='local'?current:null,depth,tag,directory,keyword,includeIsolated:isolated}}).then(data => {
      if (disposed || !host.current) return;
      const graph=cytoscape({container:host.current,elements:[...data.nodes.map(n=>({data:{id:n.path,label:n.title}})),...data.edges.map((e,i)=>({data:{id:`edge-${i}`,source:e.source,target:e.target,count:e.count}}))],
        minZoom:.05,maxZoom:5,pixelRatio:1,
        style:[{selector:'node',style:{width:12,height:12,'background-color':'#78a9e9',label:'data(label)','font-size':11,color:'#a7b4c5','text-valign':'bottom','text-margin-y':7}},{selector:'edge',style:{width:1,'line-color':'#526b86',opacity:.45,'curve-style':'bezier','target-arrow-shape':'triangle','target-arrow-color':'#526b86','arrow-scale':.6}},{selector:'node:selected',style:{'background-color':'#e7b973','border-width':3,'border-color':'#fff',width:20,height:20}},{selector:'.neighbor',style:{'background-color':'#96d5bd'}},{selector:'.muted',style:{opacity:.18}}],layout:{name:'grid'}});
      cy.current=graph;
      graph.on('tap','node',event=>{const node=event.target;setSelected(node.id());graph.elements().removeClass('neighbor muted');graph.elements().not(node.closedNeighborhood()).addClass('muted');node.neighborhood('node').addClass('neighbor');});
      graph.on('dbltap','node',event=>open.current(event.target.id()));
      graph.on('zoom',()=>{graph.style().selector('node').style('label',graph.zoom()<.45?'':'data(label)').update();});
      const next=graph.layout({name:'cose',animate:true,animationThreshold:0,refresh:10,numIter:120,randomize:true,padding:40});layout.current=next;next.run();
      setMessage(`${data.nodes.length} 篇笔记 · ${data.edges.length} 条关系${data.truncated?' · 已按性能预算截断，请增加筛选条件':''}`);
    }).catch(e=>{if(!disposed)setMessage(errorText(e));});
    return()=>{disposed=true;layout.current?.stop();cy.current?.destroy();cy.current=null;};
  },[scope,current,depth,tag,directory,keyword,isolated,revision]);
  async function exportPng(full:boolean) {try {if(cy.current) await workspace({action:'export_png',data:cy.current.png({full,scale:1,maxWidth:4096,maxHeight:4096,bg:'#17191d'})});}catch(e){setMessage(errorText(e));}}
  return <section className="graph-panel"><div className="section-heading"><div><p className="eyebrow">KNOWLEDGE, CONNECTED</p><h1>笔记之间，自有联系</h1></div><select aria-label="图谱范围" value={scope} onChange={e=>setScope(e.target.value)}><option value="global">全局图谱</option><option value="local" disabled={!current}>当前笔记局部图谱</option></select></div>
    <div className="workspace-toolbar"><input aria-label="图谱关键词" placeholder="标题或路径筛选" value={keyword} onChange={e=>setKeyword(e.target.value)}/><input aria-label="图谱目录" placeholder="目录筛选" value={directory} onChange={e=>setDirectory(e.target.value)}/><select aria-label="图谱标签" value={tag} onChange={e=>setTag(e.target.value)}><option value="">所有标签</option>{[...new Set(notes.flatMap(n=>n.tags))].map(t=><option key={t}>{t}</option>)}</select>{scope==='local'&&<select aria-label="关系深度" value={depth} onChange={e=>setDepth(Number(e.target.value))}><option value={1}>一跳</option><option value={2}>两跳</option></select>}<label><input type="checkbox" checked={isolated} onChange={e=>setIsolated(e.target.checked)}/>孤立笔记</label></div>
    <div className="graph-canvas" ref={host}/><div className="graph-overlay"><span className="dot"/>笔记 <span className="legend-line"/>有向引用 · 双击打开 {selected&&<button onClick={()=>onOpen(selected)}>打开 {selected}</button>}</div>
    <div className="graph-controls"><button onClick={()=>cy.current?.fit(undefined,40)}>适应视图</button><button onClick={()=>layout.current?.stop()}>停止布局</button><button onClick={()=>void exportPng(false)}>导出当前视野</button><button onClick={()=>void exportPng(true)}>导出完整图谱</button></div><p className="graph-status" role="status">{message}</p>
  </section>;
}
