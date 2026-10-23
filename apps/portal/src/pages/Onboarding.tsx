import {
  NOT_IN_UNIVERSITY,
  ONBOARDING_APPS,
  ONBOARDING_CALENDARS,
  ONBOARDING_LOOKS,
  ONBOARDING_USES,
  ONTARIO_UNIVERSITIES,
  type OnboardingAnswers,
  type OnboardingCalendar,
  type OnboardingLookId,
} from '@komogon/core';
import {
  accentHexFor,
  Backdrop,
  backgroundById,
  Button,
  Glass,
  Input,
  LogoMark,
  Segmented,
  Spinner,
  textureStyle,
} from '@komogon/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronRight, ExternalLink, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { eventsLabel, useRefreshFeeds } from '../components/CalendarFeedsSettings';
import { ErrorPanel } from '../components/ErrorState';
import { backgroundStyle, cardLook, lookTheme as presetTheme } from '../components/ThemePicker';
import { SectionProgress } from '../components/onboarding/SectionProgress';
import '../components/onboarding/onboarding.css';
import { api, type MeResponse } from '../lib/api';
import { useAppearance } from '../lib/appearance';
import { lookPatch, lookPreset } from '../lib/onboarding-looks';
import { keys, useMe, useUpdateSettings } from '../lib/queries';
import { saveAnswers, setTour } from '../lib/tour';

/** The questions in order, each named for the answer it fills. */
const STEPS = ['look', 'university', 'uses', 'apps', 'calendar'] as const satisfies ReadonlyArray<
  keyof OnboardingAnswers
>;
type Step = (typeof STEPS)[number];

/**
 * The first part of the first-time setup: a few questions, each one skippable, and the whole
 * part too. Then the account counts as set up and the look around starts in the app itself
 * (`components/onboarding/Tour.tsx`).
 */
export function Onboarding() {
  const me = useMe();
  const settings = me.data?.user.settings;
  const appearance = useAppearance(settings);
  const stored = useQuery({ queryKey: ['onboarding'], queryFn: api.onboarding, retry: 1 });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [step, setStep] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carry on from the first question not yet answered or skipped.
  useEffect(() => {
    if (step !== null || stored.isPending) return;
    const saved = stored.data?.answers ?? {};
    setAnswers(saved);
    const next = STEPS.findIndex((s) => !(s in saved));
    setStep(next === -1 ? 0 : next);
  }, [stored.isPending, stored.data, step]);

  // Finishing marks the account set up just before it moves on to Tasks; only a visit to an
  // account that was already set up goes home.
  if (me.data?.onboarded && !leaving) return <Navigate to="/" replace />;

  const answer = (patch: OnboardingAnswers) => {
    setAnswers((a) => ({ ...a, ...patch }));
    saveAnswers(patch);
  };

  /** The questions are done (or skipped): the account is set up, and the look around starts. */
  const finish = async (end: 'done' | 'skipped') => {
    const userId = me.data?.user.id;
    if (!userId) return;
    setLeaving(true);
    setError(null);
    saveAnswers({ sections: { questions: end } });
    try {
      const res = await api.updateMe({ onboarded: true });
      setTour(userId, { stage: 'tour', stop: 0 });
      qc.setQueryData<MeResponse>(keys.me, (old) =>
        old ? { ...old, onboarded: true, user: res.user } : old,
      );
      navigate('/tasks', { replace: true });
      void qc.invalidateQueries({ queryKey: keys.me });
    } catch (err) {
      setLeaving(false);
      setError(err instanceof Error ? err.message : 'Could not finish setting up your account.');
    }
  };

  const next = () => {
    if (step === null) return;
    if (step + 1 < STEPS.length) setStep(step + 1);
    else void finish('done');
  };
  /** Skipped questions are kept as null, so a skip can be told from never asked. */
  const skip = (s: Step) => {
    answer({ [s]: null } as OnboardingAnswers);
    next();
  };

  const current = step === null ? null : STEPS[step]!;

  return (
    <>
      <Backdrop
        backgroundId={appearance.backgroundId}
        theme={appearance.theme}
        customImageUrl={appearance.customImageUrl}
        glass={appearance.glass}
      />
      <main className="ob-page on-backdrop">
        <Glass strong className="ob-card">
          <div className="ob-head">
            <span className="ob-brand">
              <LogoMark size={24} />
              Komodon
            </span>
            <button
              type="button"
              className="link-button ob-skip-section"
              onClick={() => void finish('skipped')}
              disabled={leaving}
            >
              Skip section
            </button>
          </div>
          <SectionProgress section={0} progress={step === null ? 0 : (step + 1) / STEPS.length} />
          {error ? (
            <ErrorPanel message={error} onRetry={() => void finish('done')} />
          ) : current === null || leaving ? (
            <div className="ob-loading">
              <Spinner />
            </div>
          ) : (
            <div key={current} className="ob-step">
              {current === 'look' && (
                <LookStep
                  initial={answers.look ?? null}
                  dark={appearance.theme === 'dark'}
                  onDone={(look) => {
                    answer({ look });
                    next();
                  }}
                  onSkip={() => skip('look')}
                />
              )}
              {current === 'university' && (
                <UniversityStep
                  initial={answers.university ?? null}
                  onDone={(university) => {
                    answer({ university });
                    next();
                  }}
                  onSkip={() => skip('university')}
                />
              )}
              {current === 'uses' && (
                <PickStep
                  title="What will you use Komodon for?"
                  options={ONBOARDING_USES}
                  initial={answers.uses ?? []}
                  onDone={(uses) => {
                    answer({ uses: uses as OnboardingAnswers['uses'] });
                    next();
                  }}
                  onSkip={() => skip('uses')}
                />
              )}
              {current === 'apps' && (
                <PickStep
                  title="Using another app for this right now?"
                  options={ONBOARDING_APPS}
                  only="none"
                  initial={answers.apps ?? []}
                  onDone={(apps) => {
                    answer({ apps: apps as OnboardingAnswers['apps'] });
                    next();
                  }}
                  onSkip={() => skip('apps')}
                />
              )}
              {current === 'calendar' && (
                <CalendarStep onAnswer={answer} onDone={next} onSkip={() => skip('calendar')} />
              )}
            </div>
          )}
        </Glass>
      </main>
    </>
  );
}

