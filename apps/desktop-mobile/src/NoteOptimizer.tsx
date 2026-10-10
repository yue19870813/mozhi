import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ArrowUp, BookOpen, Check, LoaderCircle, Search, Square, WandSparkles } from 'lucide-react';
import { aiRequest, errorText, native, type AiPrepared, type AiSource } from './api';
import { Answer } from './AiAnswer';
import { t, useLanguage } from './i18n';

export type OptimizationSession = {
  path: string; question: string; original: AiSource | null; result: string;
  status: 'idle' | 'generating' | 'complete' | 'stopped' | 'failed' | 'applied';
};
export const emptyOptimization = (): OptimizationSession => ({ path: '', question: '', original: null, result: '', status: 'idle' });
export const canSaveOptimization = (session: OptimizationSession) =>
  (session.status === 'complete' || session.status === 'applied') && !!session.result.trim() && !!session.original;
export function optimizationFile(path: string) {
  const slash = path.lastIndexOf('/');
  return { folder: path.slice(0, slash + 1).replace(/\/$/, ''), name: `${path.slice(slash + 1).replace(/\.md$/i, '')}${t('-优化.md')}` };
}
export function acceptsOptimizationEvent(vaultId: string, requestId: string, event: {vaultId:string;requestId:string}) {
  return !!requestId && vaultId === event.vaultId && requestId === event.requestId;
}

