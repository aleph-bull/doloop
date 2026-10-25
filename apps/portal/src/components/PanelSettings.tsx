import type { PanelStyle } from '@komogon/core';
import { useState } from 'react';
import { Panel, Segmented, Slider } from '@komogon/ui';

type DeepPatch = { theme: { panel?: PanelStyle; panelColor?: string; panelAlpha?: number } };

export interface PanelSettingsProps {
  panel: PanelStyle;
  panelColor: string;
  panelAlpha: number;
  onChange: (patch: DeepPatch) => Promise<unknown>;
}

/** Surface for cards and panels: opaque (default), glass, any colour with opacity, or matte. */
export function PanelSettings({ panel, panelColor, panelAlpha, onChange }: PanelSettingsProps) {
  const [alpha, setAlpha] = useState(panelAlpha);
  return (
    <div className="flex flex-col gap-3">
      <div className="field">
        <span className="field-label">Panels</span>
        <Segmented
          ariaLabel="Panel surface"
          value={panel}
          onChange={(v) => onChange({ theme: { panel: v } })}
          options={[
            { value: 'opaque', label: 'Opaque' },
            { value: 'glass', label: 'Glass' },
            { value: 'custom', label: 'Custom colour' },
            { value: 'matte', label: 'Matte' },
          ]}
        />
        <span className="field-hint">
          Every card and panel uses this. Glass shows the background through them; Matte turns off
          glass everywhere, the top bar or sidebar and dialogs included. Text colour adapts
          automatically so it stays readable.
        </span>
      </div>
      {panel === 'custom' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="color"
                aria-label="Panel colour"
                value={panelColor}
                onChange={(e) => onChange({ theme: { panelColor: e.target.value } })}
              />
              Colour
            </label>
            <div className="field flex-1" style={{ minWidth: 200 }}>
              <span className="field-label">Opacity {Math.round(alpha * 100)}%</span>
              <Slider
                min={0.2}
                max={1}
                step={0.05}
                value={alpha}
                onChange={setAlpha}
                onMouseUp={() => onChange({ theme: { panelAlpha: alpha } })}
                onTouchEnd={() => onChange({ theme: { panelAlpha: alpha } })}
                onKeyUp={() => onChange({ theme: { panelAlpha: alpha } })}
                aria-label="Panel opacity"
              />
            </div>
          </div>
        </div>
      )}
      <Panel className="p-4 text-sm">
        <div className="font-medium">Preview</div>
      </Panel>
    </div>
  );
}
