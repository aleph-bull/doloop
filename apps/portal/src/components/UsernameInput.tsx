import type { InputHTMLAttributes } from 'react';
import { USERNAME } from '@komogon/core';

export interface UsernameInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
> {
  value: string;
  /** What was typed, without a leading @ and in lower case. */
  onChange: (value: string) => void;
  /** Enter was pressed. */
  onEnter?: () => void;
}

/**
 * A username box with its @ drawn in front, so the @ is never typed or stored. Used in
 * Settings, the notice about a picked username and the first-time setup.
 */
export function UsernameInput({
  value,
  onChange,
  onEnter,
  className,
  ...rest
}: UsernameInputProps) {
  return (
    <span className={`username-input${className ? ` ${className}` : ''}`}>
      <span className="username-at" aria-hidden>
        @
      </span>
      <input
        className="input"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={USERNAME.MAX + 1}
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/^@+/, '').toLowerCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </span>
  );
}
