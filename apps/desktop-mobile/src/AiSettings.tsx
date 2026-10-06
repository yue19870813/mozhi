import { useEffect, useState } from 'react';
import { aiRequest, api, errorText, native, type AiConfig } from './api';

export function AiSettings() {
  const [config,setConfig]=useState<AiConfig>({baseUrl:'',model:''});
  const [hasKey,setHasKey]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{if(native)aiRequest<{config:AiConfig|null;hasKey:boolean}>('',{action:'config'}).then(value=>{if(value.config)setConfig(value.config);setHasKey(value.hasKey);}).catch(e=>setMessage(errorText(e)));},[]);
  async function run(action:()=>Promise<void>){setBusy(true);setMessage('');try{await action();}catch(e){setMessage(errorText(e));}finally{setBusy(false);}}
  async function save(){await aiRequest('',{action:'configure',config});}
  return <section className="settings-page ai-settings"><h1>AI 模型</h1>
    <div className="ai-config-fields"><label>Base URL<input disabled={busy||!native} value={config.baseUrl} placeholder="https://api.example.com/v1" onChange={e=>{setConfig({...config,baseUrl:e.target.value});setHasKey(false);}}/></label><label>模型名称<input disabled={busy||!native} value={config.model} placeholder="模型 ID" onChange={e=>setConfig({...config,model:e.target.value})}/></label></div>
    <div className="setting-row"><span>API Key</span><span className="subtle">{hasKey?'已保存在系统凭据库':'未设置'}</span></div>
    <div className="workspace-toolbar"><button disabled={busy||!native} onClick={()=>void run(async()=>{await save();const result=await aiRequest<{hasKey:boolean}>('',{action:'config'});setHasKey(result.hasKey);setMessage('模型设置已保存');})}>保存设置</button><button disabled={busy||!native} onClick={()=>void run(async()=>{await save();if(await api.aiKey()){setHasKey(true);setMessage('API Key 已保存');}})}>设置 API Key</button><button disabled={busy||!native} onClick={()=>void run(async()=>{await save();await aiRequest('',{action:'test'});setMessage('模型连接成功');})}>测试连接</button><button disabled={busy||!native} onClick={()=>void run(async()=>{await save();await aiRequest('',{action:'delete_key'});setHasKey(false);setMessage('API Key 已删除');})}>删除凭据</button></div>
    {!native&&<p className="notice">请在桌面应用中配置模型。</p>}{busy&&<p role="status">正在处理…</p>}{message&&<p className="notice" role="status">{message}</p>}
  </section>;
}
