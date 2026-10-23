import { Button, Modal } from '@komogon/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { isPhone } from '../../lib/device';
import { useMe } from '../../lib/queries';
import { saveAnswers, setTour, useTour } from '../../lib/tour';
import { GetStartedOptions } from '../GetStarted';
import { SectionProgress } from './SectionProgress';
import './onboarding.css';

/** The look around: one stop a page, each pointing at the page's place in the nav. */
const STOPS: Array<{ to: string; title: string; line: string; feature?: 'social' }> = [
  { to: '/tasks', title: 'Tasks', line: 'Everything you’ve got due, in one place' },
  { to: '/analytics', title: 'Analytics', line: 'How your weeks are going' },
  { to: '/social', title: 'Social', line: 'Study with friends', feature: 'social' },
  { to: '/settings', title: 'Settings', line: 'Make it yours' },
];

/**
 * The first-time setup once the questions are done, over the app itself: the look around,
 * then the timelapse in Settings, then "All done". Mounted in the shell; shows nothing
 * unless a setup is running (`lib/tour.ts`).
 */
export function Tour() {
  const tour = useTour();
  if (!tour) return null;
  if (tour.stage === 'tour') return <LookAround stop={tour.stop} />;
  if (tour.stage === 'timelapse') return <TimelapseBar />;
  return <AllDone />;
}

/**
 * Where to look for a page's link, best first: the sidebar's rows, the top bar's tabs, the
 * bottom bar, a phone's pills at the page top, then anything else in the bars. The streak
 * and level pills link to pages too, so they come last.
 */
const NAV_PLACES = [
  '.sidenav-link',
  '.nav-link',
  '.tabbar-link',
  '.phone-switch a',
  'header a',
  'nav a',
];