/** A question's title, its body, and Skip and Continue along the bottom. */
function Question({
  title,
  line,
  children,
  onSkip,
  onContinue,
  canContinue = true,
  actions,
}: {
  title: string;
  line?: string;
  children: ReactNode;
  /** Left out once there is nothing left to skip. */
  onSkip?: () => void;
  /** Left out when the body has its own buttons. */
  onContinue?: () => void;
  canContinue?: boolean;
  /** Buttons in Continue's place. */
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="ob-question">
        <h1 className="ob-title">{title}</h1>
        {line && <p className="muted">{line}</p>}
      </div>
      {children}
      <div className="ob-actions">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        )}
        {actions ??
          (onContinue && (
            <Button variant="primary" onClick={onContinue} disabled={!canContinue}>
              Continue
            </Button>
          ))}
      </div>
    </>
  );
}

function LookStep({
  initial,
  dark: darkNow,
  onDone,
  onSkip,
}: {
  initial: { id: OnboardingLookId; dark: boolean } | null;
  dark: boolean;
  onDone: (look: { id: OnboardingLookId; dark: boolean }) => void;
  onSkip: () => void;
}) {
  const update = useUpdateSettings();
  const [id, setId] = useState<OnboardingLookId | null>(initial?.id ?? null);
  const [dark, setDark] = useState(initial?.dark ?? darkNow);
  // Each pick shows at once, behind the card.
  const apply = (nextId: OnboardingLookId | null, nextDark: boolean) => {
    if (nextId) update.mutate(lookPatch(nextId, nextDark));
  };

  return (
    <Question
      title="Pick a look"
      onSkip={onSkip}
      onContinue={() => id && onDone({ id, dark })}
      canContinue={id !== null}
    >
      <Segmented
        className="ob-mode"
        ariaLabel="Light or dark"
        value={dark ? 'dark' : 'light'}
        onChange={(v) => {
          setDark(v === 'dark');
          apply(id, v === 'dark');
        }}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
      <div className="ob-looks">
        {ONBOARDING_LOOKS.map((look) => (
          <button
            key={look.id}
            type="button"
            className="ob-look"
            aria-pressed={id === look.id}
            onClick={() => {
              setId(look.id);
              apply(look.id, dark);
            }}
          >
            <LookPreview id={look.id} dark={dark} />
            <span className="ob-look-name">
              {look.label}
              {look.id === RECOMMENDED_LOOK && <span className="ob-look-tag">Recommended</span>}
              {id === look.id && <Check size={16} aria-hidden className="ob-look-check" />}
            </span>
          </button>
        ))}
      </div>
    </Question>
  );
}

