import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SemanticSettings } from './SemanticSettings';
import { setLanguage } from './i18n';
describe('local semantic settings',()=>{
 it('explains the privacy boundary and disables native operations in browsers',()=>{
  setLanguage('zh-CN');const html=renderToStaticMarkup(<SemanticSettings/>);
  expect(html).toContain('建立索引不发送笔记');expect(html).toContain('为当前笔记库启用语义检索');
  expect(html).toContain('129 MiB');expect(html).toContain('hf-mirror.com');
  expect(html).toContain('disabled=""');expect(html).not.toContain('checked=""');
 });
 it('renders English and Japanese management labels',()=>{
  setLanguage('en');expect(renderToStaticMarkup(<SemanticSettings/>)).toContain('Local semantic search');
  setLanguage('ja');expect(renderToStaticMarkup(<SemanticSettings/>)).toContain('ローカル意味検索');setLanguage('zh-CN');
 });
});
