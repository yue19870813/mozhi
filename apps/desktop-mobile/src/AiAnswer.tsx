import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLanguage } from './i18n';
import type { AiSource } from './api';
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