/** The look marked "Recommended" (the owner's, 2026-10-22): the default every account starts on. */
const RECOMMENDED_LOOK: OnboardingLookId = 'dawn-skies';

/** A look as it comes out: its background, and a little card in its panels and accent. */
function LookPreview({ id, dark }: { id: OnboardingLookId; dark: boolean }) {
  const preset = lookPreset(id, dark);
  const resolved = presetTheme(preset);
  const def = backgroundById(preset.look.backgroundId);
  const pattern = def.photo
    ? null
    : textureStyle(preset.look.texture, (resolved === 'dark' ? def.dark : def.light).luminance);
  const { card, ink } = cardLook(preset, resolved);
  return (
    <span className="ob-look-preview" style={backgroundStyle(preset, resolved)} aria-hidden>
      {pattern && <span className="theme-texture" style={pattern} />}
      <span className="ob-look-card" style={{ ...card, '--theme-ink': ink } as CSSProperties}>
        <span className="ob-look-accent" style={{ background: accentHexFor(preset.look.accent) }} />
        <span className="ob-look-line" />
        <span className="ob-look-line is-short" />
      </span>
    </span>
  );
}

function UniversityStep({
  initial,
  onDone,
  onSkip,
}: {
  initial: string | null;
  onDone: (id: string) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(
    initial && initial !== NOT_IN_UNIVERSITY ? initial : null,
  );
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ONTARIO_UNIVERSITIES;
    return ONTARIO_UNIVERSITIES.filter((u) =>
      [u.name, u.short ?? ''].some((n) => n.toLowerCase().includes(q)),
    );
  }, [query]);

  return (
    <Question
      title="Where do you study?"
      line="You’ll verify this in Settings later"
      onSkip={onSkip}
      onContinue={() => picked && onDone(picked)}
      canContinue={picked !== null}
    >
      <label className="ob-search">
        <Search size={16} aria-hidden />
        <input
          className="input"
          placeholder="Search"
          aria-label="Search universities"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="ob-unis is-fixed" role="radiogroup" aria-label="University">
        {shown.map((u) => (
          <button
            key={u.id}
            type="button"
            role="radio"
            aria-checked={picked === u.id}
            className="ob-uni"
            onClick={() => setPicked(u.id)}
          >
            <span>{u.name}</span>
            {picked === u.id && <Check size={16} aria-hidden />}
          </button>
        ))}
        {shown.length === 0 && <p className="muted ob-none">No match</p>}
      </div>
      <Button className="ob-not-uni" onClick={() => onDone(NOT_IN_UNIVERSITY)}>
        Not in university
      </Button>
    </Question>
  );
}

/** Pick any of a few; `only` is the answer that rules out the rest ("None"). */
function PickStep({
  title,
  options,
  only,
  initial,
  onDone,
  onSkip,
}: {
  title: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  only?: string;
  initial: string[];
  onDone: (ids: string[]) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id)
        ? p.filter((x) => x !== id)
        : id === only
          ? [id]
          : [...p.filter((x) => x !== only), id],
    );

  return (
    <Question
      title={title}
      line="Pick any"
      onSkip={onSkip}
      onContinue={() => onDone(options.map((o) => o.id).filter((id) => picked.includes(id)))}
      canContinue={picked.length > 0}
    >
      <div className="ob-chips">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="ob-chip"
            aria-pressed={picked.includes(o.id)}
            onClick={() => toggle(o.id)}
          >
            {picked.includes(o.id) && <Check size={15} aria-hidden />}
            {o.label}
          </button>
        ))}
      </div>
    </Question>
  );
}

