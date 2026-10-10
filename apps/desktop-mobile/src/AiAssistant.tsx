import { t, useLanguage } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Answer } from './AiAnswer';
export { Answer, citationParts } from './AiAnswer';
import { NoteOptimizer, emptyOptimization, type OptimizationSession } from './NoteOptimizer';
import { WandSparkles, ArrowUp, BookOpen, FilePlus2, FileText, LoaderCircle, MessageSquare, Search, Settings2, Square, Trash2 } from 'lucide-react';
import brandLogo from './assets/brand-logo.png';
import { aiRequest, errorText, native, type AiPrepared, type AiSource } from './api';

type Mode='ask'|'summarize'|'generate'|'optimize';
export type AiSession={optimization:OptimizationSession;mode:Mode;question:string;keywords:string;selected:string[];answer:string;sources:AiSource[];messages:{question:string;answer:string;sources:AiSource[]}[]};
export const emptyAiSession=():AiSession=>({optimization:emptyOptimization(),mode:'ask',question:'',keywords:'',selected:[],answer:'',sources:[],messages:[]});
export function AiAssistant({vaultId,notes,directories,initial,onSession,onOpen,onSettings,onSave,summaryPath,beforeOptimize,onApplyOptimization}:{
  vaultId:string;notes:{path:string;title:string}[];directories:string[];initial:AiSession;onSession:(session:AiSession)=>void;
  onOpen:(path:string)=>void;onSettings:()=>void;onSave:(path:string,body:string)=>Promise<boolean>;summaryPath:string;beforeOptimize:()=>Promise<boolean>;onApplyOptimization:(path:string,hash:string,body:string)=>Promise<boolean>;
}){
  useLanguage();
  const [session,setSession]=useState(initial),[prepared,setPrepared]=useState<AiPrepared|null>(null),[normalBusy,setBusy]=useState(false),[error,setError]=useState(''),[authorized,setAuthorized]=useState(false),[saveOpen,setSaveOpen]=useState(false),[body,setBody]=useState(''),[folder,setFolder]=useState(''),[name,setName]=useState(t('AI 笔记.md')),[filter,setFilter]=useState(''),[authorizeService,setAuthorizeService]=useState('');
  const [optimizeBusy,setOptimizeBusy]=useState(false);
  const busy=normalBusy||optimizeBusy;
  const requestId=useRef(''),mounted=useRef(true);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{onSession(session);},[session,onSession]);
  useEffect(()=>{if(summaryPath)setSession(previous=>({...previous,mode:'summarize',selected:[summaryPath],question:t("总结这篇笔记的重点与待办。")}));},[summaryPath]);
  useEffect(()=>{if(native)aiRequest<boolean>(vaultId,{action:'permission'}).then(setAuthorized).catch(()=>{});},[vaultId]);
  useEffect(()=>{
    mounted.current=true;if(!native)return()=>{mounted.current=false;};let stop:(()=>void)|undefined;let disposed=false;
    listen<{requestId:string;vaultId:string;text:string}>('ai_delta',event=>{if(event.payload.vaultId===vaultId&&event.payload.requestId===requestId.current)setSession(previous=>({...previous,answer:previous.answer+event.payload.text}));}).then(unlisten=>{if(disposed)unlisten();else stop=unlisten;}).catch(e=>setError(errorText(e)));
    return()=>{disposed=true;mounted.current=false;stop?.();if(requestId.current)void aiRequest(vaultId,{action:'cancel',id:requestId.current}).catch(()=>{});};
  },[vaultId]);
  async function send(value:AiPrepared,confirmed:boolean){
    setBusy(true);setError('');setPrepared(null);requestId.current=value.id;setSession(previous=>({...previous,answer:'',sources:value.sources}));
    try{const result=await aiRequest<{text:string;sources:AiSource[]}>(vaultId,{action:'send',id:value.id,confirmed});if(mounted.current)setSession(previous=>({...previous,answer:result.text,sources:result.sources,messages:[...previous.messages,{question:value.question,answer:result.text,sources:result.sources}].slice(-6)}));}
    catch(e){if(mounted.current)setError(errorText(e));}finally{if(mounted.current)setBusy(false);requestId.current='';}
  }
  async function prepare(){setBusy(true);setError('');try{const value=await aiRequest<AiPrepared>(vaultId,{action:'prepare',mode:session.mode,question:session.question|| (session.mode==='summarize'?t("总结选中的笔记。"):''),keywords:session.keywords,paths:session.selected});if(!mounted.current)return;setAuthorized(value.authorized);if(value.authorized)await send(value,false);else setPrepared(value);}catch(e){if(mounted.current)setError(errorText(e));}finally{if(mounted.current)setBusy(false);}}
  async function authorize(enabled:boolean){setError('');try{await aiRequest(vaultId,{action:'authorize',enabled,service:authorizeService});setAuthorized(enabled);setAuthorizeService('');}catch(e){setError(errorText(e));}}
  async function requestAuthorization(){try{const value=await aiRequest<{config:{baseUrl:string}|null}>(vaultId,{action:'config'});if(!value.config)throw new Error(t("请先配置 AI 模型"));setAuthorizeService(value.config.baseUrl);}catch(e){setError(errorText(e));}}
  async function clear(){setBusy(true);setError('');try{if(native)await aiRequest(vaultId,{action:'clear'});setSession(emptyAiSession());setPrepared(null);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  async function save(){if(saving)return;setSaving(true);try{if(await onSave(folder?`${folder}/${name}`:name,body))setSaveOpen(false);}catch(e){setError(errorText(e));}finally{setSaving(false);}}
  const modeLabels = {ask:t("笔记库问答"),summarize:t("总结笔记"),generate:t("生成笔记"),optimize:t("笔记优化")};
  const modeIcons = {ask:MessageSquare,summarize:FileText,generate:FilePlus2,optimize:WandSparkles};
  return <section className="ai-page"><header className="ai-header"><h1>{t("AI 助理")}</h1><div className="ai-header-actions"><button className="ai-icon-button" disabled={busy} title={t("清空对话")} aria-label={t("清空对话")} onClick={()=>void clear()}><Trash2 size={17}/></button><button className="ai-settings-button" onClick={onSettings}><Settings2 size={16}/>{t("模型设置")}</button></div></header>
    {!native&&<p className="notice">{t("浏览器仅展示界面；请在桌面应用中使用 AI 助理。")}</p>}
    <div className="ai-mode-tabs" role="group" aria-label={t("AI 模式")}>{(['ask','summarize','generate','optimize'] as const).map(mode=>{const ModeIcon=modeIcons[mode];return <button key={mode} disabled={busy} aria-pressed={session.mode===mode} className={session.mode===mode?'selected':''} onClick={()=>{setPrepared(null);setSession({...session,mode});}}><ModeIcon size={16}/>{modeLabels[mode]}</button>;})}</div>
    {session.mode==='optimize'&&error&&<p className="notice error" role="alert">{t(error)}</p>}
    {session.mode==='optimize'?<NoteOptimizer vaultId={vaultId} notes={notes} directories={directories} session={session.optimization} onChange={update=>setSession(previous=>({...previous,optimization:typeof update==='function'?update(previous.optimization):update}))} onBusy={setOptimizeBusy} beforePrepare={beforeOptimize} onApply={onApplyOptimization} onSave={onSave} onOpen={onOpen} authorized={authorized} onAuthorization={enabled=>{if(enabled)void requestAuthorization();else void authorize(false);}}/>:<div className="ai-workbench"><div className="ai-conversation"><div className="ai-results">
      {!prepared&&!session.answer&&!session.messages.length&&!busy&&!error&&<div className="ai-empty"><img src={brandLogo} alt=""/><h2>{modeLabels[session.mode]}</h2><p>{session.mode==='ask'?t("关于笔记库，你想了解什么？"):session.mode==='summarize'?t("总结选中的笔记。"):t("生成要求")}</p></div>}
      {prepared&&<section className="ai-preview"><h2>{t("发送预览")}</h2><p className="subtle">{prepared.config.baseUrl} · {prepared.config.model}</p><p>{prepared.question}</p>{!!prepared.history.length&&<details><summary>{t("本次包含的会话文本")}</summary>{prepared.history.map((message,index)=><pre key={index}>{message.role==='user'?t("用户"):t("助理")}：{message.content}</pre>)}</details>}{prepared.sources.map(source=><details key={source.id} open><summary>[{source.id}] {source.path}{source.truncated?t(" · 已截取"):''}</summary><pre>{source.text}</pre></details>)}{!prepared.sources.length&&<p>{t("不包含参考笔记")}</p>}<div className="workspace-toolbar"><button className="primary" disabled={busy} onClick={()=>void send(prepared,true)}>{t("确认发送")}</button><button onClick={()=>setPrepared(null)}>{t("取消")}</button></div></section>}
      {error&&<p className="notice error" role="alert">{t(error)}</p>}{busy&&<p className="ai-generating" role="status"><LoaderCircle size={16}/>{t("正在生成…")}</p>}
      {session.messages.slice(0,session.answer===session.messages.at(-1)?.answer?-1:undefined).map((message,index)=><section className="ai-message" key={index}><h2>{message.question}</h2><Answer text={message.answer} sources={message.sources} onOpen={onOpen}/></section>)}
      {session.answer&&<section className="ai-message"><Answer text={session.answer} sources={session.sources} onOpen={onOpen}/><button disabled={busy} onClick={()=>{setBody(session.answer);setSaveOpen(true);}}>{t("保存为新笔记")}</button></section>}
    </div><div className="ai-composer">
      <textarea aria-label={session.mode==='generate'?t("生成要求"):session.mode==='summarize'?t("总结要求"):t("问题")} disabled={busy} value={session.question} maxLength={16000} onChange={e=>{setPrepared(null);setSession({...session,question:e.target.value});}} placeholder={session.mode==='ask'?t("关于笔记库，你想了解什么？"):t("输入要求")}/>
      <div className="ai-composer-footer"><span className="ai-context-count"><BookOpen size={14}/>{t("参考笔记 · 已选")} {session.selected.length}</span>
        {busy&&requestId.current?<button className="ai-send-button ai-stop-button" title={t("停止生成")} aria-label={t("停止生成")} onClick={()=>void aiRequest(vaultId,{action:'cancel',id:requestId.current}).catch(e=>setError(errorText(e)))}><Square size={12} fill="currentColor" strokeWidth={0}/></button>:<button className="ai-send-button" disabled={busy||!native||(!session.question.trim()&&session.mode!=='summarize')} title={error?t("重新准备"):t("准备参考内容")} aria-label={error?t("重新准备"):t("准备参考内容")} onClick={()=>void prepare()}>{busy?<LoaderCircle size={18}/>:<ArrowUp size={18}/>}</button>}
      </div>
    </div></div><aside className="ai-context-panel">
      <div className="ai-context-heading"><BookOpen size={16}/><h2>{t("参考笔记 · 已选")}</h2><span>{session.selected.length}/10</span></div>
      {session.mode==='ask'&&<label className="ai-keywords">{t("检索关键词")}<input disabled={busy} maxLength={16000} value={session.keywords} onChange={e=>{setPrepared(null);setSession({...session,keywords:e.target.value});}} placeholder={t("默认使用问题检索")}/></label>}
      <div className="ai-note-picker"><div className="ai-note-search"><Search size={15}/><input aria-label={t("筛选参考笔记")} value={filter} onChange={e=>setFilter(e.target.value)} placeholder={t("筛选标题或路径")}/></div><div className="ai-note-options">{notes.filter(note=>`${note.title} ${note.path}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(note=><label key={note.path} className={session.selected.includes(note.path)?'selected':''}><input type="checkbox" disabled={busy||(!session.selected.includes(note.path)&&session.selected.length>=10)} checked={session.selected.includes(note.path)} onChange={e=>{setPrepared(null);setSession({...session,selected:e.target.checked?[...session.selected,note.path]:session.selected.filter(path=>path!==note.path)});}}/><span>{note.title}<small>{note.path}</small></span></label>)}</div></div>
      <label className="ai-authorization"><input type="checkbox" disabled={!native||busy} checked={authorized} onChange={e=>{if(e.target.checked)void requestAuthorization();else void authorize(false);}}/><span>{t("授权当前笔记库自动发送参考片段")}</span></label>
    </aside></div>}
    {!!authorizeService&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={t("授权 AI 发送")}><h2>{t("授权发送笔记片段")}</h2><p>{t("向")} {authorizeService} {t("发送当前笔记库中的参考片段和会话文本，每次最多 10 篇、24,000 个参考字符。授权后，点击生成会直接发送。可以随时取消授权。")}</p><div className="workspace-toolbar"><button onClick={()=>void authorize(true)}>{t("确认授权")}</button><button onClick={()=>setAuthorizeService('')}>{t("取消")}</button></div></section></div>}
    {saveOpen&&<div className="modal-backdrop"><form className="modal ai-save-modal" role="dialog" aria-modal="true" aria-label={t("保存 AI 笔记")} onSubmit={e=>{e.preventDefault();void save();}}><h2>{t("保存为新笔记")}</h2><label>{t("目录")}<select disabled={saving} value={folder} onChange={e=>setFolder(e.target.value)}><option value="">{t("根目录")}</option>{directories.map(path=><option key={path}>{path}</option>)}</select></label><label>{t("文件名")}<input disabled={saving} required value={name} onChange={e=>setName(e.target.value)}/></label><label>Markdown<textarea disabled={saving} required value={body} onChange={e=>setBody(e.target.value)}/></label><div className="workspace-toolbar"><button disabled={saving} type="submit">{saving?t("正在保存…"):t("保存新笔记")}</button><button disabled={saving} type="button" onClick={()=>setSaveOpen(false)}>{t("取消")}</button></div></form></div>}
  </section>;
}
