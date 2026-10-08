import { t, useLanguage } from './i18n';
import { relativeTime, type RecentNote } from './recent';
import { ArrowUpRight, BookOpen, Pin } from 'lucide-react';
export function HomePage({ welcome = false, pinned, onTogglePin, recent, all, busy, canCreate, onOpen, onAll, onNew, onBrowse }: {
  welcome?: boolean;
  pinned: { path: string; title: string }[]; onTogglePin: (path: string) => void;
  recent: RecentNote[]; all: boolean; busy: boolean; canCreate: boolean;
  onOpen: (path: string) => void; onAll: () => void; onNew: () => void; onBrowse: () => void;
}) {
  useLanguage();
  const showWelcome = welcome && !all;
  const visiblePinned = showWelcome ? pinned.filter(note => note.path !== '欢迎使用.md') : pinned;
  return <section className="home-page">
    <header><h1>{all ? t("最近打开") : t("首页")}</h1><p className="subtle">{all ? t("按最近访问时间排列") : t("继续上一次的思考")}</p></header>
    {showWelcome && <>
      {!recent.length && <div className="home-empty home-welcome-empty"><span aria-hidden="true">✎</span><h2>{t("从一篇笔记开始")}</h2><p className="subtle">{t("打开过的笔记会出现在这里，随时接着阅读或书写。")}</p><div className="workspace-toolbar"><button disabled={busy || !canCreate} onClick={onNew}>{t("＋ 新建笔记")}</button><button disabled={busy} onClick={onBrowse}>{t("浏览笔记")}</button></div></div>}
      <button className="home-welcome-card" disabled={busy} onClick={() => onOpen('欢迎使用.md')} aria-label={t("打开欢迎使用指南")}>
        <span className="home-welcome-icon"><BookOpen size={24} strokeWidth={1.5} aria-hidden="true"/></span>
        <span className="home-welcome-copy"><span className="home-welcome-label"><Pin size={12} aria-hidden="true"/>{t("入门指南")}</span><strong>{t("欢迎使用墨知")}</strong><span className="home-welcome-description">{t("从书写、链接到同步与 AI，了解墨知的使用方法。")}</span><small>欢迎使用.md</small></span>
        <ArrowUpRight className="home-welcome-arrow" size={20} strokeWidth={1.5} aria-hidden="true"/>
      </button>
    </>}
    {!!visiblePinned.length && <section aria-label={t("置顶笔记")}><div className="recent-heading"><h2>{t("置顶笔记")}</h2></div><div className="recent-list">{visiblePinned.map(note => <div className="pinned-home-row" key={note.path}><button className="recent-row" disabled={busy} onClick={() => onOpen(note.path)}><span className="recent-file" aria-hidden="true">↑</span><span className="recent-copy"><strong>{note.title}</strong><small>{note.path}</small></span></button><button className="pin-action" disabled={busy} aria-label={t("取消置顶 {0}", note.path)} onClick={() => onTogglePin(note.path)}>{t("取消置顶")}</button></div>)}</div></section>}
    {recent.length ? <><div className="recent-heading"><h2>{t("最近打开")}</h2>{!all && <button className="text-button" disabled={busy} onClick={onAll}>{t("查看全部 →")}</button>}</div>
      <div className="recent-list">{recent.slice(0, all ? 50 : 10).map(note => <button className="recent-row" key={note.path} disabled={busy} onClick={() => onOpen(note.path)}><span className="recent-file" aria-hidden="true">▤</span><span className="recent-copy"><strong>{note.title}</strong><small>{note.path}</small></span><time dateTime={new Date(note.openedAt).toISOString()}>{relativeTime(note.openedAt)}</time></button>)}</div></> : !visiblePinned.length && !showWelcome ?
      <div className="home-empty"><span aria-hidden="true">✎</span><h2>{t("从一篇笔记开始")}</h2><p className="subtle">{t("打开过的笔记会出现在这里，随时接着阅读或书写。")}</p><div className="workspace-toolbar"><button disabled={busy || !canCreate} onClick={onNew}>{t("＋ 新建笔记")}</button><button disabled={busy} onClick={onBrowse}>{t("浏览笔记")}</button></div></div> : null}
  </section>;
}