/** How to get each calendar's link. */
const CALENDAR_HELP: Record<
  OnboardingCalendar,
  { open?: { href: string; label: string }; steps: string[] }
> = {
  google: {
    open: {
      href: 'https://calendar.google.com/calendar/r/settings',
      label: 'Open Google Calendar',
    },
    steps: [
      'Pick your calendar on the left',
      'Find “Secret address in iCal format”',
      'Copy it, then paste it here',
    ],
  },
  outlook: {
    steps: [
      'In Outlook on the web, open Settings, then Calendar, then Shared calendars',
      'Under Publish a calendar, pick yours and publish it',
      'Copy the ICS link, then paste it here',
    ],
  },
  icloud: {
    steps: [
      'In the Calendar app, tap Calendars',
      'Tap ⓘ next to your calendar',
      'Turn on Public Calendar and copy its link, then paste it here',
    ],
  },
  school: {
    steps: [
      'Open the calendar in Canvas, Moodle or Quercus',
      'Find “Calendar feed” or “Export calendar”',
      'Copy the link, then paste it here',
    ],
  },
};

function CalendarStep({
  onAnswer,
  onDone,
  onSkip,
}: {
  onAnswer: (patch: OnboardingAnswers) => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [phase, setPhase] = useState<'ask' | 'pick' | 'link' | 'added'>('ask');
  const [from, setFrom] = useState<OnboardingCalendar | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState('');
  const refreshFeeds = useRefreshFeeds();

  const add = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.addCalendarFeed({ url: url.trim(), tasks: true });
      refreshFeeds();
      setAdded(`${r.feed.name} · ${eventsLabel(r.feed.events)}`);
      onAnswer({ calendar: 'added', calendarFrom: from });
      setPhase('added');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t add that calendar.');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'ask')
    return (
      <Question
        title="Bring in your calendar?"
        line="Exams and deadlines turn into tasks"
        onSkip={onSkip}
      >
        <div className="ob-choices">
          <Button variant="primary" onClick={() => setPhase('pick')}>
            Yes
          </Button>
          <Button
            onClick={() => {
              onAnswer({ calendar: 'no' });
              onDone();
            }}
          >
            Not now
          </Button>
        </div>
      </Question>
    );

  if (phase === 'pick')
    return (
      <Question title="Where’s your calendar?" onSkip={onSkip}>
        <div className="ob-unis">
          {ONBOARDING_CALENDARS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="ob-uni"
              onClick={() => {
                setFrom(c.id);
                onAnswer({ calendarFrom: c.id });
                setPhase('link');
              }}
            >
              <span>{c.label}</span>
              <ChevronRight size={16} aria-hidden className="ob-uni-go" />
            </button>
          ))}
        </div>
      </Question>
    );

  if (phase === 'added')
    return (
      <Question title="Calendar added" line={added} onContinue={onDone}>
        <span className="ob-added" aria-hidden>
          <Check size={22} />
        </span>
      </Question>
    );

  const help = CALENDAR_HELP[from ?? 'google'];
  return (
    <Question
      title={ONBOARDING_CALENDARS.find((c) => c.id === from)?.label ?? 'Your calendar'}
      onSkip={onSkip}
      actions={
        <span className="ob-link-actions">
          <Button variant="ghost" onClick={() => setPhase('pick')}>
            <ArrowLeft size={15} aria-hidden /> Back
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!url.trim()}
            onClick={() => void add()}
          >
            Add
          </Button>
        </span>
      }
    >
      {help.open && (
        <a
          className="btn btn-secondary btn-sm ob-open"
          href={help.open.href}
          target="_blank"
          rel="noreferrer"
        >
          {help.open.label}
          <ExternalLink size={14} aria-hidden />
        </a>
      )}
      <ol className="ob-steps">
        {help.steps.map((s, i) => (
          <li key={s}>
            <span className="ob-step-n tabular">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <form
        className="ob-link"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input
          label="Calendar link"
          placeholder="webcal://… or https://….ics"
          value={url}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
        />
        {error && (
          <p className="text-sm" style={{ color: 'var(--status-bad)' }} role="alert">
            {error}
          </p>
        )}
      </form>
    </Question>
  );
}
