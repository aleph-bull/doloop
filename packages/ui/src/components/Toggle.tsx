import type { ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../cn';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Accessible switch. Renders as a labelled row when `label` is given. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: ToggleProps) {
  const id = useId();
  const button = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
  if (!label) return button;
  return (
    <div
      className={cn('toggle-row', className)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
    >
      <label htmlFor={id} style={{ cursor: disabled ? 'default' : 'pointer' }}>
        <div style={{ fontWeight: 500 }}>{label}</div>
        {description && <div className="field-hint">{description}</div>}
      </label>
      {button}
    </div>
  );
}
