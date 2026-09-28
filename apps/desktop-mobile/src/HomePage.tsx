import { relativeTime, type RecentNote } from './recent';
export function HomePage({ recent, all, busy, canCreate, onOpen, onAll, onNew, onBrowse }: {
  recent: RecentNote[]; all: boolean; busy: boolean; canCreate: boolean;
  onOpen: (path: string) => void; onAll: () => void; onNew: () => void; onBrowse: () => void;
}) {
  return <section className="home-page">
    <header><h1>{all ? '最近打开' : '首页'}</h1><p className="subtle">{all ? '按最近访问时间排列' : '继续上一次的思考'}</p></header>
    {recent.length ? <><div className="recent-heading"><h2>最近打开</h2>{!all && <button className="text-button" disabled={busy} onClick={onAll}>查看全部 →</button>}</div>
      <div className="recent-list">{recent.slice(0, all ? 50 : 10).map(note => <button className="recent-row" key={note.path} disabled={busy} onClick={() => onOpen(note.path)}><span className="recent-file" aria-hidden="true">▤</span><span className="recent-copy"><strong>{note.title}</strong><small>{note.path}</small></span><time dateTime={new Date(note.openedAt).toISOString()}>{relativeTime(note.openedAt)}</time></button>)}</div></> :
      <div className="home-empty"><span aria-hidden="true">✎</span><h2>从一篇笔记开始</h2><p className="subtle">打开过的笔记会出现在这里，随时接着阅读或书写。</p><div className="workspace-toolbar"><button disabled={busy || !canCreate} onClick={onNew}>＋ 新建笔记</button><button disabled={busy} onClick={onBrowse}>浏览笔记</button></div></div>}
  </section>;
}
