import {
  ACCENT_PRESETS,
  BACKGROUNDS,
  isAccentUnlocked,
  isBackgroundAvailable,
  type UserSettings,
} from '@doloop/core';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BACKGROUND_DEFS,
  Button,
  Glass,
  hslToRgb,
  Input,
  Panel,
  resolveTheme,
  rgbToHsl,
  Segmented,
  Select,
  Slider,
  Spinner,
  Toggle,
  useToast,
  hexToRgb,
} from '@doloop/ui';
import { api, apiBaseUrl, authHeaders } from '../lib/api';
import { GoogleCalendarSettings } from '../components/GoogleCalendarSettings';
import { BackgroundUpload, PanelSettings } from '../components/PanelSettings';
import { CUSTOM_BACKGROUND_UPLOAD } from '@doloop/core';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../lib/queries';
import { useAuth } from '../lib/auth';
import {
  useAddVacation,
  useMe,
  useRemoveVacation,
  useRestDays,
  useSetWeeklyRestDays,
  useUpdateSettings,
} from '../lib/queries';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function Section({
  id,
  title,
  children,
  glass = false,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  glass?: boolean;
}) {
  const Comp = glass ? Glass : Panel;
  return (
    <Comp as="section" id={id} className="settings-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </Comp>
  );
}

function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <Input
      label={label}
      hint={hint}
      type="number"
      min={min}
      max={max}
      step={step}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v);
        if (!Number.isNaN(n) && n >= min && n <= max && n !== value) onCommit(n);
        else setV(String(value));
      }}
    />
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Mirrors the presets in packages/ui/tokens.css for swatch previews. */
const ACCENT_HSL: Record<string, string> = {
  indigo: 'hsl(240 84% 62%)',
  sky: 'hsl(199 89% 48%)',
  mint: 'hsl(160 64% 42%)',
  amber: 'hsl(38 92% 50%)',
  rose: 'hsl(346 77% 56%)',
  violet: 'hsl(271 81% 60%)',
};

