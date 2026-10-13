import { t, useLanguage } from './i18n';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { native, workspace } from './api';
import type { Root, Parent, Text, Link } from 'mdast';
import { openWebUrl, webUrl } from './external-links';
import { markdownBody } from './note-outline';
function wikiLinks(){return (tree:Root)=>{
  function visit(parent:Parent){
    const children:typeof parent.children=[];
    for(const node of parent.children){
      if(node.type==='text'){
        const text=(node as Text).value;let cursor=0;const pattern=/\[\[([^\]\n]+)\]\]/g;let match:RegExpExecArray|null;
        while((match=pattern.exec(text))){if(match.index>cursor)children.push({type:'text',value:text.slice(cursor,match.index)});const [target,label]=match[1].split('|');children.push({type:'link',url:`#mozhi-wiki=${encodeURIComponent(target.trim())}`,children:[{type:'text',value:label??target}]} as Link);cursor=match.index+match[0].length;}
        children.push({type:'text',value:text.slice(cursor)});
      }else{if('children' in node&&node.type!=='link'&&node.type!=='linkReference')visit(node as Parent);children.push(node);}
    }parent.children=children;
  }visit(tree);
};}
function Attachment({path,src,alt}:{path:string;src?:string;alt?:string}){
  useLanguage();
  const [url,setUrl]=useState('');
  useEffect(()=>{let active=true;setUrl('');if(!native||!src||/^[a-z][a-z\d+.-]*:/i.test(src)||src.startsWith('/'))return;
    try{const parts=path.split('/').slice(0,-1);for(const part of decodeURIComponent(src).split('/')){if(part==='..'){if(!parts.length)return;parts.pop();}else if(part&&part!=='.')parts.push(part);}const relative=parts.join('/');if(!relative.startsWith('attachments/'))return;workspace<string>({action:'attachment',path:relative}).then(data=>{if(active)setUrl(data);}).catch(()=>{});}catch{/* Invalid paths remain placeholders. */}
    return()=>{active=false;};
  },[src,path]);
  return url?<img src={url} alt={alt??t("图片附件")}/>:<span className="image-placeholder">{t("图片附件：")}{alt||src||t("不可用")}{t("（仅加载库内附件）")}</span>;
}
export function Preview({content,path='',onOpen,jump}:{content:string;path?:string;onOpen:(path:string,wiki?:boolean)=>void;jump?:{offset:number;serial:number}|null}){
  useLanguage();
  const [linkError, setLinkError] = useState(false);
  const host = useRef<HTMLElement>(null);
  const body = markdownBody(content);
  useEffect(() => {
    if (!jump) return;
    host.current?.querySelector(`[data-outline-offset="${jump.offset}"]`)?.scrollIntoView({block:'start'});
  }, [jump]);
  const heading = (Tag:'h1'|'h2'|'h3'|'h4'|'h5'|'h6') => ({node,children}:{node?:{position?:{start:{offset?:number}}};children?:React.ReactNode}) => <Tag data-outline-offset={body.offset+(node?.position?.start.offset??0)}>{children}</Tag>;
  return <article ref={host} className="markdown-preview">{linkError&&<p role="alert" className="notice error">{t('无法打开网页链接，请检查默认浏览器设置。')}</p>}<ReactMarkdown remarkPlugins={[remarkGfm,wikiLinks]} skipHtml components={{
    h1:heading('h1'),h2:heading('h2'),h3:heading('h3'),h4:heading('h4'),h5:heading('h5'),h6:heading('h6'),
    a:({href,children})=> {
      const external = href ? webUrl(href) : null;
      if (external) return <a className="inline-link" href={external} title={t('在默认浏览器中打开')} target="_blank" rel="noopener noreferrer" onClick={event=>{event.preventDefault();setLinkError(false);void openWebUrl(external).catch(()=>setLinkError(true));}}>{children}</a>;
      return <button className="inline-link" title={href} onClick={()=>{if(!href)return;try{if(href.startsWith('#mozhi-wiki=')){onOpen(decodeURIComponent(href.slice(12)),true);}else if(!/^[a-z][a-z\d+.-]*:/i.test(href)&&!href.startsWith('/'))onOpen(decodeURIComponent(href));}catch{/* Malformed URLs are inert. */}}}>{children}</button>;
    },
    img:({src,alt})=><Attachment path={path} src={src} alt={alt}/>,
  }}>{body.text}</ReactMarkdown></article>;
}
