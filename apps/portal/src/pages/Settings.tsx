import {
  dayStartUnlocksAt,
  minCostUnlocksAt,
  REWARDS,
  resolveBackgroundId,
  POMODORO_DURATION_KEYS,
  POMODORO_LIMITS,
  formatSoundLength,
  SILENT_SOUND_ID,
  SOUND_EVENT_LABELS,
  SOUND_PRESETS,
  STREAK_DAY_START,
  type UserSettings,
} from '@komogon/core';
import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import {
  Button,
  Glass,
  Input,
  Panel,
  Segmented,
  Select,
  Slider,
  Spinner,
  Toggle,
  useToast,
} from '@komogon/ui';
import { api, apiBaseUrl, authHeaders } from '../lib/api';
import { fmtDate, fmtTime } from '../lib/format';
import { GoogleCalendarSettings } from '../components/GoogleCalendarSettings';
import { GradeScaleSettings } from '../components/GradeScaleSettings';
import {
  matchSections,
  NoSettingsMatch,
  SETTINGS_SECTIONS,
  SettingsFilterProvider,
  SettingsNav,
  useSettingsFilter,
} from '../components/SettingsNav';
import { AccentPicker } from '../components/AccentPicker';
import { AppearancePresets } from '../components/AppearancePresets';
import { BackgroundPicker } from '../components/BackgroundPicker';
import { BackgroundUpload, PanelSettings } from '../components/PanelSettings';
import { ExtensionBackgroundPicker } from '../components/ExtensionBackgroundPicker';
import { VisualizerSettings } from '../components/focus/VisualizerSettings';
import { TimelapseSettings } from '../components/focus/Timelapse';
import { SessionHistory } from '../components/SessionHistory';
import { DataPrivacySettings } from '../components/DataPrivacySettings';
import { CUSTOM_BACKGROUND_UPLOAD } from '@komogon/core';
import { useQueryClient } from '@tanstack/react-query';
import { playSound } from '../lib/sounds';
import { keys } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { useResolvedTheme } from '../lib/appearance';
import {
  useAddVacation,
  useMe,
  useRemoveVacation,
  useRestDays,
  useSetWeeklyRestDays,
  useUpdateSettings,
} from '../lib/queries';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * A settings group. It renders only when the sidebar or the current search selects it, so
 * the long page becomes one group at a time without every call site having to know that.
 */
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
  const { visible } = useSettingsFilter();
  if (!visible.has(id)) return null;
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

const POMODORO_LABELS: Record<(typeof POMODORO_DURATION_KEYS)[number], string> = {
  workMin: 'Work (min)',
  shortBreakMin: 'Short break',
  longBreakMin: 'Long break',
  cyclesBeforeLong: 'Cycles before long',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const hourLabel = (h: number) => (h === 0 ? 'Midnight' : `${h} am`);

/**
 * When a new streak day begins. It may change once a day, so it can't be used to move a
 * late session into whichever day would save the streak.
 */
function DayStartField({
  hour,
  changedAt,
  onChange,
}: {
  hour: number;
  changedAt: string | null;
  onChange: (hour: number) => void;
}) {
  const unlocksAt = dayStartUnlocksAt(changedAt, new Date().toISOString());
  const hours: number[] = [];
  for (let h = STREAK_DAY_START.MIN_HOUR; h <= STREAK_DAY_START.MAX_HOUR; h++) hours.push(h);
  return (
    <Select
      label="A new streak day starts at"
      value={String(hour)}
      disabled={unlocksAt !== null}
      hint={
        unlocksAt
          ? `Changed recently. You can change it again ${fmtDate(unlocksAt, { weekday: 'short' })} at ${fmtTime(unlocksAt)}.`
          : 'Study before this hour counts toward the day before. You can change this once a day.'
      }
      onChange={(e) => {
        const next = Number(e.target.value);
        if (next === hour) return;
        const ok = window.confirm(
          `Start each streak day at ${hourLabel(next).toLowerCase()}? You won't be able to change it again for 24 hours.`,
        );
        if (ok) onChange(next);
        else e.target.value = String(hour);
      }}
    >
      {hours.map((h) => (
        <option key={h} value={h}>
          {hourLabel(h)}
        </option>
      ))}
    </Select>
  );
}

/** The least a reward may cost. Like the day start, it may change once a day. */
function MinCostField({
  value,
  changedAt,
  onChange,
}: {
  value: number;
  changedAt: string | null;
  onChange: (xp: number) => void;
}) {
  const unlocksAt = minCostUnlocksAt(changedAt, new Date().toISOString());
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <Input
      label="Minimum reward price (XP)"
      type="number"
      min={REWARDS.LOWEST_MIN_COST_XP}
      max={REWARDS.HIGHEST_MIN_COST_XP}
      step={10}
      value={v}
      disabled={unlocksAt !== null}
      hint={
        unlocksAt
          ? `Changed recently. You can change it again ${fmtDate(unlocksAt, { weekday: 'short' })} at ${fmtTime(unlocksAt)}.`
          : '150 XP takes about an hour of focus. You can change this once a day.'
      }
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v);
        const valid =
          Number.isInteger(n) &&
          n >= REWARDS.LOWEST_MIN_COST_XP &&
          n <= REWARDS.HIGHEST_MIN_COST_XP &&
          n !== value;
        if (
          valid &&
          window.confirm(
            `Set the minimum reward price to ${n} XP? You won't be able to change it again for 24 hours.`,
          )
        )
          onChange(n);
        else setV(String(value));
      }}
    />
  );
}

