import thirdPartyNotices from '../src-tauri/licenses/ONNX-ThirdPartyNotices.txt?raw';
import apacheLicense from '../src-tauri/licenses/Apache-2.0.txt?raw';
import ortLicense from '../src-tauri/licenses/ONNX-Runtime.txt?raw';
import bindingLicense from '../src-tauri/licenses/ort-MIT.txt?raw';
import { useCallback, useEffect, useState } from 'react';
import { Download, Database, LoaderCircle } from 'lucide-react';
import { native, semanticRequest, errorText } from './api';
import { t, useLanguage } from './i18n';
export type SemanticStatus = {vaultId:string; modelReady:boolean; enabled:boolean; paused:boolean; busy:boolean; stats:{notes:number;chunks:number}; pending:number; model:string; modelBytes:number; progress:{phase:string;vaultId:string;done:number;total:number;error:string}};
export function SemanticSettings(){
 useLanguage();
 const [status,setStatus]=useState<SemanticStatus|null>(null),[message,setMessage]=useState(''),[working,setWorking]=useState(false),[mirror,setMirror]=useState(false);
 const refresh=useCallback(async()=>{if(native)try{setStatus(await semanticRequest<SemanticStatus>({action:'status'}));}catch(e){setMessage(errorText(e));}},[]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer);},[refresh]);
 async function run(request:Record<string,unknown>){setWorking(true);setMessage('');try{await semanticRequest(request);await refresh();}catch(e){setMessage(errorText(e));}finally{setWorking(false);}}
 const busy=working||status?.busy, progress=status?.progress && (!status.progress.vaultId || status.progress.vaultId===status.vaultId)?status.progress:undefined;
 const phases:Record<string,string>={loading:t("正在加载本地模型"),downloading:t('正在下载模型'),indexing:t('正在更新索引'),ready:t('就绪'),error:t('处理未完成')};
 return <section className="semantic-settings"><h2><Database size={18}/>{t('本地语义检索')}</h2><p className="subtle">{t('模型在本机运行，无需额外服务。建立索引不发送笔记；问答仍通过预览和授权发送相关片段到云端。')}</p>
 <div className="semantic-model-card"><strong>Multilingual MiniLM · INT8</strong><span>{t('支持中文、英文、日文 · CPU 推理 · 首次下载约 129 MiB')}</span><span>{status?.modelReady?t('模型已下载'):t('模型未下载')}</span></div>
 <label className="semantic-source">{t('模型下载源')}<select disabled={!!busy||!native} value={mirror?'mirror':'official'} onChange={e=>setMirror(e.target.value==='mirror')}><option value="official">Hugging Face</option><option value="mirror">hf-mirror.com</option></select></label>
 <div className="workspace-toolbar"><button disabled={!!busy||!native} onClick={()=>void run({action:'download',mirror})}><Download size={14}/>{status?.modelReady?t('校验并修复模型'):t('下载本地模型')}</button></div>
 <label className="semantic-toggle"><input type="checkbox" checked={status?.enabled??false} disabled={!native||!status?.modelReady||(!!busy&&!status?.enabled)} onChange={e=>void run({action:'configure',enabled:e.target.checked})}/>{t('为当前笔记库启用语义检索')}</label>
 <p className="subtle">{t('索引仅保存在本机，不进入 Git。启用后后台检查新增、修改、删除及同步后的笔记。')}</p>
 {status&&<div className="semantic-stats"><span>{t('已索引笔记')} <strong>{status.stats.notes}</strong></span><span>{t('正文片段')} <strong>{status.stats.chunks}</strong></span><span>{t('待更新笔记')} <strong>{status.pending}</strong></span></div>}
 <div className="workspace-toolbar"><button disabled={!native||!status?.modelReady||!!busy} onClick={()=>void run({action:'index',rebuild:false})}>{t('更新索引')}</button><button disabled={!native||!status?.modelReady||!!busy} onClick={()=>void run({action:'index',rebuild:true})}>{t('重新建立索引')}</button>{busy&&<button onClick={()=>void semanticRequest({action:'cancel'}).then(refresh).catch(e=>setMessage(errorText(e)))}>{t('停止')}</button>}</div>
 {progress&&(!progress.vaultId||progress.vaultId===status?.vaultId)&&<div role="status" className="semantic-progress">{busy&&<LoaderCircle size={14}/>}<span>{phases[progress.phase]??''}{progress.total>0?` · ${Math.round(100*progress.done/progress.total)}%`:''}</span>{progress.total>0&&<progress value={progress.done} max={progress.total}/>}</div>}
 {status?.paused&&<p className="notice">{t('后台索引已暂停，点击更新索引可继续。')}</p>}{(message||progress?.error)&&<p className="notice" role="status">{t(message||progress!.error)}</p>}
 {!native&&<p className="notice">{t('本地语义检索仅支持桌面应用。')}</p>}
 <details className="semantic-licenses"><summary>{t("模型与运行库许可")}</summary><p>Sentence Transformers / Xenova MiniLM · Apache-2.0<br/>FastEmbed · Apache-2.0<br/>ONNX Runtime · MIT<br/>ort · MIT / Apache-2.0</p><pre>{apacheLicense}</pre><pre>{ortLicense}</pre><pre>{bindingLicense}</pre><pre>{thirdPartyNotices}</pre></details>
 </section>;
}
