import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { cn } from '../cn';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn('field', className)}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
}

export function Input({ label, hint, className, id, ...rest }: InputProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const el = <input id={inputId} className={cn('input', className)} {...rest} />;
  if (!label) return el;
  return (
    <Field label={label} hint={hint} htmlFor={inputId}>
      {el}
    </Field>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
}

export function Textarea({ label, hint, className, id, ...rest }: TextareaProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const el = <textarea id={inputId} className={cn('textarea', className)} {...rest} />;
  if (!label) return el;
  return (
    <Field label={label} hint={hint} htmlFor={inputId}>
      {el}
    </Field>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
}

export function Select({ label, hint, className, id, children, ...rest }: SelectProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const el = (
    <select id={inputId} className={cn('select', className)} {...rest}>
      {children}
    </select>
  );
  if (!label) return el;
  return (
    <Field label={label} hint={hint} htmlFor={inputId}>
      {el}
    </Field>
  );
}