export function Settings() {
  const me = useMe();
  const update = useUpdateSettings();
  const auth = useAuth();
  const { toast } = useToast();
  const restDays = useRestDays();
  const qc = useQueryClient();
  const setWeekly = useSetWeeklyRestDays();
  const addVacation = useAddVacation();
  const removeVacation = useRemoveVacation();

  const s = me.data?.user.settings;
  const resolvedTheme = useResolvedTheme(s);
  const level = me.data?.user.level ?? 0;
  const purchased = me.data?.purchasedBackgrounds ?? [];

  const [weekly, setWeeklyLocal] = useState<number[] | null>(null);
  const [vac, setVac] = useState({ from: '', to: '', label: '' });
  const [domains, setDomains] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(SETTINGS_SECTIONS[0]!.id);
  const [name, setName] = useState<string | null>(null);

  // Links elsewhere in the app point at a group by hash (/settings#rest-days), so honour
  // it on arrival and whenever it changes.
  useEffect(() => {
    const fromHash = () => {
      const raw = window.location.hash.slice(1);
      // Account, You, and Data and privacy were separate before they merged; old links still land.
      const id = raw === 'account' || raw === 'privacy' ? 'profile' : raw;
      if (id && SETTINGS_SECTIONS.some((x) => x.id === id)) {
        setQuery('');
        setActiveId(id);
      }
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

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

  const theme = resolvedTheme;

  const feedUrl = `${apiBaseUrl()}/calendar.ics?token=${me.data?.icsToken ?? ''}`;
  const downloadIcs = async () => {
    const res = await fetch(`${apiBaseUrl(true)}/api/calendar/export.ics?sessions=true`, {
      headers: await authHeaders(),
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'komogon.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const policy = restDays.data?.policy;
  const weeklyDays = weekly ?? policy?.pendingWeeklyRestDays?.days ?? policy?.weeklyRestDays ?? [];

  const matches = matchSections(query);
  const matchedIds = new Set(matches.map((m) => m.id));
  const searching = query.trim().length > 0;
  const visible = searching ? matchedIds : new Set([activeId]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Settings</h1>

      <div className="settings-layout">
        <SettingsNav
          activeId={activeId}
          onSelect={setActiveId}
          query={query}
          onQuery={setQuery}
          matched={matchedIds}
        />

        <SettingsFilterProvider value={{ visible, searching }}>
          <div className="settings-main">
            {searching && matches.length === 0 && (
              <NoSettingsMatch query={query.trim()} onClear={() => setQuery('')} />
            )}

            <Section id="profile" title="Account">
              <Input
                label="Name"
                hint="Used to say hello, and shown on the leaderboard."
                placeholder="e.g. John"
                maxLength={60}
                value={name ?? s.profile.name ?? ''}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  const next = (name ?? '').trim();
                  if (name === null || next === (s.profile.name ?? '')) return;
                  void patch({ profile: { name: next || null } });
                }}
              />
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
              <p className="field-hint">Signed in as {me.data!.user.email || auth.email}.</p>
              <h3 className="settings-group-head">Data and privacy</h3>
              <DataPrivacySettings />
            </Section>

            <Section id="pages" title="Pages">
              <p className="field-hint">
                Turn off the pages you don't use, and choose what each one shows.
              </p>
              <Toggle
                checked={s.features.routines}
                onChange={(v) => patch({ features: { routines: v } })}
                label="Routines"
                description="Things you do on a schedule, every day or every week."
              />
              <Toggle
                checked={s.features.plans}
                onChange={(v) => patch({ features: { plans: v } })}
                label="Plans"
                description="Study plans for anything without a syllabus."
              />
              <Toggle
                checked={s.features.grades}
                onChange={(v) => patch({ features: { grades: v } })}
                label="Grades"
                description="Your marks by class and what you need on the next one."
              />
              <Toggle
                checked={s.features.calendar}
                onChange={(v) => patch({ features: { calendar: v } })}
                label="Calendar"
                description="Your week laid out with deadlines and sessions."
              />
              {/*
               * Pages holds every setting about what the screens show and how they are laid
               * out, one sub-panel per page. New layout settings go here, not in other sections.
               */}
              <h3 className="settings-group-head">Dashboard</h3>
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
              <Toggle
                checked={s.quote.appTips}
                onChange={(v) => patch({ quote: { appTips: v } })}
                label="Tips about the app"
                description="Now and then a short tip about Komogon shows under the start panel, with a link to try it."
              />
            </Section>

            <Section id="theme" title="Appearance" glass>
              <AppearancePresets
                theme={s.theme}
                resolved={theme}
                patch={patch}
                onImageApplied={() => {
                  void qc.invalidateQueries({ queryKey: keys.background });
                  void me.refetch();
                }}
              />
              <div className="field">
                <span className="field-label">Theme</span>
                <Segmented
                  ariaLabel="Theme"
                  value={s.theme.mode}
                  onChange={(mode) => patch({ theme: { mode } })}
                  options={[
                    { value: 'recommended', label: 'Recommended' },
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                />
                {s.theme.mode === 'recommended' && (
                  <p className="field-hint">
                    Light or dark, whichever suits your background. On the plain gradients it
                    follows your system.
                  </p>
                )}
              </div>
              <div className="field">
                <span className="field-label">Accent</span>
                <AccentPicker
                  value={s.theme.accent}
                  saved={s.theme.savedAccents}
                  onChange={(t) => patch({ theme: t })}
                />
              </div>
              <div className="field">
                <span className="field-label">Background</span>
                <BackgroundPicker
                  value={
                    s.theme.customBackgroundUrl ? '' : resolveBackgroundId(s.theme.backgroundId)
                  }
                  level={level}
                  purchased={purchased}
                  theme={theme}
                  onChange={(id) =>
                    patch({ theme: { backgroundId: id, customBackgroundUrl: null } })
                  }
                />
              </div>
              <ExtensionBackgroundPicker
                value={s.theme.extensionBackground}
                hasUpload={s.theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD}
                level={level}
                purchased={purchased}
                theme={theme}
                onChange={(v) => patch({ theme: { extensionBackground: v } })}
              />
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
                description="Upload your own image."
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
            </Section>

            <Section id="timer" title="Timer">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {POMODORO_DURATION_KEYS.map((k) => (
                  <NumberField
                    key={k}
                    label={POMODORO_LABELS[k]}
                    value={s.pomodoro[k]}
                    min={POMODORO_LIMITS[k].min}
                    max={POMODORO_LIMITS[k].max}
                    onCommit={(v) => patch({ pomodoro: { [k]: v } })}
                  />
                ))}
              </div>
              <p className="field-hint">
                A session gives you XP when you complete at least 10 minutes of work, or when you
                mark a task done.
              </p>
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
                  The assessment after a session. Gives more data for analytics and planning.
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

            <Section id="focus" title="Focus screen">
              <div className="field">
                <span className="field-label">Open it when a session starts</span>
                <Segmented
                  ariaLabel="Open the focus screen when a session starts"
                  value={s.focusScreen.openOnStart}
                  onChange={(openOnStart) => patch({ focusScreen: { openOnStart } })}
                  options={[
                    { value: 'ask', label: 'Ask' },
                    { value: 'always', label: 'Always' },
                    { value: 'never', label: 'Never' },
                  ]}
                />
              </div>
              <div className="divider" />
              <VisualizerSettings value={s.visualizer} onChange={patch} showPromptPreference />
              <div className="divider" />
              <h3 className="font-medium">Timelapse</h3>
              <p className="field-hint">
                Records you from the camera while you focus, as a short video. The stills stay on
                this computer.
              </p>
              <TimelapseSettings value={s.timelapse} onChange={patch} />
            </Section>

            <Section id="sounds" title="Sounds">
              <Toggle
                checked={s.sounds.enabled}
                onChange={(v) => patch({ sounds: { enabled: v } })}
                label="Sounds"
              />
              {s.sounds.enabled && (
                <>
                  <div className="field">
                    <span className="field-label">Volume {Math.round(s.sounds.volume * 100)}%</span>
                    <Slider
                      min={0}
                      max={1}
                      step={0.05}
                      value={s.sounds.volume}
                      onChange={(v) => patch({ sounds: { volume: v } })}
                      onMouseUp={() => playSound(s.sounds.workStart, s.sounds.volume)}
                      aria-label="Volume"
                    />
                  </div>
                  {SOUND_EVENT_LABELS.map((ev) => (
                    <div className="field" key={ev.id}>
                      <span className="field-label">{ev.label}</span>
                      <div className="flex items-end gap-2">
                        <Select
                          aria-label={ev.label}
                          className="flex-1"
                          value={s.sounds[ev.id]}
                          onChange={(e) => {
                            const id = e.target.value;
                            void patch({ sounds: { [ev.id]: id } });
                            // Play it as it is picked, so choosing does not need a second click.
                            playSound(id, s.sounds.volume);
                          }}
                        >
                          {SOUND_PRESETS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.seconds > 0 ? ` — ${formatSoundLength(p)}` : ''}
                            </option>
                          ))}
                        </Select>
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Preview ${ev.label}`}
                          disabled={s.sounds[ev.id] === SILENT_SOUND_ID}
                          onClick={() => playSound(s.sounds[ev.id], s.sounds.volume)}
                        >
                          <Volume2 size={15} aria-hidden /> Play
                        </Button>
                      </div>
                      <span className="field-hint">{ev.hint}</span>
                    </div>
                  ))}
                </>
              )}
            </Section>

            <Section id="pace" title="Pace and streaks">
              <NumberField
                label="Weekly goal (hours)"
                value={Math.round((s.goals.weeklyMinutes / 60) * 10) / 10}
                min={0.5}
                max={168}
                step={0.5}
                onCommit={(v) => patch({ goals: { weeklyMinutes: Math.round(v * 60) } })}
              />
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
              <DayStartField
                hour={s.streak.dayStartHour}
                changedAt={s.streak.dayStartChangedAt}
                onChange={(h) => patch({ streak: { dayStartHour: h } })}
              />
              <MinCostField
                value={s.rewards.minCostXp}
                changedAt={s.rewards.minCostChangedAt}
                onChange={(xp) => patch({ rewards: { minCostXp: xp } })}
              />
            </Section>

            <Section id="grading" title="Grades">
              <GradeScaleSettings settings={s} onPatch={patch} />
            </Section>

            <Section id="rest-days" title="Rest days">
              <p className="muted text-sm">
                Rest days never break a streak. Weekly changes take effect next Monday. Vacations
                need 48 hours notice and can be removed anytime.{' '}
                {restDays.data && (
                  <strong>
                    {restDays.data.editsRemaining} change
                    {restDays.data.editsRemaining === 1 ? '' : 's'} left this week.
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
                        weeklyDays.includes(i)
                          ? weeklyDays.filter((x) => x !== i)
                          : [...weeklyDays, i],
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
                  Pending:{' '}
                  {policy.pendingWeeklyRestDays.days.map((d) => DAYS[d]).join(', ') || 'none'} from{' '}
                  {policy.pendingWeeklyRestDays.effectiveFrom}.
                </p>
              )}
              <div className="flex flex-col gap-2">
                <span className="field-label">Vacations</span>
                {policy?.vacations.length === 0 && (
                  <span className="field-hint">None planned.</span>
                )}
                {policy?.vacations.map((v) => (
                  <div key={v.from} className="flex items-center gap-3 text-sm">
                    <span className="tabular">
                      {v.from} to {v.to}
                    </span>
                    <span className="muted">{v.label}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        removeVacation.mutateAsync(v.from).catch((e) => toast(e.message))
                      }
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
                        await addVacation.mutateAsync({
                          from: vac.from,
                          to: vac.to,
                          label: vac.label,
                        });
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
                  Anyone with this link can see your planned blocks. If it gets out, regenerate it
                  to make a new one.
                </span>
                <div>
                  <Button size="sm" onClick={downloadIcs}>
                    Download .ics once
                  </Button>
                </div>
              </div>
            </Section>

            <Section id="history" title="Session history">
              <SessionHistory />
            </Section>
          </div>
        </SettingsFilterProvider>
      </div>
    </div>
  );
}
