import { finishBackdropTuning, Slider, tuneBackdrop } from '@komogon/ui';
import { useEffect, useState } from 'react';

type BackgroundPatch = { theme: { backgroundBlur?: number; backgroundBrightness?: number } };

export interface BackgroundAdjustProps {
  blur: number;
  brightness: number;
  onChange: (patch: BackgroundPatch) => Promise<unknown>;
}

interface Draft {
  blur?: number;
  brightness?: number;
}

/**
 * The background photo's blur and brightness (Appearance, under the background). Dragging
 * shows it straight away and letting go saves it; the photo is blurred for good only once
 * Appearance is left, and kept, so visits and reloads don't blur it again (the Backdrop).
 */
export function BackgroundAdjust({ blur, brightness, onChange }: BackgroundAdjustProps) {
  // What is being dragged, until the saved settings come back with it.
  const [draft, setDraft] = useState<Draft>({});
  const saved = `${blur}|${brightness}`;
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setDraft({});
  }
  const b = draft.blur ?? blur;
  const l = draft.brightness ?? brightness;

  // Leaving Appearance (another section, another page) is when the photo is blurred.
  useEffect(() => finishBackdropTuning, []);

  const saveOn = (save: () => void) => ({ onPointerUp: save, onKeyUp: save });

  return (
    <div className="glass-controls">
      <span>Blur</span>
      <Slider
        min={0}
        max={40}
        step={1}
        value={b}
        aria-label="Background blur"
        onChange={(v) => {
          setDraft((d) => ({ ...d, blur: v }));
          tuneBackdrop({ blur: v });
        }}
        {...saveOn(() => void onChange({ theme: { backgroundBlur: b } }))}
      />
      <span className="tabular">{b}px</span>

      <span>Brightness</span>
      <Slider
        min={-60}
        max={60}
        step={5}
        value={l}
        aria-label="Background brightness"
        onChange={(v) => {
          setDraft((d) => ({ ...d, brightness: v }));
          tuneBackdrop({ brightness: v });
        }}
        {...saveOn(() => void onChange({ theme: { backgroundBrightness: l } }))}
      />
      <span className="tabular">{l > 0 ? `+${l}%` : l < 0 ? `−${-l}%` : '0%'}</span>
    </div>
  );
}
