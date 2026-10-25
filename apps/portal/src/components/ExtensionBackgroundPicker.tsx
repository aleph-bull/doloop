import { DEFAULT_BACKGROUND_ID } from '@komogon/core';
import { Segmented, type ResolvedTheme } from '@komogon/ui';
import { BackgroundPicker } from './BackgroundPicker';

export interface ExtensionBackgroundPickerProps {
  value: string; // 'same' | preset id ('upload' only from before uploads lived in the browser)
  level: number;
  purchased: string[];
  theme: ResolvedTheme;
  onChange: (value: string) => void;
}

/**
 * Choose whether the extension popup shares the portal background or has its own. It can't
 * show an uploaded background: those stay in the portal's browser storage.
 */
export function ExtensionBackgroundPicker({
  value,
  level,
  purchased,
  theme,
  onChange,
}: ExtensionBackgroundPickerProps) {
  const mode = value === 'same' ? 'same' : 'own';
  return (
    <div className="field">
      <span className="field-label">Extension background</span>
      <Segmented
        ariaLabel="Extension background"
        value={mode}
        onChange={(m) => onChange(m === 'same' ? 'same' : DEFAULT_BACKGROUND_ID)}
        options={[
          { value: 'same', label: 'Same as portal' },
          { value: 'own', label: 'Different' },
        ]}
      />
      <span className="field-hint">
        The Chrome extension popup can share this page's background or use its own.
      </span>
      {mode === 'own' && (
        <div className="mt-2">
          <BackgroundPicker
            value={value}
            level={level}
            purchased={purchased}
            theme={theme}
            onChange={onChange}
            collapseKey="extension"
          />
        </div>
      )}
    </div>
  );
}
