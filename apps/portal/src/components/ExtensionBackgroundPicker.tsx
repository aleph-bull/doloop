import { BACKGROUNDS, isBackgroundAvailable } from '@doloop/core';
import { BACKGROUND_DEFS, Segmented, type ResolvedTheme } from '@doloop/ui';

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
        onChange={(m) => onChange(m === 'same' ? 'same' : hasUpload ? 'upload' : 'aurora')}
        options={[
          { value: 'same', label: 'Same as portal' },
          { value: 'own', label: 'Different' },
        ]}
      />
      <span className="field-hint">
        The Chrome extension popup can share this page's background or use its own.
      </span>
      {mode === 'own' && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2">
          {hasUpload && (
            <button
              type="button"
              className="bg-thumb"
              aria-pressed={value === 'upload'}
              aria-label="Uploaded image"
              style={{ background: 'var(--accent-soft)' }}
              onClick={() => onChange('upload')}
            >
              <span className="bg-thumb-label">Uploaded</span>
            </button>
          )}
          {BACKGROUNDS.map((b) => {
            const def = BACKGROUND_DEFS.find((d) => d.id === b.id);
            const available = isBackgroundAvailable(b.id, level, purchased);
            return (
              <button
                key={b.id}
                type="button"
                className="bg-thumb"
                aria-pressed={value === b.id}
                aria-label={available ? b.name : `${b.name}, locked`}
                disabled={!available}
                style={{
                  background: def ? (theme === 'dark' ? def.dark.css : def.light.css) : undefined,
                  opacity: available ? 1 : 0.5,
                }}
                onClick={() => onChange(b.id)}
              >
                <span className="bg-thumb-label">{b.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
