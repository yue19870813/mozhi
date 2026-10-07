import { t, useLanguage } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { aiRequest, errorText, native, type AiPrepared, type AiSource } from './api';

type Mode='ask'|'summarize'|'generate';
export type AiSession={mode:Mode;question:string;keywords:string;selected:string[];answer:string;sources:AiSource[];messages:{question:string;answer:string;sources:AiSource[]}[]};
export const emptyAiSession=():AiSession=>({mode:'ask',question:'',keywords:'',selected:[],answer:'',sources:[],messages:[]});
export function citationParts(text:string,sources:AiSource[]) {
  return text.split(/(\[\d+\])/g).map(part=>({text:part,source:sources.find(source=>`[${source.id}]`===part)}));
}
type MarkdownNode={type:string;value?:string;url?:string;children?:MarkdownNode[]};
function citations(sources:AiSource[]){return()=> (tree:MarkdownNode)=>{
  function walk(node:MarkdownNode){
    if(!node.children||node.type==='link'||node.type==='code'||node.type==='inlineCode')return;
    node.children=node.children.flatMap(child=>{
      if(child.type==='text'&&child.value)return citationParts(child.value,sources).map(part=>part.source?{type:'link',url:`mozhi-source:${part.source.id}`,children:[{type:'text',value:part.text}]}:{type:'text',value:part.text});
      walk(child);return [child];
    });
  }
  walk(tree);
};}
export function Answer({text,sources,onOpen}:{text:string;sources:AiSource[];onOpen:(path:string)=>void}){
  useLanguage();
  return <div className="markdown-preview ai-answer"><ReactMarkdown remarkPlugins={[remarkGfm,citations(sources)]} urlTransform={url=>/^mozhi-source:\d+$/.test(url)?url:''} components={{a:({children,href})=>{const source=sources.find(item=>`mozhi-source:${item.id}`===href);return source?<button className="wiki-link" title={source.path} onClick={()=>onOpen(source.path)}>{children}</button>:<span>{children}</span>;},img:()=>null}}>{text}</ReactMarkdown><div className="ai-citations">{sources.map(source=><button key={source.id} onClick={()=>onOpen(source.path)}>[{source.id}] {source.path}</button>)}</div></div>;
}
export function AiAssistant({vaultId,notes,directories,initial,onSession,onOpen,onSettings,onSave,summaryPath}:{
  vaultId:string;notes:{path:string;title:string}[];directories:string[];initial:AiSession;onSession:(session:AiSession)=>void;
  onOpen:(path:string)=>void;onSettings:()=>void;onSave:(path:string,body:string)=>Promise<boolean>;summaryPath:string;
}){
  useLanguage();
  const [session,setSession]=useState(initial),[prepared,setPrepared]=useState<AiPrepared|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[authorized,setAuthorized]=useState(false),[saveOpen,setSaveOpen]=useState(false),[body,setBody]=useState(''),[folder,setFolder]=useState(''),[name,setName]=useState(t('AI 笔记.md')),[filter,setFilter]=useState(''),[authorizeService,setAuthorizeService]=useState('');
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
  return <section className="ai-page"><header className="ai-header"><h1>{t("AI 助理")}</h1><button onClick={onSettings}>{t("模型设置")}</button></header>
    {!native&&<p className="notice">{t("浏览器仅展示界面；请在桌面应用中使用 AI 助理。")}</p>}
    <div className="segmented" role="group" aria-label={t("AI 模式")}>{(['ask','summarize','generate'] as const).map((mode,index)=><button key={mode} disabled={busy} aria-pressed={session.mode===mode} className={session.mode===mode?'selected':''} onClick={()=>{setPrepared(null);setSession({...session,mode});}}>{[t("笔记库问答"),t("总结笔记"),t("生成笔记")][index]}</button>)}</div>
    <div className="ai-workbench"><div className="ai-composer"><label>{session.mode==='generate'?t("生成要求"):session.mode==='summarize'?t("总结要求"):t("问题")}<textarea disabled={busy} value={session.question} maxLength={16000} onChange={e=>{setPrepared(null);setSession({...session,question:e.target.value});}} placeholder={session.mode==='ask'?t("关于笔记库，你想了解什么？"):t("输入要求")}/></label>
      {session.mode==='ask'&&<label>{t("检索关键词")}<input disabled={busy} maxLength={16000} value={session.keywords} onChange={e=>{setPrepared(null);setSession({...session,keywords:e.target.value});}} placeholder={t("默认使用问题检索")}/></label>}
      <details className="ai-note-picker"><summary>{t("参考笔记 · 已选")} {session.selected.length}</summary><input aria-label={t("筛选参考笔记")} value={filter} onChange={e=>setFilter(e.target.value)} placeholder={t("筛选标题或路径")}/><div className="ai-note-options">{notes.filter(note=>`${note.title} ${note.path}`.includes(filter)).map(note=><label key={note.path}><input type="checkbox" disabled={busy||(!session.selected.includes(note.path)&&session.selected.length>=10)} checked={session.selected.includes(note.path)} onChange={e=>{setPrepared(null);setSession({...session,selected:e.target.checked?[...session.selected,note.path]:session.selected.filter(path=>path!==note.path)});}}/><span>{note.title}<small>{note.path}</small></span></label>)}</div></details>
      <div className="workspace-toolbar"><button className="primary" disabled={busy||!native||(!session.question.trim()&&session.mode!=='summarize')} onClick={()=>void prepare()}>{error?t("重新准备"):t("准备参考内容")}</button>{busy&&requestId.current&&<button onClick={()=>void aiRequest(vaultId,{action:'cancel',id:requestId.current}).catch(e=>setError(errorText(e)))}>{t("停止生成")}</button>}<button disabled={busy} onClick={()=>void clear()}>{t("清空对话")}</button></div>
      <label className="ai-authorization"><input type="checkbox" disabled={!native||busy} checked={authorized} onChange={e=>{if(e.target.checked)void requestAuthorization();else void authorize(false);}}/>{t("授权当前笔记库自动发送参考片段")}</label>
    </div><div className="ai-results">
      {prepared&&<section className="ai-preview"><h2>{t("发送预览")}</h2><p className="subtle">{prepared.config.baseUrl} · {prepared.config.model}</p><p>{prepared.question}</p>{!!prepared.history.length&&<details><summary>{t("本次包含的会话文本")}</summary>{prepared.history.map((message,index)=><pre key={index}>{message.role==='user'?t("用户"):t("助理")}：{message.content}</pre>)}</details>}{prepared.sources.map(source=><details key={source.id} open><summary>[{source.id}] {source.path}{source.truncated?t(" · 已截取"):''}</summary><pre>{source.text}</pre></details>)}{!prepared.sources.length&&<p>{t("不包含参考笔记")}</p>}<div className="workspace-toolbar"><button className="primary" disabled={busy} onClick={()=>void send(prepared,true)}>{t("确认发送")}</button><button onClick={()=>setPrepared(null)}>{t("取消")}</button></div></section>}
      {error&&<p className="notice error" role="alert">{t(error)}</p>}{busy&&<p role="status">{t("正在生成…")}</p>}
      {session.messages.slice(0,session.answer===session.messages.at(-1)?.answer?-1:undefined).map((message,index)=><section className="ai-message" key={index}><h2>{message.question}</h2><Answer text={message.answer} sources={message.sources} onOpen={onOpen}/></section>)}
      {session.answer&&<section className="ai-message"><Answer text={session.answer} sources={session.sources} onOpen={onOpen}/><button disabled={busy} onClick={()=>{setBody(session.answer);setSaveOpen(true);}}>{t("保存为新笔记")}</button></section>}
    </div></div>
    {!!authorizeService&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={t("授权 AI 发送")}><h2>{t("授权发送笔记片段")}</h2><p>{t("向")} {authorizeService} {t("发送当前笔记库中的参考片段和会话文本，每次最多 10 篇、24,000 个参考字符。授权后，点击生成会直接发送。可以随时取消授权。")}</p><div className="workspace-toolbar"><button onClick={()=>void authorize(true)}>{t("确认授权")}</button><button onClick={()=>setAuthorizeService('')}>{t("取消")}</button></div></section></div>}
    {saveOpen&&<div className="modal-backdrop"><form className="modal ai-save-modal" role="dialog" aria-modal="true" aria-label={t("保存 AI 笔记")} onSubmit={e=>{e.preventDefault();void save();}}><h2>{t("保存为新笔记")}</h2><label>{t("目录")}<select disabled={saving} value={folder} onChange={e=>setFolder(e.target.value)}><option value="">{t("根目录")}</option>{directories.map(path=><option key={path}>{path}</option>)}</select></label><label>{t("文件名")}<input disabled={saving} required value={name} onChange={e=>setName(e.target.value)}/></label><label>Markdown<textarea disabled={saving} required value={body} onChange={e=>setBody(e.target.value)}/></label><div className="workspace-toolbar"><button disabled={saving} type="submit">{saving?t("正在保存…"):t("保存新笔记")}</button><button disabled={saving} type="button" onClick={()=>setSaveOpen(false)}>{t("取消")}</button></div></form></div>}
  </section>;
}
