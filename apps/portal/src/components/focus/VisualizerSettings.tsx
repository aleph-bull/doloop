import type { UserSettings, VisualizerColorMode } from '@doloop/core';
import { Button, Segmented, Slider, Toggle } from '@doloop/ui';
import type { AudioCaptureHandle } from '../../lib/use-audio-capture';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface VisualizerSettingsProps {
  value: UserSettings['visualizer'];
  onChange: (patch: DeepPartial<UserSettings>) => void;
  /**
   * The live capture, when this is rendered on the focus screen itself. Settings has no
   * capture: the share belongs to the tab that draws.
   */
  audio?: AudioCaptureHandle;
  /** Settings shows the prompt preference; the focus screen keeps it to the modal. */
  showPromptPreference?: boolean;
}

/**
 * The visualizer's controls, the same component in Settings and on the focus screen so the
 * two can never disagree about what a slider means. Both write `settings.visualizer`.
 */
export function VisualizerSettings({
  value,
  onChange,
  audio,
  showPromptPreference = false,
}: VisualizerSettingsProps) {
  const set = (patch: Partial<UserSettings['visualizer']>) => onChange({ visualizer: patch });
  return (
    <div className="flex flex-col gap-4">
      <Toggle
        checked={value.enabled}
        onChange={(enabled) => set({ enabled })}
        label="Enable audio visualizer"
        description="Soft light behind the focus timer that moves with your music."
      />
      {showPromptPreference && (
        <Toggle
          checked={value.promptDismissed}
          onChange={(promptDismissed) => set({ promptDismissed })}
          label="Never ask again"
          description="Stop the focus screen offering to share audio on its own. You can still share from its controls."
        />
      )}
      {value.enabled && audio && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            variant={audio.state === 'listening' ? 'secondary' : 'primary'}
            disabled={!audio.supported || audio.state === 'requesting'}
            onClick={() => void audio.request()}
          >
            {audio.state === 'listening' ? 'Change audio source' : 'Share audio'}
          </Button>
          {audio.state === 'listening' && (
            <Button size="sm" variant="ghost" onClick={audio.stop}>
              Stop listening
            </Button>
          )}
          <span className="field-hint">
            {audio.state === 'listening'
              ? 'Listening. Stop from here or from the browser’s sharing bar.'
              : (audio.hint ?? 'Nothing shared yet; the visualizer is idling.')}
          </span>
        </div>
      )}
      {value.enabled && (
        <>
          <div className="field">
            <span className="field-label">Intensity</span>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={value.intensity}
              onChange={(intensity) => set({ intensity })}
              aria-label="Visualizer intensity"
            />
            <div className="flex justify-between field-hint">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>
          <div className="field">
            <span className="field-label">Opacity</span>
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={value.opacity}
              onChange={(opacity) => set({ opacity })}
              aria-label="Visualizer opacity"
            />
            <div className="flex justify-between field-hint">
              <span>Faint</span>
              <span>Solid</span>
            </div>
          </div>
          <div className="field">
            <span className="field-label">Layers</span>
            <div className="flex flex-col gap-2">
              <Toggle
                checked={value.ribbons}
                onChange={(ribbons) => set({ ribbons })}
                label="Waves"
              />
              <Toggle checked={value.rings} onChange={(rings) => set({ rings })} label="Circles" />
              <Toggle
                checked={value.border}
                onChange={(border) => set({ border })}
                label="Glowing border"
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">Colour</span>
            <div className="flex items-center gap-3 flex-wrap">
              <Segmented
                ariaLabel="Visualizer colour"
                value={value.colorMode}
                onChange={(colorMode: VisualizerColorMode) => set({ colorMode })}
                options={[
                  { value: 'accent', label: 'Accent' },
                  { value: 'custom', label: 'Custom' },
                  { value: 'gradient', label: 'Gradient' },
                ]}
              />
              {value.colorMode === 'custom' && (
                <input
                  type="color"
                  aria-label="Custom visualizer colour"
                  className="focus-swatch-input"
                  value={value.color}
                  onChange={(e) => set({ color: e.target.value })}
                />
              )}
            </div>
            <span className="field-hint">
              {value.colorMode === 'accent'
                ? 'Follows your accent colour.'
                : value.colorMode === 'custom'
                  ? 'One colour of your choosing.'
                  : 'Sweeps from your accent into a neighbouring hue.'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