type Props = {
  vaultId: string; notes: {path:string;title:string}[]; directories: string[];
  session: OptimizationSession; onChange: Dispatch<SetStateAction<OptimizationSession>>;
  onBusy: (busy:boolean)=>void; beforePrepare: ()=>Promise<boolean>;
  onApply: (path:string,hash:string,body:string)=>Promise<boolean>;
  onSave: (path:string,body:string)=>Promise<boolean>; onOpen: (path:string)=>void;
  authorized: boolean; onAuthorization: (enabled:boolean)=>void;
};
export function NoteOptimizer({ vaultId, notes, directories, session, onChange, onBusy, beforePrepare, onApply, onSave, onOpen, authorized, onAuthorization }: Props) {
  useLanguage();
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [prepared,setPrepared] = useState<AiPrepared|null>(null);
  const [filter,setFilter] = useState(''), [view,setView] = useState<'original'|'result'>('result'), [editing,setEditing] = useState(false);
  const [dialog,setDialog] = useState<'apply'|'save'|null>(null), [folder,setFolder] = useState(''), [name,setName] = useState('');
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  const mounted = useRef(true), requestId = useRef(''), stopped = useRef(false), change = useRef(onChange);
  change.current = onChange;
  const listener = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    mounted.current = true;
    let disposed = false, unlisten: (()=>void)|undefined;
    if (native) listener.current = listen<{vaultId:string;requestId:string;text:string}>('ai_delta', event => {
      if (!disposed && !stopped.current && acceptsOptimizationEvent(vaultId,requestId.current,event.payload)) {
        change.current(previous => ({...previous,result:previous.result + event.payload.text}));
      }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; });
    // A listener failure is surfaced by send, without an unhandled rejection at mount.
    void listener.current.catch(()=>{});
    return () => {
      disposed = true; mounted.current = false; unlisten?.(); busyCallback.current(false);
      change.current(previous=>previous.status==='generating'?{...previous,status:'stopped'}:previous);
      if (requestId.current) void aiRequest(vaultId,{action:'cancel',id:requestId.current}).catch(()=>{});
    };
  },[vaultId]);
  function working(value:boolean) { setBusy(value); onBusy(value); }
  function invalidate(update: Partial<OptimizationSession>) {
    setPrepared(null); setError(''); setEditing(false);
    onChange(previous => ({...emptyOptimization(),path:previous.path,question:previous.question,...update}));
  }
  async function send(value:AiPrepared,confirmed:boolean) {
    working(true); setError(''); setPrepared(null); stopped.current = false; requestId.current = value.id;
    onChange(previous => ({...previous,original:value.sources[0],result:'',status:'generating'}));
    try {
      await listener.current;
      if (!mounted.current || stopped.current) return;
      const result = await aiRequest<{text:string}>(vaultId,{action:'send',id:value.id,confirmed});
      if (mounted.current && !stopped.current) onChange(previous => ({...previous,result:result.text,status:'complete'}));
    } catch (e) {
      if (mounted.current && !stopped.current) { setError(errorText(e)); onChange(previous => ({...previous,status:'failed'})); }
    } finally {
      requestId.current = '';
      if (mounted.current) working(false);
    }
  }
  async function prepare() {
    working(true); setError(''); setEditing(false);
    try {
      if (!await beforePrepare() || !mounted.current) return;
      const value = await aiRequest<AiPrepared>(vaultId,{action:'prepare',mode:'optimize',question:session.question,keywords:'',paths:[session.path]});
      if (!mounted.current) return;
      onChange(previous => ({...previous,original:value.sources[0],result:'',status:'idle'}));
      if (value.authorized) await send(value,false); else setPrepared(value);
    } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { if (mounted.current) working(false); }
  }
  async function stop() {
    stopped.current = true;
    onChange(previous=>({...previous,status:'stopped'}));
    try { await aiRequest(vaultId,{action:'cancel',id:requestId.current}); }
    catch(e) { if(mounted.current)setError(errorText(e)); }
  }
  async function save() {
    if (!native || busy || !canSaveOptimization(session) || !session.original) return;
    working(true); setError('');
    try {
      const saved = dialog === 'apply'
        ? await onApply(session.original.path,session.original.contentHash,session.result)
        : await onSave(folder ? `${folder}/${name}` : name,session.result);
      if (mounted.current && saved) {
        if (dialog === 'apply') onChange(previous=>({...previous,status:'applied'}));
        setDialog(null);
      }
    } catch(e) { if(mounted.current)setError(errorText(e)); }
    finally { if(mounted.current)working(false); }
  }
  const valid = canSaveOptimization(session);
  return <div className="ai-workbench ai-optimize-workbench">
    <div className="ai-conversation">
      <div className="ai-results">
        {error && <p className="notice error" role="alert">{t(error)}</p>}
        {prepared && <section className="ai-preview"><h2>{t('发送预览')}</h2><p className="subtle">{prepared.config.baseUrl} · {prepared.config.model}</p><p>{prepared.question}</p><details open><summary>{prepared.sources[0].path} · {t('完整正文')}</summary><pre>{prepared.sources[0].text}</pre></details><div className="workspace-toolbar"><button className="primary" onClick={()=>void send(prepared,true)}>{t('确认发送')}</button><button onClick={()=>setPrepared(null)}>{t('取消')}</button></div></section>}
        {!session.original && !prepared && <div className="ai-empty"><WandSparkles size={32}/><h2>{t('笔记优化')}</h2><p>{t('选择一篇笔记，告诉 AI 你希望如何改进。')}</p><p>{t('仅优化正文，保留笔记元数据。')}</p></div>}
        {busy && <p className="ai-generating" role="status"><LoaderCircle size={16}/>{t('正在处理…')}</p>}
        {session.original && !prepared && <>
          <div className="ai-optimization-target"><BookOpen size={14}/><span>{session.original.path}</span></div>
          <div className="ai-compare-switch" role="group" aria-label={t('对照视图')}><button aria-pressed={view==='original'} onClick={()=>setView('original')}>{t('原文')}</button><button aria-pressed={view==='result'} onClick={()=>setView('result')}>{t('优化结果')}</button></div>
          <div className="ai-compare" data-view={view}>
            <section className="ai-compare-original"><header><h2>{t('原文')}</h2><span>{t('只读')}</span></header><div className="ai-compare-content"><Answer text={session.original.text} sources={[]} onOpen={onOpen}/></div></section>
            <section className="ai-compare-result"><header><h2>{t('优化结果')}</h2><button disabled={busy||session.status!=='complete'} onClick={()=>setEditing(!editing)}>{editing?t('预览'):t('编辑')}</button></header>
              {editing ? <textarea className="ai-optimization-editor" aria-label={t('编辑优化结果')} value={session.result} disabled={busy} onChange={e=>onChange(previous=>({...previous,result:e.target.value}))}/> : <div className="ai-compare-content"><Answer text={session.result} sources={[]} onOpen={onOpen}/></div>}
            </section>
          </div>
          {(session.status==='stopped'||session.status==='failed') && <p className="notice">{t('生成未完成，部分结果仅供查看，请重试。')}</p>}
          {session.status==='applied' && <p className="ai-applied" role="status"><Check size={15}/>{t('已应用到原笔记')} <button onClick={()=>onOpen(session.original!.path)}>{t('打开笔记')}</button></p>}
          <div className="ai-optimization-actions"><button className="primary" disabled={!native||!valid||busy||session.status==='applied'} onClick={()=>setDialog('apply')}>{t('应用到原笔记')}</button><button disabled={!native||!valid||busy} onClick={()=>{const target=optimizationFile(session.original!.path);setFolder(target.folder);setName(target.name);setDialog('save');}}>{t('另存为新笔记')}</button></div>
        </>}
      </div>
      <div className="ai-composer"><textarea aria-label={t('优化要求')} disabled={busy} maxLength={16000} value={session.question} onChange={e=>invalidate({question:e.target.value})} placeholder={t('例如：调整结构，语言更简洁，保留技术细节。')}/><div className="ai-composer-footer"><span className="ai-context-count">{t('待优化笔记')} · {session.path ? 1 : 0}/1</span>
        {busy && requestId.current ? <button className="ai-send-button ai-stop-button" title={t('停止生成')} aria-label={t('停止生成')} onClick={()=>void stop()}><Square size={12} fill="currentColor" strokeWidth={0}/></button> : <button className="ai-send-button" disabled={busy||!native||!session.path||!session.question.trim()} title={t('准备优化')} aria-label={t('准备优化')} onClick={()=>void prepare()}><ArrowUp size={18}/></button>}
      </div></div>
    </div>
    <aside className="ai-context-panel"><div className="ai-context-heading"><BookOpen size={16}/><h2>{t('待优化笔记')}</h2><span>{session.path?1:0}/1</span></div><div className="ai-note-picker"><div className="ai-note-search"><Search size={15}/><input aria-label={t('筛选待优化笔记')} value={filter} onChange={e=>setFilter(e.target.value)} placeholder={t('筛选标题或路径')}/></div><div className="ai-note-options">{notes.filter(note=>`${note.title} ${note.path}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(note=><label key={note.path} className={session.path===note.path?'selected':''}><input type="radio" name="optimization-note" disabled={busy} checked={session.path===note.path} onChange={()=>invalidate({path:note.path})}/><span>{note.title}<small>{note.path}</small></span></label>)}</div></div><p className="subtle ai-optimization-limit">{t('完整正文最多 24,000 字符，超限请拆分后优化。')}</p><label className="ai-authorization"><input type="checkbox" disabled={!native||busy} checked={authorized} onChange={e=>onAuthorization(e.target.checked)}/><span>{t('授权当前笔记库自动发送参考片段')}</span></label></aside>
    {dialog && <div className="modal-backdrop"><form className="modal ai-save-modal" role="dialog" aria-modal="true" aria-label={dialog==='apply'?t('应用到原笔记'):t('另存为新笔记')} onSubmit={e=>{e.preventDefault();void save();}}><h2>{dialog==='apply'?t('应用到原笔记'):t('另存为新笔记')}</h2>{dialog==='apply'?<><p>{session.original?.path}</p><p>{t('确认替换这篇笔记的正文？ID、标签和其他元数据将保留。')}</p></>:<><label>{t('目录')}<select disabled={busy} value={folder} onChange={e=>setFolder(e.target.value)}><option value="">{t('根目录')}</option>{directories.map(path=><option key={path}>{path}</option>)}</select></label><label>{t('文件名')}<input required disabled={busy} value={name} onChange={e=>setName(e.target.value)}/></label></>}{error&&<p className="notice error" role="alert">{t(error)}</p>}<div className="workspace-toolbar"><button className="primary" type="submit" disabled={busy||!valid}>{busy?t('正在保存…'):dialog==='apply'?t('确认应用'):t('保存新笔记')}</button><button type="button" disabled={busy} onClick={()=>setDialog(null)}>{t('取消')}</button></div></form></div>}
  </div>;
}
