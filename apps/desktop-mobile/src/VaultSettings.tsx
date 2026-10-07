import { t, useLanguage } from './i18n';
import { useEffect, useState } from 'react';
import { api, errorText, type VaultHistoryEntry } from './api';

export function VaultSettings({currentId,disabled,onOpen}:{currentId?:string;disabled:boolean;onOpen:(id:string)=>Promise<void>}) {
  useLanguage();
  const [entries,setEntries]=useState<VaultHistoryEntry[]>([]),[error,setError]=useState(''),[removing,setRemoving]=useState(false);
  useEffect(()=>{let active=true;api.vaultCatalog().then(value=>{if(active){setEntries(value);setError('');}}).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[currentId]);
  async function forget(id:string){setRemoving(true);try{await api.forgetVault(id);setEntries(await api.vaultCatalog());setError('');}catch(e){setError(errorText(e));}finally{setRemoving(false);}}
  return <div className="vault-history"><h2>{t("笔记库列表")}</h2>{entries.map(entry=><div className="vault-history-row" key={entry.id}>
    <div className="vault-history-copy"><strong>{entry.demo?t('墨知示例笔记'):entry.name}</strong><span className="subtle">{entry.demo?t("默认演示笔记库"):entry.available?t("最近打开"):t("目录不可访问")}{entry.id===currentId?t(" · 当前"):''}</span>{entry.path&&<small title={entry.path}>{entry.path}</small>}</div>
    <div className="vault-history-actions"><button disabled={disabled||removing||entry.id===currentId||!entry.available} onClick={()=>void onOpen(entry.id)}>{entry.id===currentId?t("当前笔记库"):t("打开")}</button>{!entry.demo&&<button disabled={disabled||removing} title={t("移除记录，不删除文件")} aria-label={t("移除 {0} 的打开记录", entry.name)} onClick={()=>void forget(entry.id)}>{t("移除记录")}</button>}</div>
  </div>)}{error&&<p className="notice error" role="alert">{t(error)}</p>}</div>;
}
