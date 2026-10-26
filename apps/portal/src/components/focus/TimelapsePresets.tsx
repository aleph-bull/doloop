import type { TimelapseDevice, UserSettings } from '@komogon/core';
import { ChevronDown, Laptop, Smartphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Reveal } from '@komogon/ui';
import { isPhone } from '../../lib/device';
import { useTour } from '../../lib/tour';
import { TimelapseTourSave } from '../onboarding/TimelapseTourSave';
import { presetOf, TimelapseSettings } from './Timelapse';
import { targetsFor, TimelapseLayoutEditor } from './TimelapseLayoutEditor';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const DEVICES: readonly TimelapseDevice[] = ['phone', 'computer'];
const NAMES: Record<TimelapseDevice, string> = { phone: 'Phone', computer: 'Computer' };

/** One line on how a preset comes out, for its folded header. */
function presetSummary(settings: UserSettings, device: TimelapseDevice): string {
  const p = presetOf(settings, device);
  const shape =
    device === 'phone'
      ? 'Upright and sideways'
      : settings.timelapse.format === 'story'
        ? 'Story / Reel'
        : p.aspect === 'camera'
          ? 'Camera’s shape'
          : p.aspect === 'screen'
            ? 'Screen’s shape'
            : p.aspect;
  const length =
    p.lengthMode === 'auto'
      ? 'Auto length'
      : p.lengthMode === 'length'
        ? `${p.lengthSeconds} s long`
        : `${p.speed}x`;
  return [shape, length, `${p.fps} fps`, p.recordBreaks ? 'breaks filmed' : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Settings › Timelapse's two presets, the phone's and the computer's, each folded until it
 * is clicked. A recording follows the preset of the device it is made on. Links to
 * `/settings#timelapse-phone` or `#timelapse-computer` open one.
 */
export function TimelapsePresets({
  settings,
  onChange,
}: {
  settings: UserSettings;
  onChange: (patch: DeepPartial<UserSettings>) => unknown;
}) {
  const here: TimelapseDevice = useMemo(() => (isPhone() ? 'phone' : 'computer'), []);
  // During the first-time setup, saving the layout is what ends its timelapse part.
  const touring = useTour()?.stage === 'timelapse';
  const [open, setOpen] = useState<Record<TimelapseDevice, boolean>>({
    phone: false,
    computer: false,
  });
  // A preset's editor stays put once opened, so folding it away keeps unsaved changes.
  const [opened, setOpened] = useState<Record<TimelapseDevice, boolean>>({
    phone: false,
    computer: false,
  });
  const toggle = (d: TimelapseDevice, next = !open[d]) => {
    setOpen((o) => ({ ...o, [d]: next }));
    if (next) setOpened((o) => ({ ...o, [d]: true }));
  };

  useEffect(() => {
    const fromHash = () => {
      const m = /^#timelapse-(phone|computer)$/.exec(window.location.hash);
      if (!m) return;
      const d = m[1] as TimelapseDevice;
      setOpen((o) => ({ ...o, [d]: true }));
      setOpened((o) => ({ ...o, [d]: true }));
      window.setTimeout(
        () => document.getElementById(`timelapse-${d}`)?.scrollIntoView({ block: 'start' }),
        60,
      );
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  // A phone's own preset comes first on a phone.
  const order = here === 'phone' ? DEVICES : [...DEVICES].reverse();

  return (
    <div className="tl-presets">
      {order.map((d) => {
        const Icon = d === 'phone' ? Smartphone : Laptop;
        return (
          <div key={d} id={`timelapse-${d}`} className={`tl-preset${open[d] ? ' is-open' : ''}`}>
            <button
              type="button"
              className="tl-preset-head"
              aria-expanded={open[d]}
              aria-controls={`timelapse-${d}-body`}
              onClick={() => toggle(d)}
            >
              <Icon size={18} aria-hidden className="tl-preset-icon" />
              <span className="tl-preset-text">
                <span className="tl-preset-name">
                  {NAMES[d]}
                  {here === d && <span className="tl-preset-here">This device</span>}
                </span>
                <span className="tl-preset-sum">{presetSummary(settings, d)}</span>
              </span>
              <ChevronDown size={18} aria-hidden className="tl-preset-chevron" />
            </button>
            <Reveal open={open[d]}>
              {opened[d] && (
                <div id={`timelapse-${d}-body`} className="tl-preset-body">
                  <p className="field-hint">
                    {d === 'phone'
                      ? 'On a phone, recording opens the camera with your timer on it, in place of the focus screen. Turn the phone and the screen turns too.'
                      : 'On a computer, the camera records beside the focus screen, with your screen too if you like.'}
                  </p>
                  <h3 className="font-medium">Layout</h3>
                  <TimelapseLayoutEditor
                    targets={targetsFor(settings, d)}
                    onChange={onChange}
                    screen={d === 'computer'}
                    active={open[d]}
                    footer={touring ? (c) => <TimelapseTourSave {...c} /> : undefined}
                  />
                  <div className="divider" />
                  <h3 className="font-medium">Recording</h3>
                  <TimelapseSettings settings={settings} device={d} onChange={onChange} />
                </div>
              )}
            </Reveal>
          </div>
        );
      })}
    </div>
  );
}
