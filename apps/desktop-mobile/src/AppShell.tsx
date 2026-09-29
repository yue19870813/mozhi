import { useEffect, useState, type ReactNode } from 'react';
import { moduleLabels, readPreference, savePreference, type Module } from './navigation';
export function Icon({ name }: { name: Module | 'panel' }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
    notes: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18m4-12h5m-5 4h5"/></>,
    graph: <><circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10.5 7.5-4 8m7-8 4 8M8 18h8"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17h.01"/></>,
    settings: <><path d="M9.67 4.14a2 2 0 0 1 1.76-1.04h1.14a2 2 0 0 1 1.76 1.04l.63 1.16a1 1 0 0 0 .88.5l1.33-.03a2 2 0 0 1 1.78 1l.57.99a2 2 0 0 1 .02 2.04l-.69 1.13a1 1 0 0 0 0 1.02l.69 1.13a2 2 0 0 1-.02 2.04l-.57.99a2 2 0 0 1-1.78 1l-1.33-.03a1 1 0 0 0-.88.5l-.63 1.16a2 2 0 0 1-1.76 1.04h-1.14a2 2 0 0 1-1.76-1.04l-.63-1.16a1 1 0 0 0-.88-.5l-1.33.03a2 2 0 0 1-1.78-1l-.57-.99a2 2 0 0 1-.02-2.04l.69-1.13a1 1 0 0 0 0-1.02l-.69-1.13a2 2 0 0 1 .02-2.04l.57-.99a2 2 0 0 1 1.78-1l1.33.03a1 1 0 0 0 .88-.5Z" transform="translate(0 .56)"/><circle cx="12" cy="12" r="3.2"/></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
  };
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function useSidebar() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900);
  const [collapsed, setCollapsed] = useState(() => readPreference('mozhi-sidebar-collapsed', 'false') === 'true');
  const [temporary, setTemporary] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 899px)');
    const change = () => { setNarrow(media.matches); setTemporary(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return {
    visible: narrow ? temporary : !collapsed,
    toggle: () => { if (narrow) setTemporary(v => !v); else setCollapsed(v => { savePreference('mozhi-sidebar-collapsed', String(!v)); return !v; }); },
    reveal: () => { if (narrow) setTemporary(true); else { setCollapsed(false); savePreference('mozhi-sidebar-collapsed', 'false'); } },
    dismiss: () => setTemporary(false),
  };
}
export function AppShell({ active, disabled, onNavigate, sidebar, sidebarVisible, dismissSidebar, children }: {
  active: Module; disabled: boolean; onNavigate: (module: Module) => void;
  sidebar: ReactNode; sidebarVisible: boolean; dismissSidebar: () => void; children: ReactNode;
}) {
  const [width, setWidth] = useState(() => Math.max(220, Math.min(360, Number(readPreference('mozhi-sidebar-width', '256')) || 256)));
  function resize(next: number) { const value = Math.max(220, Math.min(360, next)); setWidth(value); savePreference('mozhi-sidebar-width', String(value)); }
  return <div className="app-shell">
    <nav className="module-rail" aria-label="主导航">
      {(['home', 'notes', 'graph', 'help', 'settings'] as const).map(module => <button key={module} className={`rail-button ${module === active ? 'active' : ''} ${module === 'help' ? 'rail-bottom' : ''}`} aria-label={moduleLabels[module]} aria-current={module === active ? 'page' : undefined} disabled={disabled} onClick={() => onNavigate(module)}><Icon name={module}/><span className="rail-tooltip">{moduleLabels[module]}</span></button>)}
    </nav>
    {sidebarVisible && <button className="sidebar-scrim" aria-label="收起模块侧栏" onClick={dismissSidebar}/>}
    <aside id="module-sidebar" aria-label={`${moduleLabels[active]}侧栏`} className="sidebar" hidden={!sidebarVisible} style={{ width }}>
      {sidebar}
      <div className="sidebar-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={360} aria-valuenow={width} tabIndex={0}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(width + (event.key === 'ArrowRight' ? 10 : -10)); } }}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX - 56); }}
        onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}/>
    </aside>
    <main>{children}</main>
  </div>;
}
