import { t, useLanguage } from './i18n';
import { useEffect, useState } from 'react';
import { aiRequest, api, errorText, native, type AiConfig } from './api';

export function AiSettings() {
  useLanguage();
  const [config,setConfig]=useState<AiConfig>({baseUrl:'',model:''});
  const [hasKey,setHasKey]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{if(native)aiRequest<{config:AiConfig|null;hasKey:boolean}>('',{action:'config'}).then(value=>{if(value.config)setConfig(value.config);setHasKey(value.hasKey);}).catch(e=>setMessage(errorText(e)));},[]);
  async function run(action:()=>Promise<void>){setBusy(true);setMessage('');try{await action();}catch(e){setMessage(errorText(e));}finally{setBusy(false);}}
  async function save(){await aiRequest('',{action:'configure',config});}
  return <section className="settings-page ai-settings"><h1>{t("AI 模型")}</h1>
    <div className="ai-config-fields"><label>Base URL<input disabled={busy||!native} value={config.baseUrl} placeholder="https://api.example.com/v1" onChange={e=>{setConfig({...config,baseUrl:e.target.value});setHasKey(false);}}/></label><label>{t("模型名称")}<input disabled={busy||!native} value={config.model} placeholder={t("模型 ID")} onChange={e=>setConfig({...config,model:e.target.value})}/></label></div>
    <div className="setting-row"><span>API Key</span><span className="subtle">{hasKey?t("已保存在系统凭据库"):t("未设置")}</span></div>
    <div className="workspace-toolbar"><button disabled={busy||!native} onClick={()=>void run(async()=>{await save();const result=await aiRequest<{hasKey:boolean}>('',{action:'config'});setHasKey(result.hasKey);setMessage(t("模型设置已保存"));})}>{t("保存设置")}</button><button disabled={busy||!native} onClick={()=>void run(async()=>{await save();if(await api.aiKey()){setHasKey(true);setMessage(t("API Key 已保存"));}})}>{t("设置 API Key")}</button><button disabled={busy||!native} onClick={()=>void run(async()=>{await save();await aiRequest('',{action:'test'});setMessage(t("模型连接成功"));})}>{t("测试连接")}</button><button disabled={busy||!native} onClick={()=>void run(async()=>{await save();await aiRequest('',{action:'delete_key'});setHasKey(false);setMessage(t("API Key 已删除"));})}>{t("删除凭据")}</button></div>
    {!native&&<p className="notice">{t("请在桌面应用中配置模型。")}</p>}{busy&&<p role="status">{t("正在处理…")}</p>}{message&&<p className="notice" role="status">{t(message)}</p>}
  </section>;
}
