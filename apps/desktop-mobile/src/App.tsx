import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { api, errorText, native, selectVault, workspace, type ParsedNote, type SearchResult, type Vault } from './api';
import { DocumentSession } from './session';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { platform } from './platform';
import { SyncPanel } from './SyncPanel';
import { AppShell, Icon, useSidebar } from './AppShell';
import { HomePage } from './HomePage';
import { GraphFilters, initialGraphFilters } from './GraphFilters';
import { afterSave, moduleLabels, readEditorMode, readPreference, savePreference, type Module, type HomePage as HomeSection, type HelpPage, type SettingsPage } from './navigation';
import { readRecent, writeRecent, visitRecent, moveRecent, pruneRecent, type RecentNote } from './recent';
import { createPath, parentDirectory } from './create-path';
import { dropFolderForEntry, treeMoveDestination } from './tree-drag';
const KnowledgeGraph=lazy(()=>import('./KnowledgeGraph').then(m=>({default:m.KnowledgeGraph})));
const ProbeGraph=lazy(()=>import('./Graph').then(m=>({default:m.Graph})));

type TreeEntry={path:string;isDirectory:boolean;isAttachment?:boolean};
type Recovery={id:string;kind:string;source:string;destination:string|null;completed:boolean};
type Modal={kind:'note'|'directory'|'move'|'delete';source:string;value:string;parent?:string};
export default function App(){
  const [vault,setVault]=useState<Vault|null>(null),[path,setPath]=useState(''),[content,setContent]=useState('');
  const [module,setModule]=useState<Module>('home'),[mode,setMode]=useState(readEditorMode);
  const [homePage,setHomePage]=useState<HomeSection>('overview'),[helpPage,setHelpPage]=useState<HelpPage>('intro'),[settingsPage,setSettingsPage]=useState<SettingsPage>('appearance');
  const tab=module==='settings'?settingsPage:module==='help'?helpPage:module;
  const sidebar=useSidebar();
  const [recent,setRecent]=useState<RecentNote[]>([]),recentRef=useRef<RecentNote[]>([]);
  const [relationsOpen,setRelationsOpen]=useState(false),[graphVisited,setGraphVisited]=useState(false),[syncVisited,setSyncVisited]=useState(false);
  const [graphFilters,setGraphFilters]=useState(initialGraphFilters);
  const [searchFocus,setSearchFocus]=useState(0);
  function storeRecent(entries:RecentNote[],id=vaultRef.current?.id){
    recentRef.current=entries;setRecent(entries);
    if(id)try{writeRecent(localStorage,id,entries);}catch{setError('无法保存最近访问记录；笔记内容不受影响。');}
  }
  function recordVisit(next:string,text:string){storeRecent(visitRecent(recentRef.current,{path:next,title:text.match(/^# (.+)$/m)?.[1]??next.split('/').pop()!.replace(/\.md$/i,''),openedAt:Date.now()}));}
  useEffect(()=>{savePreference('mozhi-editor-mode',mode);},[mode]);
  useEffect(()=>{if(searchFocus&&module==='notes'&&sidebar.visible)searchField.current?.focus();},[searchFocus,module,sidebar.visible]);
  const [theme,setTheme]=useState(readPreference('mozhi-theme','dark')),[status,setStatus]=useState('打开笔记库'),[error,setError]=useState(''),[busy,setBusy]=useState(true),[composing,setComposing]=useState(false);
  const [recovery,setRecovery]=useState<string|null>(null),[recoveries,setRecoveries]=useState<Recovery[]>([]),[modal,setModal]=useState<Modal|null>(null);
  const [syncBlocked,setSyncBlocked]=useState(false);
  const [query,setQuery]=useState(''),[tag,setTag]=useState(''),[directory,setDirectory]=useState(''),[filenameOnly,setFilenameOnly]=useState(false),[results,setResults]=useState<SearchResult|null>(null);
  const [tree,setTree]=useState<TreeEntry[]>([]),[notes,setNotes]=useState<ParsedNote[]>([]),[revision,setRevision]=useState(0),[collapsed,setCollapsed]=useState<Set<string>>(new Set());
  const [selectedDirectory,setSelectedDirectory]=useState('');
  const [selectedTreePath,setSelectedTreePath]=useState('');
  const [dragSource,setDragSource]=useState(''),[dropTarget,setDropTarget]=useState<string|null>(null),[dropTargetRow,setDropTargetRow]=useState<string|null>(null);
  const dragSourceRef=useRef('');
  const [history,setHistory]=useState<{id:string;message:string;timestamp:number}[]|null>(null),[historical,setHistorical]=useState<string|null>(null),[report,setReport]=useState<unknown>(null),[longSample,setLongSample]=useState('');
  const session=useRef<DocumentSession|null>(null),searchField=useRef<HTMLInputElement>(null),initialized=useRef(false),operation=useRef(false),isComposing=useRef(false),vaultRef=useRef<Vault|null>(null);
  const current=notes.find(n=>n.path===path), tags=[...new Set(notes.flatMap(n=>n.tags))].sort();
  const updateKnowledge=useCallback(async()=>{if(!native)return;const id=vaultRef.current?.id;const [entries,parsed]=await Promise.all([workspace<TreeEntry[]>({action:'tree'}),workspace<ParsedNote[]>({action:'knowledge'})]);if(id===vaultRef.current?.id){setTree(entries);setSelectedDirectory(previous=>previous&&!entries.some(entry=>entry.isDirectory&&entry.path===previous)?'':previous);setSelectedTreePath(previous=>previous&&!entries.some(entry=>entry.path===previous)?'':previous);setNotes(parsed);setRevision(r=>r+1);const state=await workspace<{phase:string}>({action:'sync_state'});setSyncBlocked(state.phase==='conflict');}},[]);
  const loadNote=useCallback(async(next:string)=>{
    const note=await api.read(next),draft=await api.readDraft(next);
    session.current=new DocumentSession(note,api.save,setError);setPath(next);setContent(note.content);setRecovery(draft!==null&&draft!==note.content?draft:null);setStatus(native?'已保存到本机':'浏览器内存演示');setHistory(null);setHistorical(null);return note;
  },[]);
  const adopt=useCallback(async(opened:Vault)=>{
    selectVault(opened.id);vaultRef.current=opened;storeRecent(pruneRecent(readRecent(localStorage,opened.id),opened.entries.map(e=>e.path),opened.skipped),opened.id);setGraphFilters(initialGraphFilters);setGraphVisited(false);setRelationsOpen(false);setRecoveries([]);setSyncBlocked(false);setVault(opened);setQuery('');setTag('');setDirectory('');setSelectedDirectory('');setSelectedTreePath('');session.current=null;setPath('');setContent('');setRecovery(null);setNotes([]);setTree([]);setCollapsed(new Set());
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
    if(operation.current||isComposing.current||busy)return;operation.current=true;setBusy(true);setError('');setStatus('正在处理…');
    try{let result:T|undefined;await afterSave(false,flush,async()=>{result=await action();});return result;}catch(e){setStatus('操作未完成');setError(errorText(e));return undefined;}finally{operation.current=false;setBusy(false);setStatus(previous=>previous==='正在处理…'?(native?'本地工作区就绪':'浏览器内存演示'):previous);}
  }
  async function reload(){
    if(!native)return;
    const opened=await workspace<Vault>({action:'refresh'});setVault(opened);vaultRef.current=opened;storeRecent(pruneRecent(recentRef.current,opened.entries.map(e=>e.path),opened.skipped));
    const previous=session.current?.note.path;
    if(previous&&opened.entries.some(e=>e.path===previous)){const disk=await api.read(previous);if(disk.contentHash!==session.current?.note.contentHash)await loadNote(previous);}
    else {session.current=null;setPath('');setContent('');setRecovery(null);}
    await updateKnowledge();
  }
  useEffect(()=>{if(initialized.current)return;initialized.current=true;api.openDemo().then(adopt).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));},[adopt]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;savePreference('mozhi-theme',theme);},[theme]);
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
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!event.isComposing&&!modal&&history===null)void openSearch();}
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n'&&!event.isComposing){event.preventDefault();if(!operation.current&&!isComposing.current&&native&&!busy&&!modal&&history===null)newNote();}
    };
    const hide=()=>{const current=session.current;if(document.hidden&&current?.dirty&&!operation.current)void api.draft(current.note.path,current.text).catch(()=>{});};
    document.addEventListener('keydown',handler);document.addEventListener('visibilitychange',hide);
    return()=>{document.removeEventListener('keydown',handler);document.removeEventListener('visibilitychange',hide);};
  });
  // Reconcile external edits on focus. Never replace a dirty editor with disk contents.
  useEffect(()=>{
    const focus=()=>{if(native&&!operation.current&&!isComposing.current&&!session.current?.dirty)void run(reload);};
    window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);
  });
  function change(value:string){if(!session.current)return;session.current.text=value;setContent(value);setStatus(session.current.dirty?'待保存…':native?'已保存到本机':'浏览器内存演示');}
  function composition(active:boolean){isComposing.current=active;setComposing(active);}
  async function switchModule(next:Module){await run(async()=>{
    if(next==='graph')setGraphVisited(true);
    if(next==='settings'&&settingsPage==='sync')setSyncVisited(true);
    setModule(next);sidebar.dismiss();
  });}
  async function selectSettings(next:SettingsPage){await run(async()=>{
    if(next==='recovery'&&native)setRecoveries(await workspace<Recovery[]>({action:'recoveries'}));
    if(next==='sync')setSyncVisited(true);
    setModule('settings');setSettingsPage(next);sidebar.dismiss();
  });}
  async function openSearch(){await run(async()=>{setModule('notes');sidebar.reveal();setSearchFocus(n=>n+1);});}
  function locate(next:string){setCollapsed(old=>new Set([...old].filter(folder=>!next.startsWith(`${folder}/`))));}
  async function navigate(next:string){await run(async()=>{
    const note=next===path&&session.current?session.current.note:await loadNote(next);
    recordVisit(next,next===path?content:note.content);locate(next);setSelectedDirectory(parentDirectory(next));setSelectedTreePath(next);setModule('notes');sidebar.dismiss();
  });}
  function newNote(){setError('');setModal({kind:'note',source:'',parent:selectedDirectory,value:'新笔记'});}
  function newDirectory(){setError('');setModal({kind:'directory',source:'',parent:selectedDirectory,value:'新目录'});}
  async function openVault(){await run(async()=>{const opened=await api.openVault();if(opened){await adopt(opened);setModule('home');sidebar.dismiss();}});}
  function clearDrag(){dragSourceRef.current='';setDragSource('');setDropTarget(null);setDropTargetRow(null);}
  function dragOverFolder(event:React.DragEvent,folder:string,row:string|null=null){
    const source=dragSourceRef.current;
    const destination=source&&treeMoveDestination(source,folder,tree.map(entry=>entry.path));
    if(!destination||busy||composing||syncBlocked){setDropTarget(null);setDropTargetRow(null);return;}
    event.preventDefault();event.dataTransfer.dropEffect='move';setDropTarget(folder);setDropTargetRow(row);
  }
  async function dropIntoFolder(event:React.DragEvent,folder:string){
    event.preventDefault();event.stopPropagation();
    const source=dragSourceRef.current;
    const destination=source&&treeMoveDestination(source,folder,tree.map(entry=>entry.path));
    clearDrag();
    if(!destination||busy||composing||syncBlocked)return;
    await run(async()=>{await performMove(source,destination,folder);});
  }
  async function performMove(source:string,destination:string,folder:string){
    await workspace({action:'move',from:source,to:destination});
    storeRecent(moveRecent(recentRef.current,source,destination));
    const next=path===source||path.startsWith(`${source}/`)?`${destination}${path.slice(source.length)}`:path;
    await reload();if(next&&next!==path)await loadNote(next);
    setSelectedDirectory(folder);
    setSelectedTreePath(destination);
    setCollapsed(old=>new Set([...old].filter(item=>!destination.startsWith(`${item}/`))));
    setQuery('');setTag('');setDirectory('');
  }
  useEffect(()=>{if(module==='notes'&&sidebar.visible)document.querySelector('.note-item.selected')?.scrollIntoView({block:'nearest'});},[path,module,sidebar.visible]);
  async function submitModal(){
    if(!modal)return;const m=modal;
    let destination='';
    if(m.kind==='note'||m.kind==='directory') {
      try { destination=createPath(m.parent??'',m.value,m.kind); } catch(e) { setError(errorText(e)); return; }
    }
    await run(async()=>{
      if(m.kind==='note'||m.kind==='directory'){
        const opened=await workspace<Vault>({action:'create',path:destination,directory:m.kind==='directory'});
        setVault(opened);await updateKnowledge();setQuery('');setTag('');setDirectory('');setCollapsed(old=>new Set([...old].filter(folder=>!destination.startsWith(`${folder}/`))));
        if(m.kind==='note'){const note=await loadNote(destination);recordVisit(destination,note.content);setSelectedDirectory(m.parent??'');}
        else setSelectedDirectory(destination);
        setSelectedTreePath(destination);
        setModule('notes');sidebar.dismiss();
      }
      else if(m.kind==='move')await performMove(m.source,m.value,parentDirectory(m.value));
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
  const sidebarContent=<>
    <button className="vault-switcher" disabled={!native||busy||composing} onClick={()=>void openVault()} title={vault?.name}><span className="mini-brand">墨</span><span>墨知<small>{vault?.name??'正在加载…'}</small></span><span aria-hidden="true">⌄</span></button>
    <div className="module-sidebar-page" hidden={module!=='home'}>
      <button className="new-note" disabled={!native||busy||composing} onClick={newNote}>＋ 新建笔记</button>
      <nav aria-label="首页导航">{([['overview','概览'],['recent','最近打开']] as const).map(([key,label])=><button className={`nav-item ${homePage===key?'active':''}`} aria-current={homePage===key?'page':undefined} key={key} disabled={busy||composing} onClick={()=>{setHomePage(key);sidebar.dismiss();}}>{label}</button>)}</nav>
    </div>
    <div className="module-sidebar-page notes-sidebar" hidden={module!=='notes'}>
    <div className="search-box"><span>⌕</span><input ref={searchField} aria-label="搜索笔记" placeholder="搜索 / tag:工作" value={query} onChange={e=>setQuery(e.target.value)}/><kbd>{platform.modifier} K</kbd></div>
    <details className="filter-disclosure"><summary>筛选条件</summary><div className="search-filters"><select aria-label="搜索标签" value={tag} onChange={e=>setTag(e.target.value)}><option value="">所有标签</option>{tags.map(t=><option key={t}>{t}</option>)}</select><select aria-label="搜索目录" value={directory} onChange={e=>setDirectory(e.target.value)}><option value="">所有目录</option>{tree.filter(e=>e.isDirectory).map(e=><option key={e.path}>{e.path}</option>)}</select><label><input type="checkbox" checked={filenameOnly} onChange={e=>setFilenameOnly(e.target.checked)}/>仅文件名</label></div></details>
    <div className="sidebar-label">{query||tag||directory?'搜索结果':'笔记库'}</div>
    <div className={`vault-root ${selectedTreePath===''?'selected':''} ${dropTarget===''&&dropTargetRow===null?'drop-target':''}`} onDragOver={event=>dragOverFolder(event,'')} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node)){setDropTarget(null);setDropTargetRow(null);}}} onDrop={event=>void dropIntoFolder(event,'')}><button disabled={busy||composing} onClick={()=>{setSelectedDirectory('');setSelectedTreePath('');}}>▱ {vault?.name??'正在加载…'} <small>根目录</small></button></div>
    <div className="file-actions"><button disabled={busy||composing||!native} onClick={newNote}>＋笔记</button><button disabled={busy||composing||!native} onClick={newDirectory}>＋目录</button><button disabled={busy||composing||!native} onClick={()=>void run(reload)}>刷新</button></div>
    <div className="note-list" onDragOver={event=>{if(event.target===event.currentTarget)dragOverFolder(event,'');}} onDrop={event=>{if(event.target===event.currentTarget)void dropIntoFolder(event,'');}}>{results?results.hits.map(entry=><button className="search-result" key={entry.path} disabled={busy||composing} onClick={()=>void navigate(entry.path)}><strong>{entry.title}</strong><small>{entry.path}</small><span>{entry.excerpt}</span></button>):visibleTree.map(entry=><div key={entry.path} className={`tree-row ${dragSource===entry.path?'dragging':''} ${dropTargetRow===entry.path?'drop-target':''}`} style={{paddingLeft:Math.min(entry.path.split('/').length-1,5)*10}} draggable={native&&!busy&&!composing&&!syncBlocked} onDragStart={event=>{if(!native||busy||composing||syncBlocked){event.preventDefault();return;}dragSourceRef.current=entry.path;setDragSource(entry.path);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain','mozhi-tree-entry');}} onDragEnd={clearDrag} onDragOver={event=>dragOverFolder(event,dropFolderForEntry(entry),entry.path)} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node)){setDropTarget(null);setDropTargetRow(null);}}} onDrop={event=>void dropIntoFolder(event,dropFolderForEntry(entry))}>{entry.isDirectory&&<button className="tree-expander" aria-label={`${collapsed.has(entry.path)?'展开':'折叠'} ${entry.path}`} disabled={busy||composing} onClick={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(entry.path))next.delete(entry.path);else next.add(entry.path);return next;})}>{collapsed.has(entry.path)?'▸':'▾'}</button>}<button title={entry.path} disabled={busy||composing} aria-current={selectedTreePath===entry.path?(entry.isDirectory?'location':'page'):undefined} className={`${entry.isDirectory&&selectedTreePath===entry.path?'note-item selected-directory':'note-item'} ${!entry.isDirectory&&selectedTreePath===entry.path?'selected':''}`} onClick={()=>{if(entry.isDirectory){setSelectedDirectory(entry.path);setSelectedTreePath(entry.path);}else if(entry.isAttachment){setSelectedTreePath(entry.path);setModal({kind:'move',source:entry.path,value:entry.path});}else void navigate(entry.path);}}><span>{entry.isDirectory?'▱':'▧'}</span><span>{entry.path.split('/').pop()?.replace(/\.md$/i,'')}</span></button><button className="tree-menu" aria-label={`管理 ${entry.path}`} disabled={busy||composing||!native} onClick={()=>setModal({kind:'move',source:entry.path,value:entry.path})}>⋯</button></div>)}{results?.hits.length===0&&<p className="empty-small">没有匹配的笔记</p>}</div>
    {results&&<p className="search-meta">{results.hits.length} 条 · {results.elapsedMs.toFixed(1)} ms · 最多 100 条</p>}
    </div>
    <div className="module-sidebar-page" hidden={module!=='graph'}><h2>知识图谱</h2><GraphFilters value={graphFilters} onChange={setGraphFilters} current={path} tags={tags}/></div>
    <div className="module-sidebar-page" hidden={module!=='help'}><h2>帮助</h2><nav aria-label="帮助导航">{([['intro','使用入门'],['shortcuts','快捷键'],['lab','技术验证']] as const).map(([key,label])=><button className={`nav-item ${helpPage===key?'active':''}`} key={key} disabled={busy||composing} onClick={()=>void run(async()=>{setHelpPage(key);sidebar.dismiss();})}>{label}</button>)}</nav></div>
    <div className="module-sidebar-page" hidden={module!=='settings'}><h2>设置</h2><nav aria-label="设置导航">{([['appearance','外观'],['vault','笔记库'],['sync','同步'],['recovery','恢复记录']] as const).map(([key,label])=><button className={`nav-item ${settingsPage===key?'active':''}`} key={key} disabled={busy||composing} onClick={()=>void selectSettings(key)}>{label}</button>)}</nav></div>
    <div className="sidebar-bottom"><button disabled={!native||busy||composing} onClick={()=>void openVault()}>打开笔记库</button><div className="local-indicator"><span className="dot"/>{native?'本地工作区':'浏览器内存演示'}</div></div>
  </>;
  return <AppShell active={module} disabled={busy||composing||!!modal||history!==null} onNavigate={next=>void switchModule(next)} sidebar={sidebarContent} sidebarVisible={sidebar.visible} dismissSidebar={sidebar.dismiss}>
    <header className="topbar"><button className="sidebar-toggle" aria-label={sidebar.visible?'收起侧栏':'展开侧栏'} aria-expanded={sidebar.visible} aria-controls="module-sidebar" onClick={sidebar.toggle}><Icon name="panel"/></button><div className="breadcrumb">{module==='notes'?`笔记库 / ${path||'未选择笔记'}`:moduleLabels[module]}</div><div className="save-status" role="status"><span className="dot"/>{status}</div></header>
    {error&&<div className="notice error" role="alert"><span>{error}</span>{path&&<button disabled={busy||composing} onClick={()=>{setBusy(true);api.draft(path,session.current?.text??content).then(()=>loadNote(path)).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));}}>保留草稿并重读磁盘</button>}<button aria-label="关闭提示" onClick={()=>setError('')}>×</button></div>}
    {syncBlocked&&<div className="notice"><span>此库有待处理的 Git 冲突，编辑暂时只读。</span><button disabled={busy||composing} onClick={()=>void selectSettings('sync')}>处理冲突</button></div>}
    {recovery!==null&&<div className="notice"><span>发现与磁盘版本不同的恢复草稿。恢复后请检查并协调内容。</span><button disabled={busy||composing||syncBlocked} onClick={()=>{change(recovery);setRecovery(null);}}>恢复草稿</button><button onClick={()=>setRecovery(null)}>稍后处理</button></div>}
    <div className="page-slot" hidden={module!=='home'}><HomePage recent={recent.map(item=>({...item,title:notes.find(note=>note.path===item.path)?.title??item.title}))} all={homePage==='recent'} busy={busy||composing} canCreate={native} onOpen={next=>void navigate(next)} onAll={()=>setHomePage('recent')} onNew={newNote} onBrowse={()=>void switchModule('notes')}/></div>
    <section hidden={module!=='notes'} className="note-workspace"><div className="note-heading"><div><h1>{title||'一个想法，从这里开始'}</h1><p className="subtle">{new TextEncoder().encode(content).length.toLocaleString()} 字节 · {current?.tags.join(' · ')||'未设置标签'}</p></div><div className="segmented">{(['source','split','preview'] as const).map((key,i)=><button disabled={composing} className={mode===key?'selected':''} key={key} onClick={()=>setMode(key)}>{['源码','分栏','预览'][i]}</button>)}</div></div>
    {path&&<div className="workspace-toolbar note-tools"><button disabled={busy||composing||!native||syncBlocked} onClick={()=>void importImage()}>插入图片</button><button aria-expanded={relationsOpen} aria-controls="note-relations" onClick={()=>setRelationsOpen(v=>!v)}>关联信息</button><details className="note-menu"><summary aria-label="笔记操作">更多 ···</summary><div className="note-menu-items"><button disabled={busy||composing||!native} onClick={()=>setModal({kind:'move',source:path,value:path})}>重命名 / 移动</button><button disabled={busy||composing||!native} onClick={()=>void run(async()=>{setHistory(await workspace({action:'history',path}));setHistorical(null);})}>版本历史</button><button disabled={busy||composing||!native} onClick={()=>setModal({kind:'delete',source:path,value:''})}>删除</button></div></details></div>}
    {path?<div className="editing-area"><div className={`document-panes ${mode}`}>{<div hidden={mode==='preview'} className="source-pane"><div className="pane-label">MARKDOWN <span>UTF-8</span></div><Editor documentKey={`${vault?.id}:${path}`} value={content} readOnly={busy||syncBlocked} onChange={change} onComposition={composition}/></div>}{<div hidden={mode==='source'} className="preview-pane"><div className="pane-label">预览 <span>安全渲染</span></div><Preview content={content} path={path} onOpen={link}/></div>}</div><aside id="note-relations" className="relations" hidden={!relationsOpen}><button className="relation-close" aria-label="关闭关联信息" onClick={()=>setRelationsOpen(false)}>×</button><h3>标签</h3><p className="subtle">在 front matter 的 tags 数组中编辑</p><div className="tag-list">{current?.tags.map(t=><button key={t} onClick={()=>{setTag(t);sidebar.reveal();}}>#{t}</button>)}</div><h3>反向链接</h3>{notes.filter(n=>n.references.some(r=>r.target===path)).map(n=><button className="relation-link" key={n.path} onClick={()=>void navigate(n.path)}>{n.title}</button>)}<h3>出站链接</h3>{current?.references.filter(r=>!r.image).map((r,i)=><button className="relation-link" key={i} onClick={()=>{if(r.target)void navigate(r.target);else setError(`${r.resolution==='ambiguous'?'同名歧义':'目标缺失'}：${r.raw}`);}}>{r.target?'↗':'○'} {r.raw}{r.resolution==='ambiguous'?'（歧义）':''}</button>)}{current?.issues.map(issue=><p className="metadata-issue" key={issue}>{issue}</p>)}</aside></div>:<div className="empty-state"><h2>从第一篇笔记开始</h2><p>打开本地目录，或点击侧边栏「＋笔记」。</p></div>}
    <footer className="document-footer"><span>{composing?'中文组合输入中':'750 ms 自动保存'} · {platform.modifier} S 保存 · {platform.modifier} N 新建</span><span>本地 Markdown · {platform.desktop} MVP</span></footer></section>
    {graphVisited&&<div className="page-slot" hidden={module!=='graph'}><Suspense fallback={<p className="notice">正在加载图谱…</p>}><KnowledgeGraph key={vault?.id} active={module==='graph'} theme={theme} filters={graphFilters} current={path} revision={revision} onOpen={p=>void navigate(p)}/></Suspense></div>}
    {syncVisited&&<div className="page-slot" hidden={tab!=='sync'}><SyncPanel key={vault?.id} busy={busy||composing} run={run} onVault={adopt} onReload={reload}/></div>}
    <section className="settings-page" hidden={tab!=='appearance'}><h1>外观</h1><p className="subtle">选择适合你的阅读与书写环境。</p><div className="setting-row"><span>主题</span><div className="segmented">{(['dark','light'] as const).map(value=><button key={value} aria-pressed={theme===value} className={theme===value?'selected':''} onClick={()=>setTheme(value)}>{value==='dark'?'深色':'浅色'}</button>)}</div></div></section>
    <section className="settings-page" hidden={tab!=='vault'}><h1>笔记库</h1><p className="subtle">当前笔记库：{vault?.name}</p><div className="workspace-toolbar"><button disabled={busy||composing||!native} onClick={()=>void openVault()}>打开其他笔记库</button><button disabled={busy||composing||!native} onClick={()=>void run(async()=>{if(await workspace({action:'export'}))setStatus('笔记库已导出');})}>导出笔记库</button></div></section>
    <section className="help-page" hidden={tab!=='intro'}><h1>使用入门</h1><h2>把想法留在本机</h2><p>打开一个本地文件夹作为笔记库，在「我的笔记」中新建 Markdown 笔记和目录。</p><h2>专注书写</h2><p>源码、分栏与预览随时切换。输入会自动保存；保存失败或发现冲突时，请按页面提示协调版本。</p><h2>连接知识</h2><p>使用 [[笔记名称]] 建立引用，在关联信息中查看反向链接，在知识图谱中探索笔记之间的联系。</p><h2>同步与恢复</h2><p>在设置中配置 Git 同步、查看恢复记录或导出笔记库。</p></section>
    <section className="help-page" hidden={tab!=='shortcuts'}><h1>快捷键</h1><dl className="shortcut-list"><div><dt>搜索笔记</dt><dd>{platform.modifier} K</dd></div><div><dt>新建笔记</dt><dd>{platform.modifier} N</dd></div><div><dt>保存当前笔记</dt><dd>{platform.modifier} S</dd></div></dl></section>
    <section hidden={tab!=='recovery'} className="lab-panel"><h1>恢复记录</h1><p className="subtle">删除、移动及链接改写前的副本保存在本机。恢复到新目录，不覆盖现有内容。</p>{recoveries.map(r=><article className="recovery-card" key={r.id}><h3>{r.source}{r.destination&&` → ${r.destination}`}</h3><p>{r.kind} · {r.completed?'操作已完成':'操作中断，请检查双方目录并恢复副本'}</p><button disabled={busy} onClick={()=>void run(async()=>{const result=await workspace<{path:string}>({action:'restore',id:r.id});await reload();setStatus(`已恢复至 ${result.path}`);})}>恢复副本到新目录</button></article>)}{!recoveries.length&&<p>暂无恢复记录。</p>}</section>
    <section hidden={tab!=='lab'} className="lab-panel"><h1>技术验证</h1><p className="subtle">验证样本与实际笔记库分开运行。中文组合输入仍需人工操作系统输入法。</p><div className="workspace-toolbar"><button disabled={busy} onClick={()=>setLongSample(('# 中文输入样本\n\n知识图谱帮助我整理项目计划。Rust 与 Markdown 混排，标点：预算、计划。\n').repeat(660))}>加载 100 KB 长文</button><button disabled={busy||!native} onClick={()=>void run(async()=>setReport(await api.probes()))}>运行搜索 / Git 样本</button></div>{report!==null&&<pre className="report-json">{JSON.stringify(report,null,2)}</pre>}{longSample&&<div className="long-sample"><Editor documentKey="long-sample" value={longSample} readOnly={false} onChange={setLongSample} onComposition={composition}/></div>}<div className="probe-graph"><Suspense fallback={null}>{tab==='lab'&&<ProbeGraph/>}</Suspense></div></section>
  {modal&&<div className="modal-backdrop"><form className="modal create-modal" role="dialog" aria-modal="true" aria-label="管理笔记" onSubmit={e=>{e.preventDefault();void submitModal();}}><h2>{{note:'新建笔记',directory:'新建目录',move:'重命名或移动',delete:'删除并保留恢复副本'}[modal.kind]}</h2>{modal.kind==='note'||modal.kind==='directory'?<><label className="modal-field">位置<select aria-label="新建位置" value={modal.parent??''} onChange={e=>setModal({...modal,parent:e.target.value})}><option value="">{vault?.name??'笔记库'} · 根目录</option>{tree.filter(entry=>entry.isDirectory).map(entry=><option key={entry.path} value={entry.path}>{entry.path}</option>)}</select></label><label className="modal-field">名称<input autoFocus aria-label="名称" value={modal.value} onFocus={e=>e.currentTarget.select()} onChange={e=>{setError('');setModal({...modal,value:e.target.value});}}/></label><p className="create-destination">{modal.parent?`${modal.parent} / `:''}{modal.value.trim()}{modal.kind==='note'&&!modal.value.trim().endsWith('.md')?'.md':''}</p></>:<><p className="subtle">{modal.source}</p>{modal.kind!=='delete'&&<input autoFocus aria-label="目标路径" value={modal.value} onChange={e=>setModal({...modal,value:e.target.value})}/>}</>}<div className="workspace-toolbar"><button type="submit" className="primary" disabled={busy||composing}>{modal.kind==='delete'?'确认删除':modal.kind==='note'||modal.kind==='directory'?'创建':'保存'}</button><button type="button" disabled={busy} onClick={()=>{setModal(null);setError('');}}>取消</button>{modal.kind==='move'&&<button type="button" disabled={busy} onClick={()=>setModal({...modal,kind:'delete'})}>删除此项</button>}</div>{error&&<p role="alert">{error}</p>}</form></div>}
  {history!==null&&<div className="modal-backdrop"><div className="modal history-modal" role="dialog" aria-modal="true" aria-label="版本历史"><h2>版本历史 · {path}</h2><p className="subtle">恢复作为当前修改保存，下一次同步产生新提交，不改写历史。</p><div className="revision-list">{history.map(h=><button key={h.id} disabled={busy} onClick={()=>void run(async()=>setHistorical(await workspace({action:'version',path,id:h.id})))}>{new Date(h.timestamp*1000).toLocaleString()} · {h.message} · {h.id.slice(0,7)}</button>)}</div>{historical!==null&&<textarea aria-label="历史内容" readOnly value={historical}/>}<div className="workspace-toolbar"><button disabled={busy||composing||syncBlocked||historical===null} onClick={()=>{if(historical!==null){change(historical);setHistory(null);setHistorical(null);}}}>恢复此版本到编辑器</button><button onClick={()=>{setHistory(null);setHistorical(null);}}>关闭</button></div></div></div>}
  </AppShell>;
}
