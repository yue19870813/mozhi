import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getLanguage, initializeLanguage, languageKey, readLanguage, setLanguage, systemLanguage, t } from './i18n';
import { LanguageSettings } from './LanguageSettings';
import { HomePage } from './HomePage';
import { translations } from './locales';
import ts from 'typescript';

const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
afterEach(() => setLanguage('en'));
describe('language preferences', () => {
  it('maps Chinese and Japanese system locales and uses English for every other language', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'zh_HK', 'ZH']) expect(systemLanguage(locale)).toBe('zh-CN');
    for (const locale of ['ja', 'ja-JP', 'ja_JP']) expect(systemLanguage(locale)).toBe('ja');
    for (const locale of ['en-US', 'fr-FR', 'de', '', 'invalid']) expect(systemLanguage(locale)).toBe('en');
  });
  it('persists the first system choice and keeps manual selection across restarts and system changes', () => {
    const preferences = storage();
    initializeLanguage('ja-JP', preferences);
    expect(getLanguage()).toBe('ja');
    expect(preferences.getItem(languageKey)).toBe('ja');
    setLanguage('zh-CN', preferences);
    initializeLanguage('en-US', preferences);
    expect(getLanguage()).toBe('zh-CN');
  });
  it('recovers invalid or inaccessible preferences without interrupting startup', () => {
    const preferences = storage();
    preferences.setItem(languageKey, 'xx');
    expect(readLanguage(preferences, 'ja-JP')).toBe('ja');
    initializeLanguage('fr-FR', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
    expect(getLanguage()).toBe('en');
  });
  it('renders all three language choices and translates UI without changing user note titles or paths', () => {
    for (const language of ['zh-CN', 'en', 'ja'] as const) {
      setLanguage(language);
      const settings = renderToStaticMarkup(<LanguageSettings/>);
      for (const name of ['简体中文', 'English', '日本語']) expect(settings).toContain(name);
      const html = renderToStaticMarkup(<HomePage pinned={[{path:'用户/笔记.md',title:'我的私人内容'}]} recent={[]} all={false} busy={false} canCreate onTogglePin={()=>{}} onOpen={()=>{}} onAll={()=>{}} onNew={()=>{}} onBrowse={()=>{}}/>);
      expect(html).toContain('我的私人内容');
      expect(html).toContain('用户/笔记.md');
      expect(html).toContain(t('首页'));
      expect(html).toContain(t('置顶笔记'));
    }
  });
  it('provides complete nonempty dictionaries and interpolates values without translating their contents', () => {
    for (const pair of Object.values(translations)) expect(pair.every(value => !!value.trim())).toBe(true);
    setLanguage('en');
    const message = t('已创建 {0}', '设置.md');
    expect(message).toBe('Created 设置.md');
    setLanguage('ja');
    expect(t(message)).toBe('设置.md を作成しました');
    expect(t('已创建 {0}', 'Settings.md')).toBe('Settings.md を作成しました');
  });
  it('covers every static translation key used by the interface', () => {
    const sources = import.meta.glob<string>('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
    for (const [file, text] of Object.entries(sources).filter(([name]) => !name.includes('.test.'))) {
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      function check(node: ts.Node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          expect(translations, `${file}: ${node.arguments[0].text}`).toHaveProperty(node.arguments[0].text);
        }
        ts.forEachChild(node, check);
      }
      check(source);
    }
  });
});
