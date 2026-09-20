import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

/* ---------- ProgressBar ---------- */
export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  label?: string;
  className?: string;
}
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={cn('progress', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className="progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------- Chip ---------- */
export type ChipTone = 'accent' | 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
export interface ChipProps {
  tone?: ChipTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}
export function Chip({ tone = 'accent', dot = false, children, className, title }: ChipProps) {
  return (
    <span className={cn('chip', tone !== 'accent' && `chip-${tone}`, className)} title={title}>
      {dot && <span className="chip-dot" aria-hidden />}
      {children}
    </span>
  );
}

/* ---------- Segmented ---------- */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}
export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
  className?: string;
}
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <div className={cn('segmented', className)} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="segmented-item"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Slider ---------- */
export interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'value'
> {
  value: number;
  onChange: (v: number) => void;
}
export function Slider({ value, onChange, className, ...rest }: SliderProps) {
  return (
    <input
      type="range"
      className={cn('slider', className)}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      {...rest}
    />
  );
}

/* ---------- Spinner ---------- */
export function Spinner({ className }: { className?: string }) {
  return <span className={cn('spinner', className)} role="status" aria-label="Loading" />;
}

/* ---------- Empty state ---------- */
export interface EmptyStateProps {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}
export function EmptyState({ title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn('fade-in', className)} style={{ textAlign: 'center', padding: '40px 16px' }}>
      <h3 style={{ fontSize: 'var(--text-lg)' }}>{title}</h3>
      {body && (
        <p className="muted" style={{ marginTop: 8, maxWidth: 420, marginInline: 'auto' }}>
          {body}
        </p>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
