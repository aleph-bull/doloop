import { DEFAULT_BACKGROUND_ID } from '@komogon/core';
import { BackgroundThumb, Segmented, type ResolvedTheme } from '@komogon/ui';
import { BackgroundPicker } from './BackgroundPicker';

export interface ExtensionBackgroundPickerProps {
  value: string; // 'same' | 'upload' | preset id
  hasUpload: boolean;
  level: number;
  purchased: string[];
  theme: ResolvedTheme;
  onChange: (value: string) => void;
}

/** Choose whether the extension popup shares the portal background or has its own. */
export function ExtensionBackgroundPicker({
  value,
  hasUpload,
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
        onChange={(m) =>
          onChange(m === 'same' ? 'same' : hasUpload ? 'upload' : DEFAULT_BACKGROUND_ID)
        }
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
            leading={
              hasUpload ? (
                <BackgroundThumb
                  id="graphite"
                  theme={theme}
                  label="Uploaded"
                  ariaLabel="Uploaded image"
                  selected={value === 'upload'}
                  onClick={() => onChange('upload')}
                />
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