export function Settings() {
  const me = useMe();
  const update = useUpdateSettings();
  const auth = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const restDays = useRestDays();
  const qc = useQueryClient();
  const setWeekly = useSetWeeklyRestDays();
  const addVacation = useAddVacation();
  const removeVacation = useRemoveVacation();

  const s = me.data?.user.settings;
  const level = me.data?.user.level ?? 0;
  const purchased = me.data?.purchasedBackgrounds ?? [];

  const [weekly, setWeeklyLocal] = useState<number[] | null>(null);
  const [vac, setVac] = useState({ from: '', to: '', label: '' });
  const [domains, setDomains] = useState<string | null>(null);
  const [customBg, setCustomBg] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (window.location.hash)
      document.querySelector(window.location.hash)?.scrollIntoView({ block: 'start' });
  }, [me.isSuccess]);

  if (!s)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  const patch = (p: DeepPartial<UserSettings>) =>
    update
      .mutateAsync(p)
      .catch((err) => toast(err instanceof Error ? err.message : 'Could not save'));

  const theme = resolveTheme(s.theme.mode);
  const customAccent = s.theme.accent.startsWith('custom:');
  const customHex = (() => {
    if (!customAccent) return '#6366f1';
    const [h, sat, l] = s.theme.accent.slice(7).split(',').map(Number);
    const [r, g, b] = hslToRgb(h ?? 240, sat ?? 84, l ?? 62);
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  })();

  const feedUrl = `${apiBaseUrl()}/calendar.ics?token=${me.data?.icsToken ?? ''}`;
  const downloadIcs = async () => {
    const res = await fetch(`${apiBaseUrl(true)}/api/calendar/export.ics?sessions=true`, {
      headers: await authHeaders(),
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'doloop.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const policy = restDays.data?.policy;
  const weeklyDays = weekly ?? policy?.pendingWeeklyRestDays?.days ?? policy?.weeklyRestDays ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl">Settings</h1>

      <Section id="theme" title="Appearance" glass>
        <div className="field">
          <span className="field-label">Theme</span>
          <Segmented
            ariaLabel="Theme"
            value={s.theme.mode}
            onChange={(mode) => patch({ theme: { mode } })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <div className="field">
          <span className="field-label">Accent</span>
          <div className="pill-row items-center">
            {ACCENT_PRESETS.map((a) => {
              const unlocked = isAccentUnlocked(a.id, level);
              return (
                <button
                  key={a.id}
                  type="button"
                  className="swatch"
                  aria-pressed={s.theme.accent === a.id}
                  aria-label={unlocked ? a.name : `${a.name}, unlocks at level ${a.minLevel}`}
                  title={unlocked ? a.name : `Unlocks at level ${a.minLevel}`}
                  disabled={!unlocked}
                  style={{ background: ACCENT_HSL[a.id] ?? 'var(--accent)' }}
                  onClick={() => patch({ theme: { accent: a.id } })}
                >
                  {!unlocked && (
                    <span className="text-xs" style={{ color: '#fff' }}>
                      {a.minLevel}
                    </span>
                  )}
                </button>
              );
            })}
            <label className="flex items-center gap-2 text-sm ml-2">
              <input
                type="color"
                aria-label="Custom accent"
                value={customHex}
                onChange={(e) => {
                  const [h, sat, l] = rgbToHsl(hexToRgb(e.target.value));
                  void patch({
                    theme: {
                      accent: `custom:${h},${Math.max(30, sat)},${Math.min(70, Math.max(35, l))}`,
                    },
                  });
                }}
              />
              Custom
            </label>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Background</span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {BACKGROUNDS.map((b) => {
              const def = BACKGROUND_DEFS.find((d) => d.id === b.id);
              const available = isBackgroundAvailable(b.id, level, purchased);
              return (
                <button
                  key={b.id}
                  type="button"
                  className="bg-thumb"
                  aria-pressed={s.theme.backgroundId === b.id && !s.theme.customBackgroundUrl}
                  aria-label={
                    available
                      ? b.name
                      : `${b.name}, ${b.costXp ? `${b.costXp} XP in the shop` : `level ${b.minLevel}`}`
                  }
                  disabled={!available}
                  style={{
                    background: def ? (theme === 'dark' ? def.dark.css : def.light.css) : undefined,
                    opacity: available ? 1 : 0.5,
                  }}
                  onClick={() =>
                    patch({ theme: { backgroundId: b.id, customBackgroundUrl: null } })
                  }
                >
                  <span className="bg-thumb-label">
                    {available ? b.name : b.costXp ? `${b.costXp} XP` : `Lv ${b.minLevel}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <PanelSettings
          panel={s.theme.panel}
          panelColor={s.theme.panelColor}
          panelAlpha={s.theme.panelAlpha}
          onChange={patch}
        />
        <Toggle
          checked={advanced || !!s.theme.customBackgroundUrl}
          onChange={setAdvanced}
          label="Advanced"
          description="Use your own image. Text colour and glass opacity adapt to it automatically."
        />
        {(advanced || !!s.theme.customBackgroundUrl) && (
          <BackgroundUpload
            hasUpload={s.theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD}
            onChanged={() => {
              void qc.invalidateQueries({ queryKey: keys.background });
              void me.refetch();
            }}
          />
        )}
        {(advanced || !!s.theme.customBackgroundUrl) && (
          <div className="flex gap-2 items-end">
            <Input
              label="Image URL"
              placeholder="https://…"
              value={
                customBg ??
                (s.theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD
                  ? ''
                  : (s.theme.customBackgroundUrl ?? ''))
              }
              onChange={(e) => setCustomBg(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={() =>
                patch({ theme: { customBackgroundUrl: (customBg ?? '').trim() || null } })
              }
            >
              Apply
            </Button>
            {s.theme.customBackgroundUrl && (
              <Button
                variant="ghost"
                onClick={() => {
                  setCustomBg('');
                  void patch({ theme: { customBackgroundUrl: null } });
                }}
              >
                Remove
              </Button>
            )}
          </div>
        )}
      </Section>

      <Section id="timer" title="Timer">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <NumberField
            label="Work (min)"
            value={s.pomodoro.workMin}
            min={1}
            max={180}
            onCommit={(v) => patch({ pomodoro: { workMin: v } })}
          />
          <NumberField
            label="Short break"
            value={s.pomodoro.shortBreakMin}
            min={1}
            max={60}
            onCommit={(v) => patch({ pomodoro: { shortBreakMin: v } })}
          />
          <NumberField
            label="Long break"
            value={s.pomodoro.longBreakMin}
            min={1}
            max={120}
            onCommit={(v) => patch({ pomodoro: { longBreakMin: v } })}
          />
          <NumberField
            label="Cycles before long"
            value={s.pomodoro.cyclesBeforeLong}
            min={1}
            max={12}
            onCommit={(v) => patch({ pomodoro: { cyclesBeforeLong: v } })}
          />
        </div>
        <Toggle
          checked={s.pomodoro.autoStartBreaks}
          onChange={(v) => patch({ pomodoro: { autoStartBreaks: v } })}
          label="Auto-start breaks"
        />
        <Toggle
          checked={s.pomodoro.autoStartWork}
          onChange={(v) => patch({ pomodoro: { autoStartWork: v } })}
          label="Auto-start work after a break"
        />
        <Toggle
          checked={s.pomodoro.showTimerByDefault}
          onChange={(v) => patch({ pomodoro: { showTimerByDefault: v } })}
          label="Show the timer by default"
          description="You can still hide it per session."
        />
        <Toggle
          checked={s.idle.enabled}
          onChange={(v) => patch({ idle: { enabled: v } })}
          label="Idle detection"
          description="Pause the work clock when there is no input and ask if you are still studying."
        />
        {s.idle.enabled && (
          <NumberField
            label="Idle after (min)"
            value={s.idle.thresholdMin}
            min={1}
            max={120}
            onCommit={(v) => patch({ idle: { thresholdMin: v } })}
          />
        )}
      </Section>

      <Section id="review" title="After each session">
        <div className="field">
          <span className="field-label">Review</span>
          <Segmented
            ariaLabel="Review mode"
            value={s.review.mode}
            onChange={(mode) => patch({ review: { mode } })}
            options={[
              { value: 'quick', label: 'Quick' },
              { value: 'full', label: 'Full' },
              { value: 'off', label: 'Off' },
            ]}
          />
          <span className="field-hint">
            Quick asks two questions. Full adds counts, mood, estimate check, and a note. Always
            skippable.
          </span>
        </div>
        <Toggle
          checked={s.effects.phrases}
          onChange={(v) => patch({ effects: { phrases: v } })}
          label="Phrases"
          description="A short line after each session."
        />
        <Toggle
          checked={s.effects.confetti}
          onChange={(v) => patch({ effects: { confetti: v } })}
          label="Confetti"
        />
        <Toggle
          checked={s.effects.badgeToasts}
          onChange={(v) => patch({ effects: { badgeToasts: v } })}
          label="Badge toasts"
        />
        <div className="field">
          <span className="field-label">Motion</span>
          <Segmented
            ariaLabel="Reduced motion"
            value={s.effects.reducedMotion}
            onChange={(reducedMotion) => patch({ effects: { reducedMotion } })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'on', label: 'Reduce' },
              { value: 'off', label: 'Full' },
            ]}
          />
        </div>
      </Section>

      <Section id="sounds" title="Sounds">
        <Toggle
          checked={s.sounds.enabled}
          onChange={(v) => patch({ sounds: { enabled: v } })}
          label="Sounds"
        />
        {s.sounds.enabled && (
          <>
            <Toggle
              checked={s.sounds.endOfInterval}
              onChange={(v) => patch({ sounds: { endOfInterval: v } })}
              label="Chime at the end of a work or break interval"
            />
            <Toggle
              checked={s.sounds.endOfBlock}
              onChange={(v) => patch({ sounds: { endOfBlock: v } })}
              label="Chime when a scheduled session ends"
            />
            <div className="field">
              <span className="field-label">Volume {Math.round(s.sounds.volume * 100)}%</span>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={s.sounds.volume}
                onChange={(v) => patch({ sounds: { volume: v } })}
                aria-label="Volume"
              />
            </div>
          </>
        )}
      </Section>

      <Section id="pace" title="Pace and streaks">
        <NumberField
          label="Comfortable minutes per day"
          value={s.pace.maxComfortableMinutesPerDay}
          min={15}
          max={1440}
          step={15}
          hint="Above this, a task is marked critical."
          onCommit={(v) => patch({ pace: { maxComfortableMinutesPerDay: v } })}
        />
        <NumberField
          label="Minimum minutes for a streak day"
          value={s.streak.minMinutes}
          min={1}
          max={240}
          onCommit={(v) => patch({ streak: { minMinutes: v } })}
        />
        <div className="field">
          <span className="field-label">Daily card</span>
          <Segmented
            ariaLabel="Quote mode"
            value={s.quote.mode}
            onChange={(mode) => patch({ quote: { mode } })}
            options={[
              { value: 'quotes', label: 'Quotes' },
              { value: 'research-tips', label: 'Research tips' },
              { value: 'both', label: 'Both' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </div>
      </Section>

      <Section id="rest-days" title="Rest days">
        <p className="muted text-sm">
          Rest days never break a streak. Weekly changes take effect next Monday. Vacations need 48
          hours notice and can be removed anytime.{' '}
          {restDays.data && (
            <strong>
              {restDays.data.editsRemaining} change{restDays.data.editsRemaining === 1 ? '' : 's'}{' '}
              left this week.
            </strong>
          )}
        </p>
        <div className="pill-row" role="group" aria-label="Weekly rest days">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              className="segmented-item"
              style={{ border: '1px solid var(--border-strong)' }}
              aria-pressed={weeklyDays.includes(i)}
              onClick={() =>
                setWeeklyLocal(
                  weeklyDays.includes(i) ? weeklyDays.filter((x) => x !== i) : [...weeklyDays, i],
                )
              }
            >
              {d}
            </button>
          ))}
          {weekly !== null && (
            <Button
              variant="primary"
              size="sm"
              loading={setWeekly.isPending}
              onClick={async () => {
                try {
                  await setWeekly.mutateAsync(weekly);
                  setWeeklyLocal(null);
                  toast('Rest days scheduled from next Monday', { tone: 'ok' });
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Could not save');
                }
              }}
            >
              Save
            </Button>
          )}
        </div>
        {policy?.pendingWeeklyRestDays && (
          <p className="field-hint">
            Pending: {policy.pendingWeeklyRestDays.days.map((d) => DAYS[d]).join(', ') || 'none'}{' '}
            from {policy.pendingWeeklyRestDays.effectiveFrom}.
          </p>
        )}
        <div className="flex flex-col gap-2">
          <span className="field-label">Vacations</span>
          {policy?.vacations.length === 0 && <span className="field-hint">None planned.</span>}
          {policy?.vacations.map((v) => (
            <div key={v.from} className="flex items-center gap-3 text-sm">
              <span className="tabular">
                {v.from} to {v.to}
              </span>
              <span className="muted">{v.label}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeVacation.mutateAsync(v.from).catch((e) => toast(e.message))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
            <Input
              label="From"
              type="date"
              value={vac.from}
              onChange={(e) => setVac({ ...vac, from: e.target.value })}
            />
            <Input
              label="To"
              type="date"
              value={vac.to}
              onChange={(e) => setVac({ ...vac, to: e.target.value })}
            />
            <Input
              label="Label"
              value={vac.label}
              onChange={(e) => setVac({ ...vac, label: e.target.value })}
              placeholder="optional"
            />
            <Button
              disabled={!vac.from || !vac.to}
              loading={addVacation.isPending}
              onClick={async () => {
                try {
                  await addVacation.mutateAsync({ from: vac.from, to: vac.to, label: vac.label });
                  setVac({ from: '', to: '', label: '' });
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Could not add');
                }
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </Section>

      <Section id="blocking" title="Site blocking (extension)">
        <Toggle
          checked={s.blocking.enabled}
          onChange={(v) => patch({ blocking: { enabled: v } })}
          label="Block distracting sites during work intervals"
          description="Only the Chrome extension enforces this. Off by default."
        />
        <div className="flex gap-2 items-end">
          <Input
            label="Domains, one per line or comma-separated"
            value={domains ?? s.blocking.domains.join('\n')}
            onChange={(e) => setDomains(e.target.value)}
            className="flex-1"
            placeholder="youtube.com"
          />
          <Button
            onClick={() => {
              const list = (domains ?? '')
                .split(/[\n,]/)
                .map((d) =>
                  d
                    .trim()
                    .toLowerCase()
                    .replace(/^https?:\/\//, '')
                    .replace(/\/.*$/, ''),
                )
                .filter(Boolean);
              void patch({ blocking: { domains: [...new Set(list)] } });
            }}
          >
            Save
          </Button>
        </div>
      </Section>

      <Section id="calendar" title="Calendar">
        <GoogleCalendarSettings />
        <div className="divider" />
        <div className="flex flex-col gap-2">
          <span className="field-label">Subscribe from any calendar app (.ics)</span>
          <div className="flex gap-2 items-center flex-wrap">
            <Input
              readOnly
              value={feedUrl}
              aria-label="Feed URL"
              className="flex-1"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              onClick={() =>
                navigator.clipboard
                  .writeText(feedUrl)
                  .then(() => toast('Copied', { tone: 'ok' }))
                  .catch(() => toast('Could not copy'))
              }
            >
              Copy
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await api.regenerateIcsToken();
                await me.refetch();
                toast('Feed URL regenerated. Re-subscribe in your calendar app.');
              }}
            >
              Regenerate
            </Button>
          </div>
          <span className="field-hint">
            Anyone with this URL can see your planned blocks. Regenerate it if it leaks.
          </span>
          <div>
            <Button size="sm" onClick={downloadIcs}>
              Download .ics once
            </Button>
          </div>
        </div>
      </Section>

      <Section id="account" title="Account">
        <Select
          label="Timezone"
          value={me.data!.user.timezone}
          onChange={async (e) => {
            await api.updateMe({ timezone: e.target.value });
            void me.refetch();
          }}
        >
          {Intl.supportedValuesOf('timeZone').map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={async () => {
              const data = await api.exportData();
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'doloop-export.json';
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export my data (JSON)
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!window.confirm('Delete your account and all data? This cannot be undone.'))
                return;
              await api.deleteAccount();
              await auth.signOut();
              navigate('/signin');
            }}
          >
            Delete account
          </Button>
        </div>
        <p className="field-hint">
          Signed in as {me.data!.user.email || auth.email}. No analytics or tracking SDKs are used.
        </p>
      </Section>
    </div>
  );
}
