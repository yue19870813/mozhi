import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { McpSettings, canSaveMcp, mcpStatusLabel, type McpPreferences, type McpStatus } from './McpSettings';
import { setLanguage, type Language } from './i18n';
afterEach(()=>setLanguage('zh-CN'));
describe('MCP settings',()=>{
  it.each<[Language,string]>([['zh-CN','MCP 服务'],['en','MCP service'],['ja','MCP サービス']])('renders %s with secure defaults and placeholder-only client configuration',(language,title)=>{
    setLanguage(language);
    const html=renderToStaticMarkup(<McpSettings vaultId="synthetic" vaultName="Test vault"/>);
    expect(html).toContain(title);expect(html).toContain('127.0.0.1:37891/mcp');
    expect(html).toContain('MOZHI_MCP_TOKEN');expect(html).toContain('bearer_token_env_var');
    expect(html).toContain('Bearer ${MOZHI_MCP_TOKEN}');expect(html).not.toContain('checked=""');
    expect(html.match(/type="checkbox"/g)).toHaveLength(4);expect(html).toContain('Test vault');
  });
  it('requires explicit read authorization and a valid desktop vault before saving',()=>{
    const value:McpPreferences={enabled:true,port:37891,vaultId:'',vaultName:'',read:false,create:false,ask:false};
    expect(canSaveMcp(value,'one',true,false)).toBe(false);
    value.read=true;expect(canSaveMcp(value,'one',true,false)).toBe(true);
    for(const port of [0,65536,1.5])expect(canSaveMcp({...value,port},'one',true,false)).toBe(false);
    expect(canSaveMcp(value,undefined,true,false)).toBe(false);expect(canSaveMcp(value,'one',false,false)).toBe(false);expect(canSaveMcp(value,'one',true,true)).toBe(false);
  });
  it('shows pause after switching away without changing the authorized vault',()=>{
    const status:McpStatus={settings:{enabled:true,port:37891,vaultId:'one',vaultName:'One',read:true,create:false,ask:false},running:true,available:true,error:null,url:''};
    expect(mcpStatusLabel(status)).toBe('服务运行中');status.available=false;expect(mcpStatusLabel(status)).toBe('已暂停：请切回授权笔记库');expect(status.settings.vaultId).toBe('one');status.running=false;expect(mcpStatusLabel(status)).toBe('服务已停止');
  });
  it('disables all browser service and credential controls',()=>{
    const html=renderToStaticMarkup(<McpSettings vaultId="demo" vaultName="Demo"/>);
    expect(html).toContain('MCP 服务仅支持桌面应用。');
    for(const match of html.matchAll(/<(?:button|input)\b[^>]*>/g)){if(!match[0].includes('role="tab"'))expect(match[0]).toContain('disabled=""');}
  });
});
