import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from './i18n';
beforeEach(() => setLanguage('zh-CN'));
import { renderToStaticMarkup } from 'react-dom/server';
import { Answer, AiAssistant, citationParts, emptyAiSession } from './AiAssistant';
import type { AiSource } from './api';
const sources:AiSource[]=[{id:1,path:'项目/计划.md',text:'参考内容',contentHash:'hash',truncated:false}];
describe('AI assistant',()=>{
  it('links only real source citations and prevents executable HTML and remote media',()=>{
    const html=renderToStaticMarkup(<Answer text={'参考 [1]，不存在 [9]。\n\n[恶意](https://evil.test) ![图片](https://evil.test/pixel)\n\n<script>alert(1)</script>\n\n`[1]`'} sources={sources} onOpen={()=>{}}/>);
    expect(html).toContain('title="项目/计划.md"');
    expect(html).toContain('不存在 [9]');
    expect(html).not.toContain('href="https://evil.test');
    expect(html).not.toContain('<img');expect(html).not.toContain('<script');
    expect(html).toContain('<code>[1]</code>');
    expect(citationParts('[1] [2]',sources).filter(part=>part.source)).toHaveLength(1);
  });
  it('starts with no output or authorization and exposes all three modes',()=>{
    const html=renderToStaticMarkup(<AiAssistant vaultId="demo" notes={[]} directories={[]} initial={emptyAiSession()} onSession={()=>{}} onOpen={()=>{}} onSettings={()=>{}} onSave={async()=>false} summaryPath=""/>);
    expect(html).toContain('笔记库问答');expect(html).toContain('总结笔记');expect(html).toContain('生成笔记');
    expect(html).not.toContain('checked=""');expect(html).not.toContain('保存为新笔记');
  });
  it('does not expose another vault session through default state',()=>{
    const first=emptyAiSession();first.answer='private content';
    expect(emptyAiSession().answer).toBe('');expect(emptyAiSession().messages).toEqual([]);
  });
});
