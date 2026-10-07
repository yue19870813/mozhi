import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from './i18n';
beforeEach(() => setLanguage('zh-CN'));
import { renderToStaticMarkup } from 'react-dom/server';
import { HomePage } from './HomePage';
const actions = { onOpen: () => {}, onAll: () => {}, onNew: () => {}, onBrowse: () => {}, onTogglePin: () => {} };
describe('pinned notes on the home page', () => {
  it('shows pinned notes before recent history even when absent from that history', () => {
    const html = renderToStaticMarkup(<HomePage {...actions} pinned={[{path:'置顶.md', title:'长期计划'}]} recent={[{path:'最近.md', title:'今日记录', openedAt:1}]} all={false} busy={false} canCreate />);
    expect(html.indexOf('长期计划')).toBeLessThan(html.indexOf('今日记录'));
    expect(html).toContain('aria-label="取消置顶 置顶.md"');
  });
  it('keeps pins visible with empty history and disables controls while busy', () => {
    const html = renderToStaticMarkup(<HomePage {...actions} pinned={[{path:'置顶.md', title:'长期计划'}]} recent={[]} all busy canCreate />);
    expect(html).toContain('长期计划');
    expect(html).not.toContain('从一篇笔记开始');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
