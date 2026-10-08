import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from './i18n';
beforeEach(() => setLanguage('zh-CN'));
import { renderToStaticMarkup } from 'react-dom/server';
import { HomePage } from './HomePage';
const actions = { onOpen: () => {}, onAll: () => {}, onNew: () => {}, onBrowse: () => {}, onTogglePin: () => {} };
describe('pinned notes on the home page', () => {
  it('keeps the demo welcome guide below first-note guidance and ahead of pins', () => {
    const html = renderToStaticMarkup(<HomePage {...actions} welcome pinned={[{path:'置顶.md',title:'长期计划'}]} recent={[]} all={false} busy={false} canCreate />);
    expect(html.indexOf('从一篇笔记开始')).toBeLessThan(html.indexOf('欢迎使用墨知'));
    expect(html.indexOf('欢迎使用墨知')).toBeLessThan(html.indexOf('长期计划'));
    expect(html).toContain('欢迎使用.md');
    expect(html).toContain('aria-label="打开欢迎使用指南"');
  });
  it('keeps the guide fixed after visits without duplicating the pinned welcome note', () => {
    const html = renderToStaticMarkup(<HomePage {...actions} welcome pinned={[{path:'欢迎使用.md',title:'欢迎使用墨知'}]} recent={[{path:'最近.md',title:'今日记录',openedAt:1}]} all={false} busy canCreate />);
    expect(html.match(/欢迎使用墨知/g)).toHaveLength(1);
    expect(html.indexOf('欢迎使用墨知')).toBeLessThan(html.indexOf('今日记录'));
    expect(html).not.toContain('取消置顶');
    expect(html).toContain('disabled=""');
  });
  it('hides the fixed guide in personal vaults and the recent-only view', () => {
    for (const props of [{welcome:false,all:false},{welcome:true,all:true}]) {
      const html = renderToStaticMarkup(<HomePage {...actions} {...props} pinned={[]} recent={[]} busy={false} canCreate />);
      expect(html).not.toContain('home-welcome-card');
      expect(html).toContain('从一篇笔记开始');
    }
  });
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
