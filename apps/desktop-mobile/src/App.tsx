import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { api, errorText, native, selectVault, workspace, type ParsedNote, type SearchResult, type Vault } from './api';
import { DocumentSession } from './session';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { platform } from './platform';
import { SyncPanel } from './SyncPanel';
const KnowledgeGraph=lazy(()=>import('./KnowledgeGraph').then(m=>({default:m.KnowledgeGraph})));
const ProbeGraph=lazy(()=>import('./Graph').then(m=>({default:m.Graph})));
type Tab='notes'|'graph'|'sync'|'recovery'|'lab';
type TreeEntry={path:string;isDirectory:boolean;isAttachment?:boolean};
type Recovery={id:string;kind:string;source:string;destination:string|null;completed:boolean};
type Modal={kind:'note'|'directory'|'move'|'delete';source:string;value:string};
export default function App(){
  const [vault,setVault]=useState<Vault|null>(null),[path,setPath]=useState(''),[content,setContent]=useState('');
  const [tab,setTab]=useState<Tab>('notes'),[mode,setMode]=useState<'source'|'split'|'preview'>('split');
  const [theme,setTheme]=useState(localStorage.getItem('mozhi-theme')??'dark'),[status,setStatus]=useState('打开笔记库'),[error,setError]=useState(''),[busy,setBusy]=useState(true),[composing,setComposing]=useState(false);
  const [recovery,setRecovery]=useState<string|null>(null),[recoveries,setRecoveries]=useState<Recovery[]>([]),[modal,setModal]=useState<Modal|null>(null);
  const [syncBlocked,setSyncBlocked]=useState(false);
  const [query,setQuery]=useState(''),[tag,setTag]=useState(''),[directory,setDirectory]=useState(''),[filenameOnly,setFilenameOnly]=useState(false),[results,setResults]=useState<SearchResult|null>(null);
  const [tree,setTree]=useState<TreeEntry[]>([]),[notes,setNotes]=useState<ParsedNote[]>([]),[revision,setRevision]=useState(0),[collapsed,setCollapsed]=useState<Set<string>>(new Set());
  const [history,setHistory]=useState<{id:string;message:string;timestamp:number}[]|null>(null),[historical,setHistorical]=useState<string|null>(null),[report,setReport]=useState<unknown>(null),[longSample,setLongSample]=useState('');
  const session=useRef<DocumentSession|null>(null),searchField=useRef<HTMLInputElement>(null),initialized=useRef(false),operation=useRef(false),isComposing=useRef(false),vaultRef=useRef<Vault|null>(null);
  const current=notes.find(n=>n.path===path), tags=[...new Set(notes.flatMap(n=>n.tags))].sort();
  const updateKnowledge=useCallback(async()=>{if(!native)return;const id=vaultRef.current?.id;const [entries,parsed]=await Promise.all([workspace<TreeEntry[]>({action:'tree'}),workspace<ParsedNote[]>({action:'knowledge'})]);if(id===vaultRef.current?.id){setTree(entries);setNotes(parsed);setRevision(r=>r+1);const state=await workspace<{phase:string}>({action:'sync_state'});setSyncBlocked(state.phase==='conflict');}},[]);
  const loadNote=useCallback(async(next:string)=>{
    const note=await api.read(next),draft=await api.readDraft(next);
    session.current=new DocumentSession(note,api.save,setError);setPath(next);setContent(note.content);setRecovery(draft!==null&&draft!==note.content?draft:null);setStatus(native?'已保存到本机':'浏览器内存演示');setHistory(null);setHistorical(null);
  },[]);
  const adopt=useCallback(async(opened:Vault)=>{
    selectVault(opened.id);vaultRef.current=opened;setVault(opened);setQuery('');setTag('');setDirectory('');session.current=null;setPath('');setContent('');setRecovery(null);setNotes([]);setTree([]);setCollapsed(new Set());
    const first=opened.entries.find(e=>e.path==='欢迎使用.md'&&!opened.skipped.includes(e.path))??opened.entries.find(e=>!opened.skipped.includes(e.path));
    if(first)await loadNote(first.path);else setStatus('此目录暂无笔记，点击新建笔记开始');
    await updateKnowledge();if(opened.skipped.length)setError(`未读取的笔记：${opened.skipped.join('、')}`);
  },[loadNote,updateKnowledge]);
  const flush=useCallback(async()=>{
    const current=session.current;if(!current?.dirty)return;setStatus('正在保存…');
    try{await current.flush();if(current===session.current){setStatus(native?'已保存到本机':'已更新演示内容');await updateKnowledge();}}
    catch(e){setStatus('保存未完成');setError(errorText(e));throw e;}
  },[updateKnowledge]);
  async function run<T>(action:()=>Promise<T>):Promise<T|undefined>{
    if(operation.current||isComposing.current)return;operation.current=true;setBusy(true);setError('');setStatus('正在处理…');
    try{await flush();return await action();}catch(e){setError(errorText(e));return undefined;}finally{operation.current=false;setBusy(false);setStatus(native?'本地工作区就绪':'浏览器内存演示');}
  }
  async function reload(){
    if(!native)return;
    const opened=await workspace<Vault>({action:'refresh'});setVault(opened);vaultRef.current=opened;
    const previous=session.current?.note.path;
    if(previous&&opened.entries.some(e=>e.path===previous)){const disk=await api.read(previous);if(disk.contentHash!==session.current?.note.contentHash)await loadNote(previous);}
    else {session.current=null;setPath('');setContent('');setRecovery(null);}
    await updateKnowledge();
  }
  useEffect(()=>{if(initialized.current)return;initialized.current=true;api.openDemo().then(adopt).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));},[adopt]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('mozhi-theme',theme);},[theme]);
  useEffect(()=>{
    if(!session.current?.dirty||composing||busy)return;
    const current=session.current;
    const draftTimer=setTimeout(()=>{api.draft(current.note.path,current.text).catch(e=>setError(`草稿写入失败：${errorText(e)}`));},250);
    const saveTimer=setTimeout(()=>{void flush().catch(()=>{});},750);
    return()=>{clearTimeout(draftTimer);clearTimeout(saveTimer);};
  },[content,composing,busy,flush]);
  useEffect(()=>{
    let active=true;if(!query.trim()&&!tag&&!directory){setResults(null);return;}
    const timer=setTimeout(()=>{
      const request=native?workspace<SearchResult>({action:'search',query,directory,tag,filenameOnly}):api.search(query,directory);
      request.then(result=>{if(active)setResults(result);}).catch(e=>{if(active)setError(errorText(e));});
    },200);return()=>{active=false;clearTimeout(timer);};
  },[query,tag,directory,filenameOnly,revision,vault]);
  useEffect(()=>{
    if(!native)return;let disposed=false;const stops:(()=>void)[]=[];
    const keep=(stop:()=>void)=>{if(disposed)stop();else stops.push(stop);};
    getCurrentWindow().onCloseRequested(async event=>{event.preventDefault();if(operation.current||isComposing.current){setError('请等待当前操作或中文组合输入结束后再关闭');return;}try{await flush();await getCurrentWindow().destroy();}catch{setError('保存未完成，请先协调磁盘版本与恢复草稿');}}).then(keep);
    listen<{vaultId:string;phase:string}>('sync_state_changed',event=>{if(event.payload.vaultId===vaultRef.current?.id){const labels:Record<string,string>={committing:'正在提交',fetching:'正在获取远程更新',integrating:'正在合并',pushing:'正在推送'};setStatus(labels[event.payload.phase]??event.payload.phase);}}).then(keep);
    return()=>{disposed=true;stops.forEach(stop=>stop());};
  },[flush]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!event.isComposing&&!operation.current)void flush().catch(()=>{});}
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchField.current?.focus();}
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n'&&!event.isComposing){event.preventDefault();setModal({kind:'note',source:'',value:'新笔记.md'});}
    };
    const hide=()=>{const current=session.current;if(document.hidden&&current?.dirty&&!operation.current)void api.draft(current.note.path,current.text).catch(()=>{});};
    document.addEventListener('keydown',handler);document.addEventListener('visibilitychange',hide);
    return()=>{document.removeEventListener('keydown',handler);document.removeEventListener('visibilitychange',hide);};
  },[flush]);
  // Reconcile external edits on focus. Never replace a dirty editor with disk contents.
  useEffect(()=>{
    const focus=()=>{if(native&&!operation.current&&!isComposing.current&&!session.current?.dirty)void run(reload);};
    window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);
  });
  function change(value:string){if(!session.current)return;session.current.text=value;setContent(value);setStatus(session.current.dirty?'待保存…':native?'已保存到本机':'浏览器内存演示');}
  function composition(active:boolean){isComposing.current=active;setComposing(active);}
  async function navigate(next:string){await run(async()=>{await loadNote(next);setTab('notes');});}
  async function submitModal(){
    if(!modal)return;const m=modal;
    await run(async()=>{
      if(m.kind==='note'||m.kind==='directory'){const opened=await workspace<Vault>({action:'create',path:m.value,directory:m.kind==='directory'});setVault(opened);await updateKnowledge();if(m.kind==='note'){await loadNote(m.value);setTab('notes');}}
      else if(m.kind==='move'){await workspace({action:'move',from:m.source,to:m.value});const next=path===m.source||path.startsWith(`${m.source}/`)?`${m.value}${path.slice(m.source.length)}`:path;await reload();if(next)await loadNote(next);}
      else{await workspace({action:'delete',path:m.source});await reload();}
      setModal(null);
    });
  }
  async function importImage(){await run(async()=>{const attachment=await workspace<string|null>({action:'import_image'});if(attachment){const depth=path.split('/').length-1;change(`${session.current!.text}\n\n![图片](${'../'.repeat(depth)}${attachment})\n`);}});}
  function link(target:string,wiki=false){
    if(wiki){const reference=current?.references.find(r=>r.wiki&&r.raw===target);if(reference?.target){void navigate(reference.target);return;}setError(reference?.resolution==='ambiguous'?`同名笔记存在歧义：${target}`:`链接目标不存在：${target}`);return;}
    const parts=path.split('/').slice(0,-1);for(const part of target.split('#')[0].split('/')){if(part==='..'){if(!parts.length)return;parts.pop();}else if(part&&part!=='.')parts.push(part);}
    const resolved=parts.join('/');if(vault?.entries.some(e=>e.path===resolved))void navigate(resolved);else setError(`未找到链接目标：${target}`);
  }
  useEffect(()=>{
    if(!native||!vault)return;let last='';let disposed=false;let checking=false;
    const timer=setInterval(async()=>{
      if(document.hidden||operation.current||isComposing.current||checking)return;checking=true;
      try{const fingerprint=await workspace<string>({action:'fingerprint'});if(disposed)return;
        if(last&&last!==fingerprint){if(session.current?.dirty){setError('检测到外部文件修改。当前草稿已保留，请保存时协调版本。');return;}await run(reload);}
        last=fingerprint;
      }catch(e){if(!disposed)setError(errorText(e));}finally{checking=false;}
    },5000);
    return()=>{disposed=true;clearInterval(timer);};
  },[vault?.id]);
  useEffect(()=>{
    if(!native||!vault)return;let disposed=false;let changed=false;let stop:(()=>void)|undefined;
    listen<{vaultId:string}>('vault_files_changed',event=>{if(event.payload.vaultId===vault.id)changed=true;}).then(unlisten=>{if(disposed)unlisten();else stop=unlisten;});
    const timer=setInterval(()=>{
      if(!changed||document.hidden||operation.current||isComposing.current)return;
      if(session.current?.dirty){setError('检测到外部文件变化，当前编辑内容不会被覆盖；保存时将核对版本。');return;}
      changed=false;void run(reload);
    },1000);
    return()=>{disposed=true;clearInterval(timer);stop?.();};
  },[vault?.id]);
  const title=current?.title??content.match(/^# (.+)$/m)?.[1]??path.replace(/\.md$/i,'');
  const visibleTree=(native?tree:vault?.entries.map(e=>({...e,isDirectory:false,isAttachment:false}))??[]).filter(e=>![...collapsed].some(folder=>e.path.startsWith(`${folder}/`)));
  return <div className="app-shell"><aside className="sidebar">
    <div className="brand"><span className="brand-mark">墨</span><span>墨知<small>MOZHI</small></span><span className="phase">MVP</span></div>
    <div className="search-box"><span>⌕</span><input ref={searchField} aria-label="搜索笔记" placeholder="搜索 / tag:工作" value={query} onChange={e=>setQuery(e.target.value)}/><kbd>{platform.modifier} K</kbd></div>
    <div className="search-filters"><select aria-label="搜索标签" value={tag} onChange={e=>setTag(e.target.value)}><option value="">所有标签</option>{tags.map(t=><option key={t}>{t}</option>)}</select><select aria-label="搜索目录" value={directory} onChange={e=>setDirectory(e.target.value)}><option value="">所有目录</option>{tree.filter(e=>e.isDirectory).map(e=><option key={e.path}>{e.path}</option>)}</select><label><input type="checkbox" checked={filenameOnly} onChange={e=>setFilenameOnly(e.target.checked)}/>仅文件名</label></div>
    <nav aria-label="主导航">{([['notes','▤','我的笔记'],['graph','⌘','知识图谱'],['sync','↻','同步与恢复'],['recovery','↶','恢复记录'],['lab','◈','技术验证']] as const).map(([key,icon,label])=><button key={key} className={tab===key?'nav-item active':'nav-item'} disabled={composing||busy} onClick={()=>{setTab(key);if(key==='recovery')void run(async()=>setRecoveries(await workspace<Recovery[]>({action:'recoveries'})));}}><span>{icon}</span>{label}</button>)}</nav>
    <div className="sidebar-label">{query||tag||directory?'搜索结果':'笔记库'}<button className="icon-button" aria-label="打开笔记目录" disabled={!native||busy||composing} onClick={()=>void run(async()=>{const opened=await api.openVault();if(opened)await adopt(opened);})}>＋</button></div>
    <div className="vault-name">⌄ ▱ {vault?.name??'正在加载…'}</div><div className="file-actions"><button disabled={busy||composing||!native} onClick={()=>setModal({kind:'note',source:'',value:directory?`${directory}/新笔记.md`:'新笔记.md'})}>＋笔记</button><button disabled={busy||composing||!native} onClick={()=>setModal({kind:'directory',source:'',value:'新目录'})}>＋目录</button><button disabled={busy||composing||!native} onClick={()=>void run(reload)}>刷新</button></div>
    <div className="note-list">{results?results.hits.map(entry=><button className="search-result" key={entry.path} disabled={busy||composing} onClick={()=>void navigate(entry.path)}><strong>{entry.title}</strong><small>{entry.path}</small><span>{entry.excerpt}</span></button>):visibleTree.map(entry=><div key={entry.path} className="tree-row" style={{paddingLeft:Math.min(entry.path.split('/').length-1,5)*10}}><button title={entry.path} disabled={busy||composing} className={entry.path===path?'note-item selected':'note-item'} onClick={()=>{if(entry.isDirectory)setCollapsed(old=>{const next=new Set(old);if(next.has(entry.path))next.delete(entry.path);else next.add(entry.path);return next;});else if(entry.isAttachment)setModal({kind:'move',source:entry.path,value:entry.path});else void navigate(entry.path);}}><span>{entry.isDirectory?collapsed.has(entry.path)?'▸':'▾':'▧'}</span><span>{entry.path.split('/').pop()?.replace(/\.md$/i,'')}</span></button><button className="tree-menu" aria-label={`管理 ${entry.path}`} disabled={busy||composing||!native} onClick={()=>setModal({kind:'move',source:entry.path,value:entry.path})}>⋯</button></div>)}{results?.hits.length===0&&<p className="empty-small">没有匹配的笔记</p>}</div>
    {results&&<p className="search-meta">{results.hits.length} 条 · {results.elapsedMs.toFixed(1)} ms · 最多 100 条</p>}
    <div className="sidebar-bottom"><div className="local-indicator"><span className="dot"/>{native?'本地工作区':'浏览器内存演示'}</div><button onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?'☼ 浅色外观':'◐ 深色外观'}</button><button disabled={busy||!native} onClick={()=>void run(async()=>{if(await workspace({action:'export'}))setStatus('笔记库已导出');})}>导出笔记库</button></div>
  </aside><main>
    <header className="topbar"><div className="breadcrumb">{tab==='notes'?`笔记库 / ${path||'未选择笔记'}`:{graph:'工作区 / 知识图谱',sync:'工作区 / 同步',recovery:'工作区 / 恢复记录',lab:'工作区 / 技术验证'}[tab]}</div><div className="save-status" role="status"><span className="dot"/>{status}</div></header>
    {error&&<div className="notice error" role="alert"><span>{error}</span>{path&&<button disabled={busy||composing} onClick={()=>{setBusy(true);api.draft(path,session.current?.text??content).then(()=>loadNote(path)).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));}}>保留草稿并重读磁盘</button>}<button aria-label="关闭提示" onClick={()=>setError('')}>×</button></div>}
    {syncBlocked&&<div className="notice"><span>此库有待处理的 Git 冲突，编辑暂时只读。</span><button onClick={()=>setTab('sync')}>处理冲突</button></div>}
    {recovery!==null&&<div className="notice"><span>发现与磁盘版本不同的恢复草稿。恢复后请检查并协调内容。</span><button disabled={busy||syncBlocked} onClick={()=>{change(recovery);setRecovery(null);}}>恢复草稿</button><button onClick={()=>setRecovery(null)}>稍后处理</button></div>}
    {tab==='notes'&&<section className="note-workspace"><div className="note-heading"><div><p className="eyebrow">YOUR SPACE TO THINK</p><h1>{title||'一个想法，从这里开始'}</h1><p className="subtle">{new TextEncoder().encode(content).length.toLocaleString()} 字节 · {current?.tags.join(' · ')||'未设置标签'}</p></div><div className="segmented">{(['source','split','preview'] as const).map((key,i)=><button disabled={composing} className={mode===key?'selected':''} key={key} onClick={()=>setMode(key)}>{['源码','分栏','预览'][i]}</button>)}</div></div>
    {path&&<div className="workspace-toolbar note-tools"><button disabled={busy||composing||!native} onClick={()=>setModal({kind:'move',source:path,value:path})}>重命名 / 移动</button><button disabled={busy||composing||!native} onClick={()=>void importImage()}>插入图片</button><button disabled={busy||!native} onClick={()=>void run(async()=>{setHistory(await workspace({action:'history',path}));setHistorical(null);})}>版本历史</button><button disabled={busy||composing||!native} onClick={()=>setModal({kind:'delete',source:path,value:''})}>删除</button></div>}
    {path?<div className="editing-area"><div className={`document-panes ${mode}`}>{mode!=='preview'&&<div className="source-pane"><div className="pane-label">MARKDOWN <span>UTF-8</span></div><Editor documentKey={`${vault?.id}:${path}`} value={content} readOnly={busy||syncBlocked} onChange={change} onComposition={composition}/></div>}{mode!=='source'&&<div className="preview-pane"><div className="pane-label">预览 <span>安全渲染</span></div><Preview content={content} path={path} onOpen={link}/></div>}</div><aside className="relations"><h3>标签</h3><p className="subtle">在 front matter 的 tags 数组中编辑</p><div className="tag-list">{current?.tags.map(t=><button key={t} onClick={()=>setTag(t)}>#{t}</button>)}</div><h3>反向链接</h3>{notes.filter(n=>n.references.some(r=>r.target===path)).map(n=><button className="relation-link" key={n.path} onClick={()=>void navigate(n.path)}>{n.title}</button>)}<h3>出站链接</h3>{current?.references.filter(r=>!r.image).map((r,i)=><button className="relation-link" key={i} onClick={()=>{if(r.target)void navigate(r.target);else setError(`${r.resolution==='ambiguous'?'同名歧义':'目标缺失'}：${r.raw}`);}}>{r.target?'↗':'○'} {r.raw}{r.resolution==='ambiguous'?'（歧义）':''}</button>)}{current?.issues.map(issue=><p className="metadata-issue" key={issue}>{issue}</p>)}</aside></div>:<div className="empty-state"><h2>从第一篇笔记开始</h2><p>打开本地目录，或点击侧边栏「＋笔记」。</p></div>}
    <footer className="document-footer"><span>{composing?'中文组合输入中':'750 ms 自动保存'} · {platform.modifier} S 保存 · {platform.modifier} N 新建</span><span>本地 Markdown · {platform.desktop} MVP</span></footer></section>}
    {tab==='graph'&&<Suspense fallback={<p className="notice">正在加载图谱…</p>}><KnowledgeGraph current={path} notes={notes} revision={revision} onOpen={p=>void navigate(p)}/></Suspense>}
    {tab==='sync'&&<SyncPanel key={vault?.id} busy={busy} run={run} onVault={adopt} onReload={reload}/>}
    {tab==='recovery'&&<section className="lab-panel"><h1>恢复记录</h1><p className="subtle">删除、移动及链接改写前的副本保存在本机。恢复到新目录，不覆盖现有内容。</p>{recoveries.map(r=><article className="recovery-card" key={r.id}><h3>{r.source}{r.destination&&` → ${r.destination}`}</h3><p>{r.kind} · {r.completed?'操作已完成':'操作中断，请检查双方目录并恢复副本'}</p><button disabled={busy} onClick={()=>void run(async()=>{const result=await workspace<{path:string}>({action:'restore',id:r.id});await reload();setStatus(`已恢复至 ${result.path}`);})}>恢复副本到新目录</button></article>)}{!recoveries.length&&<p>暂无恢复记录。</p>}</section>}
    {tab==='lab'&&<section className="lab-panel"><h1>技术验证</h1><p className="subtle">验证样本与实际笔记库分开运行。中文组合输入仍需人工操作系统输入法。</p><div className="workspace-toolbar"><button disabled={busy} onClick={()=>setLongSample(('# 中文输入样本\n\n知识图谱帮助我整理项目计划。Rust 与 Markdown 混排，标点：预算、计划。\n').repeat(660))}>加载 100 KB 长文</button><button disabled={busy||!native} onClick={()=>void run(async()=>setReport(await api.probes()))}>运行搜索 / Git 样本</button></div>{report!==null&&<pre className="report-json">{JSON.stringify(report,null,2)}</pre>}{longSample&&<div className="long-sample"><Editor documentKey="long-sample" value={longSample} readOnly={false} onChange={setLongSample} onComposition={composition}/></div>}<div className="probe-graph"><Suspense fallback={null}><ProbeGraph/></Suspense></div></section>}
  </main>
  {modal&&<div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-label="管理笔记" onSubmit={e=>{e.preventDefault();void submitModal();}}><h2>{{note:'新建笔记',directory:'新建目录',move:'重命名或移动',delete:'删除并保留恢复副本'}[modal.kind]}</h2><p className="subtle">{modal.source||'使用笔记库内的相对路径；父目录需已存在。'}</p>{modal.kind!=='delete'&&<input autoFocus aria-label="目标路径" value={modal.value} onChange={e=>setModal({...modal,value:e.target.value})}/>}<div className="workspace-toolbar"><button type="submit" className="primary" disabled={busy}>{modal.kind==='delete'?'确认删除':'保存'}</button><button type="button" disabled={busy} onClick={()=>setModal(null)}>取消</button>{modal.kind==='move'&&<button type="button" disabled={busy} onClick={()=>setModal({...modal,kind:'delete'})}>删除此项</button>}</div>{error&&<p role="alert">{error}</p>}</form></div>}
  {history!==null&&<div className="modal-backdrop"><div className="modal history-modal" role="dialog" aria-modal="true" aria-label="版本历史"><h2>版本历史 · {path}</h2><p className="subtle">恢复作为当前修改保存，下一次同步产生新提交，不改写历史。</p><div className="revision-list">{history.map(h=><button key={h.id} disabled={busy} onClick={()=>void run(async()=>setHistorical(await workspace({action:'version',path,id:h.id})))}>{new Date(h.timestamp*1000).toLocaleString()} · {h.message} · {h.id.slice(0,7)}</button>)}</div>{historical!==null&&<textarea aria-label="历史内容" readOnly value={historical}/>}<div className="workspace-toolbar"><button disabled={busy||historical===null} onClick={()=>{if(historical!==null){change(historical);setHistory(null);setHistorical(null);}}}>恢复此版本到编辑器</button><button onClick={()=>{setHistory(null);setHistorical(null);}}>关闭</button></div></div></div>}
  </div>;
}
