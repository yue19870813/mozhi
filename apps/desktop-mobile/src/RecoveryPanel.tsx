import { t, useLanguage, dateTime } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { errorText, native, workspace } from './api';

export type RecoveryPolicy = { retentionDays: number; maxBytes: number; maxCount: number };
type Record = { id: string; source: string; destination: string | null; kind: string; completed: boolean; createdAt: number; bytes: number; protected: boolean };
type Overview = { policy: RecoveryPolicy; records: Record[]; count: number; bytes: number; protectedCount: number; overLimit: boolean; warnings: string[] };
type Plan = { candidates: { id: string; fingerprint: string; bytes: number }[]; bytes: number };
const defaults: RecoveryPolicy = { retentionDays: 30, maxBytes: 1024 ** 3, maxCount: 1000 };
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KiB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024 ** 3).toFixed(2)} GiB`;

export function RecoveryPanel({ busy, run, onRestore }: { busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined>; onRestore: (id: string) => Promise<void> }) {
  useLanguage();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [policy, setPolicy] = useState(defaults);
  const [preview, setPreview] = useState<Plan | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!native) { setLoading(false); return; }
    workspace<Overview>({ action: 'recovery_overview' }).then(value => {
      if (mounted.current) { setOverview(value); setPolicy(value.policy); }
    }).catch(error => { if (mounted.current) setMessage(errorText(error)); }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, []);
  const disabled = busy || loading || !native;
  return <section className="lab-panel recovery-panel">
    <h1>{t("恢复记录")}</h1>
    <p className="subtle">{t("删除、移动及链接改写前的副本保存在本机。恢复到新目录，不覆盖现有内容。")}</p>
    <div className="recovery-summary">
      <strong>{loading ? t("正在读取…") : overview ? t("已用 {0} · {1} 条记录", size(overview.bytes), overview.count) : native ? t("未能读取恢复记录") : t("请在桌面应用中管理恢复记录")}</strong>
      {overview && <span className="subtle">{overview.protectedCount} {t("条受保护 · 当前容量上限")} {size(overview.policy.maxBytes)}</span>}
    </div>
    <form onSubmit={event => { event.preventDefault(); void run(async () => {
      const value = await workspace<Overview>({ action: 'recovery_configure', policy });
      if (mounted.current) { setOverview(value); setPolicy(value.policy); setPreview(null); setMessage(t("保留设置已保存，已按新规则检查清理。")); }
    }); }}>
      <div className="recovery-settings">
        <label>{t("保留时间（天）")}<input type="number" required min="1" max="3650" step="1" disabled={disabled} value={policy.retentionDays || ''} onChange={event => setPolicy({ ...policy, retentionDays: Number(event.target.value) })}/></label>
        <label>{t("容量上限（MiB）")}<input type="number" required min="1" max="1048576" step="1" disabled={disabled} value={policy.maxBytes / 1024 ** 2 || ''} onChange={event => setPolicy({ ...policy, maxBytes: Number(event.target.value) * 1024 ** 2 })}/></label>
        <label>{t("条数上限")}<input type="number" required min="1" max="100000" step="1" disabled={disabled} value={policy.maxCount || ''} onChange={event => setPolicy({ ...policy, maxCount: Number(event.target.value) })}/></label>
      </div>
      <p className="subtle">{t("设置仅用于当前笔记库的操作恢复副本，不影响草稿和 Git 历史。保存后即按新规则清理；自动删除的副本无法恢复。")}</p>
      <p className="subtle">{t("先清理过期记录，再按从旧到新的顺序清理超额记录。最近 24 小时、未完成及异常记录受保护，可能暂时超限。旧记录从首次纳入管理时开始计时。")}</p>
      <div className="workspace-toolbar"><button type="submit" disabled={disabled}>{t("保存保留设置")}</button><button type="button" disabled={disabled} onClick={() => void run(async () => {
        const plan = await workspace<Plan>({ action: 'recovery_preview' });
        if (mounted.current) { setPreview(plan.candidates.length ? plan : null); setMessage(plan.candidates.length ? '' : t("暂无可清理的过期记录。")); }
      })}>{t("清理过期记录")}</button></div>
    </form>
    {overview?.overLimit && <p className="recovery-warning" role="status">{t("恢复记录已超过容量或条数上限。受保护或清理失败的记录仍保留，请检查下方记录及提示。")}</p>}
    {overview?.warnings.map((warning, i) => <p className="recovery-warning" key={i}>{t(warning)}</p>)}
    {message && <p role="status">{t(message)}</p>}
    {preview && <div className="recovery-confirm" role="group" aria-label={t("确认清理过期记录")}>
      <p>{t("将永久删除")} {preview.candidates.length} {t("条过期记录，预计释放")} {size(preview.bytes)}{t("。删除后无法恢复这些副本，当前笔记内容不受影响。")}</p>
      <button disabled={disabled} onClick={() => void run(async () => {
        const result = await workspace<{ cleanup: { deleted: number; bytes: number }; overview: Overview }>({ action: 'recovery_clean', candidates: preview.candidates });
        if (mounted.current) { setOverview(result.overview); setPreview(null); setMessage(t("已清理 {0} 条记录，释放 {1}。", result.cleanup.deleted, size(result.cleanup.bytes))); }
      })}>{t("确认永久清理")}</button><button disabled={disabled} onClick={() => setPreview(null)}>{t("取消")}</button>
    </div>}
    {overview?.records.map(record => <article className="recovery-card" key={record.id}>
      <h3>{record.source}{record.destination && ` → ${record.destination}`}</h3>
      <p>{{ move: t("移动 / 重命名"), delete: t("删除笔记"), 'delete-directory': t("删除目录") }[record.kind] ?? record.kind} · {dateTime(record.createdAt * 1000)} · {size(record.bytes)}</p>
      <p>{record.completed ? record.protected ? t("操作已完成 · 24 小时保护期内") : t("操作已完成") : t("操作未完成 · 不自动清理，请检查并恢复副本")}</p>
      <button disabled={disabled} onClick={() => void run(() => onRestore(record.id))}>{t("恢复副本到新目录")}</button>
    </article>)}
    {overview?.count === 0 && <p>{t("暂无恢复记录。")}</p>}
  </section>;
}
