export type GraphFilterState = { scope: 'global' | 'local'; depth: number; tag: string; directory: string; keyword: string; isolated: boolean };
export const initialGraphFilters: GraphFilterState = { scope: 'global', depth: 1, tag: '', directory: '', keyword: '', isolated: true };
export function GraphFilters({ value, onChange, current, tags }: { value: GraphFilterState; onChange: (value: GraphFilterState) => void; current: string; tags: string[] }) {
  return <div className="graph-filters">
    <label>图谱范围<select value={value.scope} onChange={e=>onChange({...value,scope:e.target.value as GraphFilterState['scope']})}><option value="global">全局图谱</option><option value="local" disabled={!current}>当前笔记局部图谱</option></select></label>
    {value.scope==='local'&&<><p className="subtle">中心笔记：{current}</p><label>关系深度<select value={value.depth} onChange={e=>onChange({...value,depth:Number(e.target.value)})}><option value={1}>一跳</option><option value={2}>两跳</option></select></label></>}
    <label>关键词<input placeholder="标题或路径" value={value.keyword} onChange={e=>onChange({...value,keyword:e.target.value})}/></label>
    <label>目录<input placeholder="所有目录" value={value.directory} onChange={e=>onChange({...value,directory:e.target.value})}/></label>
    <label>标签<select value={value.tag} onChange={e=>onChange({...value,tag:e.target.value})}><option value="">所有标签</option>{tags.map(tag=><option key={tag}>{tag}</option>)}</select></label>
    <label className="checkbox-label"><input type="checkbox" checked={value.isolated} onChange={e=>onChange({...value,isolated:e.target.checked})}/>显示孤立笔记</label>
  </div>;
}
