import type { ChangeEventHandler } from 'react';

/** Shared setting toggle; native checkbox behavior retains keyboard and label support. */
export function SettingsSwitch({ checked, disabled, label, onChange }: {
  checked: boolean; disabled?: boolean; label: string; onChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return <span className="settings-switch"><input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={onChange}/><span aria-hidden="true"/></span>;
}
