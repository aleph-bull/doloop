import {
  BASS_HZ_LIMITS,
  DEFAULT_SETTINGS,
  VISUALIZER_PRESETS,
  visualizerShows,
  visualizerTurnedOn,
  type UserSettings,
  type VisualizerColorMode,
  type VisualizerPreset,
} from '@komogon/core';
import { Button, Reveal, Segmented, Slider, Toggle } from '@komogon/ui';
import type { ReactNode } from 'react';
import type { AudioCaptureHandle } from '../../lib/use-audio-capture';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface VisualizerSettingsProps {
  value: UserSettings['visualizer'];
  /** On a Minimalist theme, where it is off until turned on there. */
  minimalist: boolean;
  onChange: (patch: DeepPartial<UserSettings>) => void;
  /**
   * The live capture, when this is rendered on the focus screen itself. Settings has no
   * capture: the share belongs to the tab that draws.
   */
  audio?: AudioCaptureHandle;
  /** Settings shows the prompt preference; the focus screen keeps it to the modal. */
  showPromptPreference?: boolean;
}

interface RangeProps {
  label: string;
  /** The value as words, shown after the label. */
  readout: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

/** One labelled slider inside a group: the label and its reading on one line, the slider under. */
function Range({ label, readout, min, max, step, value, onChange }: RangeProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between field-hint">
        <span>{label}</span>
        <span className="tabular">{readout}</span>
      </span>
      <Slider min={min} max={max} step={step} value={value} onChange={onChange} />
    </label>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const PRESET_OPTIONS: Array<{ value: VisualizerPreset; label: string }> = [
  { value: 'bass', label: VISUALIZER_PRESETS.bass.label },
  { value: 'balanced', label: VISUALIZER_PRESETS.balanced.label },
  { value: 'mellow', label: VISUALIZER_PRESETS.mellow.label },
  { value: 'custom', label: 'Custom' },
];

/** The custom preset's memory slider, in the seconds it stands for. */
const memorySeconds = (v: number) => `${(0.5 + 3.5 * v).toFixed(1)} s`;

interface LayerProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
  /** The layer's own settings; they drop down while it is on and fold away when it is off. */
  children?: ReactNode;
}

/** One visualizer: its switch, and under it, only while on, whatever else it can be told. */
function Layer({ checked, onChange, label, description, children }: LayerProps) {
  return (
    <div className="vis-layer">
      <Toggle checked={checked} onChange={onChange} label={label} description={description} />
      {children && (
        <Reveal open={checked}>
          <div className="vis-layer-settings">{children}</div>
        </Reveal>
      )}
    </div>
  );
}

/**
 * The visualizer's controls, the same component in Settings and on the focus screen so the
 * two can never disagree about what a slider means. Both write `settings.visualizer`.
 */
export function VisualizerSettings({
  value,
  minimalist,
  onChange,
  audio,
  showPromptPreference = false,
}: VisualizerSettingsProps) {
  const set = (patch: Partial<UserSettings['visualizer']>) => onChange({ visualizer: patch });
  const on = visualizerShows(value, minimalist);
  return (
    <div className="flex flex-col gap-4">
      <Toggle
        checked={on}
        onChange={(enabled) => set(enabled ? visualizerTurnedOn(minimalist) : { enabled })}
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
      {on && audio && (
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
              : (audio.hint ?? 'Nothing shared yet.')}
          </span>
        </div>
      )}
      {on && (
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
            <span className="field-label">Motion</span>
            <div className="vis-layer-settings" style={{ paddingTop: 0 }}>
              <Range
                label="Speed"
                readout={`${value.speed.toFixed(2)}×`}
                min={0.25}
                max={2}
                step={0.05}
                value={value.speed}
                onChange={(speed) => set({ speed })}
              />
              <Toggle
                checked={value.fadeWhenSilent}
                onChange={(fadeWhenSilent) => set({ fadeWhenSilent })}
                label="Calm when silent"
                description="Fade the light to a glimmer while nothing is playing."
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
          <div className="field">
            <span className="field-label">Listening</span>
            <Segmented
              ariaLabel="How the visualizer listens"
              value={value.preset}
              onChange={(preset: VisualizerPreset) => set({ preset })}
              options={PRESET_OPTIONS}
            />
            {value.preset !== 'custom' && (
              <span className="field-hint">{VISUALIZER_PRESETS[value.preset].description}</span>
            )}
            <Reveal open={value.preset === 'custom'}>
              <div className="vis-layer-settings">
                <Range
                  label="Sensitivity"
                  readout={pct(value.customSensitivity)}
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.customSensitivity}
                  onChange={(customSensitivity) => set({ customSensitivity })}
                />
                <span className="field-hint">How easily a beat is picked up.</span>
                <Range
                  label="Drop threshold"
                  readout={pct(value.customDrop)}
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.customDrop}
                  onChange={(customDrop) => set({ customDrop })}
                />
                <span className="field-hint">
                  Higher means smaller drops still set off the beat drop circle.
                </span>
                <Range
                  label="Smoothness"
                  readout={pct(value.customSmoothing)}
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.customSmoothing}
                  onChange={(customSmoothing) => set({ customSmoothing })}
                />
                <span className="field-hint">How slowly the light settles after a beat.</span>
                <Range
                  label="Memory"
                  readout={memorySeconds(value.customMemory)}
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.customMemory}
                  onChange={(customMemory) => set({ customMemory })}
                />
                <span className="field-hint">
                  How much of the recent music a beat is compared with.
                </span>
                <Range
                  label="Low end from"
                  readout={`${Math.round(value.customBassLow)} Hz`}
                  min={BASS_HZ_LIMITS.min}
                  max={BASS_HZ_LIMITS.max - 10}
                  step={5}
                  value={value.customBassLow}
                  onChange={(customBassLow) =>
                    set({
                      customBassLow,
                      customBassHigh: Math.max(value.customBassHigh, customBassLow + 10),
                    })
                  }
                />
                <Range
                  label="Low end to"
                  readout={`${Math.round(value.customBassHigh)} Hz`}
                  min={BASS_HZ_LIMITS.min + 10}
                  max={BASS_HZ_LIMITS.max}
                  step={5}
                  value={value.customBassHigh}
                  onChange={(customBassHigh) =>
                    set({
                      customBassHigh,
                      customBassLow: Math.min(value.customBassLow, customBassHigh - 10),
                    })
                  }
                />
                <span className="field-hint">
                  Where the beat is listened for. Most drums sit between 40 and 120 Hz.
                </span>
              </div>
            </Reveal>
          </div>
          <div className="field">
            <span className="field-label">Visualizers</span>
            <div className="vis-layers">
              <Layer
                checked={value.mist}
                onChange={(mist) => set({ mist })}
                label="Cloud mist"
                description="A glowing cloud that drifts along the bottom and breathes with the music."
              >
                <Range
                  label="Height"
                  readout={`${pct(value.mistHeight)} of the screen`}
                  min={0.1}
                  max={0.6}
                  step={0.02}
                  value={value.mistHeight}
                  onChange={(mistHeight) => set({ mistHeight })}
                />
                <Range
                  label="Drift"
                  readout={pct(value.mistDrift)}
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.mistDrift}
                  onChange={(mistDrift) => set({ mistDrift })}
                />
                <Range
                  label="Opacity"
                  readout={pct(value.mistOpacity)}
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={value.mistOpacity}
                  onChange={(mistOpacity) => set({ mistOpacity })}
                />
              </Layer>
              <Layer
                checked={value.ribbons}
                onChange={(ribbons) => set({ ribbons })}
                label="Waves"
                description="Soft ribbons drifting across the top and bottom."
              >
                <Range
                  label="Waves"
                  readout={`${value.waveCount} below, ${Math.max(1, Math.round(value.waveCount / 2))} above`}
                  min={1}
                  max={12}
                  step={1}
                  value={value.waveCount}
                  onChange={(waveCount) => set({ waveCount })}
                />
                <Toggle
                  checked={value.waveTop}
                  onChange={(waveTop) => set({ waveTop })}
                  label="Across the top"
                />
                <Toggle
                  checked={value.waveBottom}
                  onChange={(waveBottom) => set({ waveBottom })}
                  label="Across the bottom"
                />
              </Layer>
              <Layer
                checked={value.shockwave}
                onChange={(shockwave) => set({ shockwave })}
                label="Beat drop circle"
                description="A ring rolls out from the clock when the music drops."
              />
              <Layer
                checked={value.rings}
                onChange={(rings) => set({ rings })}
                label="Circles"
                description="Fluid rings around the clock that move with the low end."
              >
                <Range
                  label="Circles"
                  readout={String(value.ringCount)}
                  min={1}
                  max={6}
                  step={1}
                  value={value.ringCount}
                  onChange={(ringCount) => set({ ringCount })}
                />
              </Layer>
              <Layer
                checked={value.burst}
                onChange={(burst) => set({ burst })}
                label="Burst"
                description="A ring of spectrum spikes around the clock, with glowing shapes behind it."
              >
                <Range
                  label="Ring size"
                  readout={`${pct(value.burstRadius)} of the screen`}
                  min={0.1}
                  max={0.5}
                  step={0.01}
                  value={value.burstRadius}
                  onChange={(burstRadius) => set({ burstRadius })}
                />
                <Range
                  label="Spike length"
                  readout={`${pct(value.burstReach)} of the screen`}
                  min={0.02}
                  max={0.6}
                  step={0.01}
                  value={value.burstReach}
                  onChange={(burstReach) => set({ burstReach })}
                />
                <Range
                  label="Spikes"
                  readout={String(value.burstSpikes)}
                  min={16}
                  max={192}
                  step={8}
                  value={value.burstSpikes}
                  onChange={(burstSpikes) => set({ burstSpikes })}
                />
                <Toggle
                  checked={value.burstShowSpikes}
                  onChange={(burstShowSpikes) => set({ burstShowSpikes })}
                  label="Spikes"
                  description="Off leaves just the glowing shapes."
                />
                <Reveal open={value.burstShowSpikes}>
                  <div className="vis-layer-settings" style={{ paddingTop: 0 }}>
                    <Range
                      label="Spike opacity"
                      readout={pct(value.burstSpikeOpacity)}
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={value.burstSpikeOpacity}
                      onChange={(burstSpikeOpacity) => set({ burstSpikeOpacity })}
                    />
                  </div>
                </Reveal>
                <Toggle
                  checked={value.burstBlob}
                  onChange={(burstBlob) => set({ burstBlob })}
                  label="Glowing shapes"
                  description="Soft colour behind the ring that swells with the music."
                />
                <Toggle
                  checked={value.burstRays}
                  onChange={(burstRays) => set({ burstRays })}
                  label="Fine rays"
                />
              </Layer>
              <Layer
                checked={value.bars}
                onChange={(bars) => set({ bars })}
                label="Sound bars"
                description="A glowing spectrum along the bottom of the screen."
              >
                <Range
                  label="Position"
                  readout={`${pct(value.barPosition)} from the top`}
                  min={0.1}
                  max={1}
                  step={0.01}
                  value={value.barPosition}
                  onChange={(barPosition) => set({ barPosition })}
                />
                <Range
                  label="Width"
                  readout={`${pct(value.barWidth)} of the screen`}
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={value.barWidth}
                  onChange={(barWidth) => set({ barWidth })}
                />
                <Range
                  label="Bars"
                  readout={String(value.barCount)}
                  min={8}
                  max={96}
                  step={4}
                  value={value.barCount}
                  onChange={(barCount) => set({ barCount })}
                />
                <Range
                  label="Tallest bar"
                  readout={`${pct(value.barHeight)} of the screen`}
                  min={0.1}
                  max={0.7}
                  step={0.02}
                  value={value.barHeight}
                  onChange={(barHeight) => set({ barHeight })}
                />
                <Range
                  label="Spacing"
                  readout={pct(value.barGap)}
                  min={0}
                  max={0.8}
                  step={0.05}
                  value={value.barGap}
                  onChange={(barGap) => set({ barGap })}
                />
                <Range
                  label="Glow"
                  readout={pct(value.barGlow)}
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.barGlow}
                  onChange={(barGlow) => set({ barGlow })}
                />
                <Range
                  label="Opacity"
                  readout={pct(value.barOpacity)}
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={value.barOpacity}
                  onChange={(barOpacity) => set({ barOpacity })}
                />
                <Toggle
                  checked={value.barReflection}
                  onChange={(barReflection) => set({ barReflection })}
                  label="Reflection"
                />
                <Toggle
                  checked={value.barSymmetric}
                  onChange={(barSymmetric) => set({ barSymmetric })}
                  label="Bass in the middle"
                  description="Low notes in the centre, high notes out toward the edges."
                />
              </Layer>
              <Layer
                checked={value.waveform}
                onChange={(waveform) => set({ waveform })}
                label="Mirrored line"
                description="The waveform drawn across the screen with its reflection under it."
              >
                <Range
                  label="Height on screen"
                  readout={`${pct(value.waveformPosition)} from the top`}
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  value={value.waveformPosition}
                  onChange={(waveformPosition) => set({ waveformPosition })}
                />
                <Toggle
                  checked={value.waveformMirror}
                  onChange={(waveformMirror) => set({ waveformMirror })}
                  label="Reflection"
                />
              </Layer>
            </div>
          </div>
          <div className="field">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange({
                  visualizer: {
                    ...DEFAULT_SETTINGS.visualizer,
                    enabled: value.enabled,
                    onMinimalist: value.onMinimalist,
                    promptDismissed: value.promptDismissed,
                  },
                })
              }
            >
              Reset the visualizer to its defaults
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