/** The nav link to a page that is on screen. */
function anchorFor(to: string): DOMRect | null {
  for (const place of NAV_PLACES) {
    for (const el of document.querySelectorAll<HTMLElement>(`${place}[href="${to}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) return r;
    }
  }
  return null;
}

function sameRect(a: DOMRect | null, b: DOMRect | null) {
  if (!a || !b) return a === b;
  return (
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}

/** Follows where a page's nav link is, frame by frame (the sidebar and bars move). */
function useAnchor(to: string): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    let frame = 0;
    let last: DOMRect | null = null;
    const look = () => {
      const r = anchorFor(to);
      if (!sameRect(r, last)) {
        last = r;
        setRect(r);
      }
      frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return rect;
}

const GAP = 14;
const EDGE = 12;

/** Beside the link in a sidebar, under it in a top bar, above it in a phone's bottom bar. */
function place(rect: DOMRect | null, w: number, h: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), vw - w - EDGE);
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), vh - h - EDGE);
  if (!rect) return { left: clampX((vw - w) / 2), top: clampY(vh - h - 96) };
  if (rect.left < vw / 3 && rect.right + GAP + w + EDGE <= vw && rect.height < vh / 2)
    return { left: rect.right + GAP, top: clampY(rect.top + rect.height / 2 - h / 2) };
  const x = clampX(rect.left + rect.width / 2 - w / 2);
  if (rect.top < vh / 2) return { left: x, top: clampY(rect.bottom + GAP) };
  return { left: x, top: clampY(rect.top - GAP - h) };
}

function LookAround({ stop }: { stop: number }) {
  const me = useMe();
  const userId = me.data?.user.id ?? '';
  const features = me.data?.user.settings.features;
  const stops = STOPS.filter((s) => !s.feature || features?.[s.feature] !== false);
  const index = Math.min(stop, stops.length - 1);
  const here = stops[index]!;
  const location = useLocation();
  const navigate = useNavigate();
  const rect = useAnchor(here.to);
  const popRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 160 });

  useEffect(() => {
    if (location.pathname !== here.to) navigate(here.to);
  }, [here.to, location.pathname, navigate]);

  useLayoutEffect(() => {
    const el = popRef.current;
    if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [index]);

  useEffect(() => {
    popRef.current?.querySelector<HTMLButtonElement>('.tour-next')?.focus({ preventScroll: true });
  }, [index]);

  const go = (to: number) => {
    if (to < 0) return;
    if (to >= stops.length) {
      saveAnswers({ sections: { tour: 'done' } });
      setTour(userId, { stage: 'timelapse' });
    } else setTour(userId, { stage: 'tour', stop: to });
  };
  const skip = () => {
    saveAnswers({ sections: { tour: 'skipped' } });
    setTour(userId, { stage: 'timelapse' });
  };

  const pos = place(rect, size.w, size.h);
  const pad = 6;

  return createPortal(
    <div
      className="tour"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(index + 1);
        if (e.key === 'ArrowLeft') go(index - 1);
      }}
    >
      {rect ? (
        <div
          className="tour-spot"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      ) : (
        <div className="tour-shade" />
      )}
      <div
        ref={popRef}
        className="tour-pop glass glass-strong"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        style={{ left: pos.left, top: pos.top }}
      >
        <SectionProgress section={1} progress={(index + 1) / stops.length} />
        <div key={index} className="tour-pop-body">
          <h2 id="tour-title" className="tour-title">
            {here.title}
          </h2>
          <p className="muted">{here.line}</p>
        </div>
        <div className="tour-actions">
          <button type="button" className="link-button tour-skip" onClick={skip}>
            Skip section
          </button>
          <span className="tour-count muted tabular">
            {index + 1} of {stops.length}
          </span>
          {index > 0 && (
            <Button variant="ghost" size="sm" onClick={() => go(index - 1)}>
              Back
            </Button>
          )}
          <Button variant="primary" size="sm" className="tour-next" onClick={() => go(index + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** What to do in Settings › Timelapse, in the order the page has it. */
const TIMELAPSE_STEPS = [
  'Pick when it records',
  'Start from a look',
  'Drag things around the preview',
  'Save under it',
];

/** The device whose timelapse preset the setup opens. */
function presetHash() {
  return `#timelapse-${isPhone() ? 'phone' : 'computer'}`;
}

/**
 * The timelapse part: first a card saying what a timelapse is, over Settings › Timelapse with
 * this device's preset open; then a small bar with the steps and a way to skip. The editor's
 * own Save (`TimelapseTourSave`) finishes it. (The owner, trying it: "I was even confused
 * here", landing on the settings with no word on what a timelapse is.)
 */
function TimelapseBar() {
  const userId = useMe().data?.user.id ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const there = location.pathname === '/settings';
  const [intro, setIntro] = useState(true);
  const introRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (intro) introRef.current?.querySelector<HTMLButtonElement>('.tour-next')?.focus();
  }, [intro]);

  const open = () => {
    navigate({ pathname: '/settings', hash: presetHash() });
    // Already on Settings, the page doesn't remount; tell it the hash moved.
    window.setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 50);
  };
  useEffect(() => {
    open();
    // Once, on arrival; afterwards the person can wander.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.touring = 'timelapse';
    return () => {
      delete document.documentElement.dataset.touring;
    };
  }, []);

  const skip = () => {
    saveAnswers({ sections: { timelapse: 'skipped' } });
    setTour(userId, { stage: 'finish' });
  };

  if (intro)
    return createPortal(
      <div className="tour">
        <div className="tour-shade" />
        <div
          ref={introRef}
          className="tour-pop tour-intro glass glass-strong"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
        >
          <SectionProgress section={2} progress={0.2} />
          <div className="tour-pop-body">
            <h2 id="tour-title" className="tour-title">
              Your timelapse
            </h2>
            <p className="muted">
              While you focus, Komodon can film you and speed it up into a short video to keep or
              share
            </p>
            <p className="muted">Set up how it looks here</p>
          </div>
          <div className="tour-actions">
            <button type="button" className="link-button tour-skip" onClick={skip}>
              Skip section
            </button>
            <Button
              variant="primary"
              size="sm"
              className="tour-next"
              onClick={() => {
                setIntro(false);
                open();
                // The steps start at the top of the section ("When a session starts"), above
                // the preset the hash scrolls to.
                window.setTimeout(
                  () =>
                    document
                      .getElementById('timelapse')
                      ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                  150,
                );
              }}
            >
              Set it up
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return createPortal(
    <div className="tour-bar glass glass-strong" role="region" aria-label="Timelapse setup">
      <SectionProgress section={2} progress={0.5} />
      <div className="tour-bar-row">
        <span className="tour-title">Your timelapse</span>
        {there ? (
          <button type="button" className="link-button tour-skip" onClick={skip}>
            Skip section
          </button>
        ) : (
          <Button size="sm" onClick={open}>
            Back to it
          </Button>
        )}
      </div>
      <ol className="tour-bar-steps">
        {TIMELAPSE_STEPS.map((s, i) => (
          <li key={s}>
            <span className="ob-step-n tabular">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </div>,
    document.body,
  );
}

function AllDone() {
  const userId = useMe().data?.user.id ?? '';
  const navigate = useNavigate();
  const answers = useQuery({ queryKey: ['onboarding'], queryFn: api.onboarding });
  const [phase, setPhase] = useState<'done' | 'tasks'>('done');
  const [inDialog, setInDialog] = useState(false);

  const end = (to: string | null = '/') => {
    setTour(userId, null);
    if (to) navigate(to);
  };
  const allGood = () => {
    saveAnswers({ addTasks: false });
    end();
  };

  if (phase === 'tasks')
    return (
      <Modal
        open={!inDialog}
        onClose={() => end()}
        title="Add your first tasks"
        className="tour-done"
        actions={
          <Button variant="ghost" onClick={() => end()}>
            Later
          </Button>
        }
      >
        <GetStartedOptions
          calendarAdded={answers.data?.answers.calendar === 'added'}
          onDialog={setInDialog}
          onAdded={() => end()}
          onManual={() => end(null)}
        />
      </Modal>
    );

  return (
    <Modal
      open
      onClose={allGood}
      className="tour-done"
      actions={
        <>
          <Button variant="ghost" onClick={allGood}>
            I’m all good
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              saveAnswers({ addTasks: true });
              setPhase('tasks');
            }}
          >
            Add your first tasks
          </Button>
        </>
      }
    >
      <div className="tour-done-head">
        <h2 className="tour-done-title">All done</h2>
        <p className="muted">Thanks for setting up and choosing Komodon</p>
      </div>
    </Modal>
  );
}
