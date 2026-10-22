import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { levelProgress, type UserSettings } from '@komogon/core';
import {
  CalendarDays,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Flame,
  GraduationCap,
  House,
  ListChecks,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Repeat,
  Settings as SettingsIcon,
  Trophy,
  UserRound,
  Users,
  WifiOff,
  type LucideIcon,
  Route as RouteIcon,
} from 'lucide-react';
import { Backdrop, Glass, LogoMark, Spinner } from '@komogon/ui';
import { useAppearance } from '../lib/appearance';
import { useCalendarImportRefresh } from '../lib/calendar-import-refresh';
import { FEEDBACK_URL } from '../lib/monitoring';
import { useIsAdmin } from '../lib/admin';
import { useOnlineStatus } from '../lib/local-state';
import { preloadPage, preloadPages } from '../lib/page-loaders';
import { useAvatar, useMe } from '../lib/queries';
import { useExtensionStatus } from '../lib/extension-bridge';
import { useScrollEdges } from '../lib/scroll-edges';
import { useUndoShortcuts } from '../lib/undo';
import { ErrorBoundary } from './ErrorState';
import { SignOutButton } from './SignOutButton';

/**
 * Every page in the nav, in order. `group` splits the sidebar: 'main' pages on top, 'more'
 * under a divider, where new features go. `short` is the phone label; `feature` names the
 * setting that can take a page out of the nav.
 */
const links: Array<{
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
  group: 'main' | 'more';
  feature?: keyof UserSettings['features'];
}> = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: House, group: 'main' },
  { to: '/tasks', label: 'Tasks', short: 'Tasks', icon: ListChecks, group: 'main' },
  {
    to: '/calendar',
    label: 'Calendar',
    short: 'Calendar',
    icon: CalendarDays,
    group: 'main',
    feature: 'calendar',
  },
  { to: '/analytics', label: 'Analytics', short: 'Stats', icon: ChartColumn, group: 'main' },
  {
    to: '/social',
    label: 'Social',
    short: 'Social',
    icon: Users,
    group: 'main',
    feature: 'social',
  },
  {
    to: '/routines',
    label: 'Routines',
    short: 'Routines',
    icon: Repeat,
    group: 'more',
    feature: 'routines',
  },
  {
    to: '/plans',
    label: 'Plans',
    short: 'Plans',
    icon: RouteIcon,
    group: 'more',
    feature: 'plans',
  },
  {
    to: '/grades',
    label: 'Grades',
    short: 'Grades',
    icon: GraduationCap,
    group: 'more',
    feature: 'grades',
  },
];

const PIN_KEY = 'komogon.rail.pinned';

/** True when `path` is the page `to` or somewhere under it; the dashboard only matches itself. */
function isUnder(path: string, to: string): boolean {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
}

/**
 * Where the nav says you are. A navigation is a React transition, so the location only
 * moves once the next page has rendered; until then a tapped tab would sit there as if the
 * tap had missed. The tap is shown at once instead: `go` records it, and it holds until the
 * location moves.
 */
function useNavTarget(): { target: string; go: (to: string, event: React.MouseEvent) => void } {
  const { pathname } = useLocation();
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const go = useCallback(
    (to: string, event: React.MouseEvent) => {
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (event.button !== 0 || modified) return;
      setPending({ from: pathname, to });
    },
    [pathname],
  );
  const target = pending && pending.from === pathname ? pending.to : pathname;
  return { target, go };
}

/** Whether the sidebar is pinned open, remembered in this browser only. */
function usePinnedRail(): [boolean, (v: boolean) => void] {
  const [pinned, set] = useState(() => {
    try {
      return localStorage.getItem(PIN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const update = (v: boolean) => {
    set(v);
    try {
      if (v) localStorage.setItem(PIN_KEY, '1');
      else localStorage.removeItem(PIN_KEY);
    } catch {
      // Storage blocked: it stays as chosen until the page reloads.
    }
  };
  return [pinned, update];
}

/**
 * The level, with a short bar that fills toward the next one. It is also the way into
 * Achievements, which is visited now and then rather than daily, so it has no tab:
 * the trophy and the pill shape say it can be opened, the same way the streak beside it does.
 */
function LevelPill({ xp, level }: { xp: number; level: number }) {
  const { ratio, toNext } = levelProgress(xp);
  return (
    <span className="nav-level-wrap">
      <NavLink to="/achievements" className="nav-level">
        <Trophy size={15} aria-hidden className="nav-level-icon" />
        <span className="tabular">Level {level}</span>
        <span className="nav-level-bar" aria-hidden>
          <span style={{ width: `${Math.round(ratio * 100)}%` }} />
        </span>
        <span className="sr-only">, open achievements</span>
      </NavLink>
      {/* On hover, a small card says where the pill goes. Touch screens just follow the tap. */}
      <span className="nav-level-drop" aria-hidden>
        <span className="nav-level-drop-card">
          <span className="nav-level-drop-line tabular">
            {toNext} XP to level {level + 1}
          </span>
          <Link to="/achievements" className="nav-level-drop-link" tabIndex={-1}>
            Go to achievements
            <ChevronRight size={14} aria-hidden />
          </Link>
        </span>
      </span>
    </span>
  );
}

/** One row of the sidebar: the icon always, the label once it opens. */
function RailLink({
  to,
  label,
  icon: Icon,
  active,
  onGo,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onGo: (to: string, event: React.MouseEvent) => void;
}) {
  return (
    <Link
      to={to}
      className="sidenav-link"
      title={label}
      aria-current={active ? 'page' : undefined}
      onPointerDown={() => preloadPage(to)}
      onClick={(e) => onGo(to, e)}
    >
      <span className="sidenav-icon" aria-hidden>
        <Icon size={19} strokeWidth={1.9} />
      </span>
      <span className="sidenav-label">{label}</span>
    </Link>
  );
}

/** A page whose code is still loading: nothing for a moment, so a quick load never flashes a spinner. */
function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-label="Loading">
      <Spinner />
    </div>
  );
}

/** The ring's circumference: r = 15 in a 34 box. */
const RING = 2 * Math.PI * 15;

/**
 * Streak and level at the foot of the sidebar, as numbers rather than sentences. Slim,
 * they stack as icons: the flame carries the day count, and a ring around the trophy fills
 * toward the next level, so a full circle is a finished level. Open, they sit side by side
 * as two small stats.
 */
function RailStats({
  streak,
  weeks,
  level,
  ratio,
  toNext,
}: {
  streak: number;
  weeks: number;
  level: number;
  ratio: number;
  toNext: number;
}) {
  const streaks = `${streak} ${streak === 1 ? 'day' : 'days'} in a row, ${weeks} ${weeks === 1 ? 'week' : 'weeks'} in a row`;
  const lvl = `Level ${level}, ${toNext} XP to level ${level + 1}`;

  // Open, the two pills share the row, each with the same padding on every side, so the
  // content sits centred in both. That depends on how wide each count is, so it is measured:
  // the streak pill's width and a nudge for each pill's content go on the row as variables.
  const rowRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fit = () => {
      const pills = Array.from(row.children) as HTMLElement[];
      const rail = row.closest<HTMLElement>('.sidenav');
      if (pills.length !== 2 || !rail) return;
      const railStyle = getComputedStyle(rail);
      const open = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--rail-open'),
      );
      const width = open - parseFloat(railStyle.paddingLeft) - parseFloat(railStyle.paddingRight);
      const between = 2;
      // From the icon's visible left edge to the end of the unit, as laid out unnudged.
      const parts = pills.map((pill) => {
        const cell = pill.querySelector<HTMLElement>('.sidenav-icon');
        const icon = cell?.querySelector('svg');
        const text = pill.querySelector<HTMLElement>('.sidenav-stat-text');
        const value = pill.querySelector('.sidenav-stat-value');
        const unit = pill.querySelector('.sidenav-stat-unit');
        if (!cell || !icon || !text || !value || !unit) return null;
        const inset = (cell.offsetWidth - icon.getBoundingClientRect().width) / 2;
        const style = getComputedStyle(text);
        const words =
          value.getBoundingClientRect().width +
          (parseFloat(style.columnGap) || 0) +
          unit.getBoundingClientRect().width;
        return { inset, content: cell.offsetWidth - inset + parseFloat(style.marginLeft) + words };
      });
      const [a, b] = parts;
      if (!a || !b) return;
      const pad = Math.max(4, (width - between - a.content - b.content) / 4);
      row.style.setProperty('--stat-streak', `${a.content + 2 * pad}px`);
      row.style.setProperty('--stat-shift-a', `${pad - a.inset}px`);
      row.style.setProperty('--stat-shift-b', `${pad - b.inset}px`);
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, [streak, level]);

  return (
    <div ref={rowRef} className="sidenav-stats">
      <NavLink to="/analytics" className="sidenav-stat" title={streaks} aria-label={streaks}>
        <span className="sidenav-icon" aria-hidden>
          <Flame size={19} strokeWidth={1.9} />
          {streak > 0 && (
            <span className="sidenav-badge sidenav-badge-flame tabular">{streak}</span>
          )}
        </span>
        <span className="sidenav-stat-text" aria-hidden>
          <span className="sidenav-stat-value tabular">{streak}</span>
          <span className="sidenav-stat-unit">{streak === 1 ? 'day' : 'days'}</span>
        </span>
      </NavLink>
      <NavLink to="/achievements" className="sidenav-stat" title={lvl} aria-label={lvl}>
        <span className="sidenav-icon" aria-hidden>
          <svg className="sidenav-ring" viewBox="0 0 34 34" width="34" height="34">
            <circle cx="17" cy="17" r="15" className="sidenav-ring-track" />
            <circle
              cx="17"
              cy="17"
              r="15"
              className="sidenav-ring-fill"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - Math.min(1, Math.max(0, ratio)))}
            />
          </svg>
          <Trophy size={16} strokeWidth={1.9} />
        </span>
        <span className="sidenav-stat-text" aria-hidden>
          <span className="sidenav-stat-value tabular">{level}</span>
          <span className="sidenav-stat-unit">level</span>
        </span>
      </NavLink>
    </div>
  );
}

export function AppShell() {
  useCalendarImportRefresh();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const settings = me.data?.user.settings;
  const online = useOnlineStatus();
  // Hands the session to the Chrome extension whenever the shell mounts.
  useExtensionStatus();
  // Ctrl+Z and Ctrl+Y for the small reversible things, anywhere in the app.
  useUndoShortcuts();
  // Theme, accent, motion and backdrop: the same hook the focus screen uses.
  const appearance = useAppearance(settings);
  const shown = links.filter((l) => !l.feature || settings?.features?.[l.feature] !== false);
  // The profile is not a tab: it sits where Sign out used to, at the end of the nav, shown
  // as the person's picture once they have chosen one.
  const profileShown = settings?.features?.social !== false;
  // Sign out sits in the nav when there is no profile to hold it, and always for a dev
  // account, which gets swapped for another often.
  const signOutShown = !profileShown || me.data?.user.devAccount === true;
  const avatarUrl = useAvatar().data?.dataUrl ?? null;
  const main = shown.filter((l) => l.group === 'main');
  const more = shown.filter((l) => l.group === 'more');
  const sidebar = settings?.nav?.style === 'sidebar';
  const [pinned, setPinned] = usePinnedRail();
  // After Collapse is clicked the pointer is still over the sidebar, which would hold it
  // open over the page that has just moved under it. It rests shut until the pointer leaves.
  const [resting, setResting] = useState(false);
  const togglePinned = (event: React.MouseEvent<HTMLButtonElement>) => {
    setPinned(!pinned);
    // Only when the pointer is on the sidebar: collapsed from the keyboard, it would never
    // leave, and hover would stay off until it had gone in and out once.
    if (pinned && event.currentTarget.closest('.sidenav')?.matches(':hover')) setResting(true);
  };
  const location = useLocation();
  const { target, go } = useNavTarget();

  // Warm up the nav's pages once things are quiet, so a tap rarely waits for a download.
  const shownKey = shown.map((l) => l.to).join(' ');
  useEffect(() => preloadPages([...shownKey.split(' '), '/settings', '/profile']), [shownKey]);

  // The page's left margin follows the sidebar, so the layout reads it from the root.
  useEffect(() => {
    const root = document.documentElement;
    if (sidebar) root.dataset.nav = pinned ? 'sidebar-pinned' : 'sidebar';
    else delete root.dataset.nav;
    return () => {
      delete root.dataset.nav;
    };
  }, [sidebar, pinned]);

  // The active pill is one element that slides and resizes between links, so a tab
  // change reads as movement rather than a jump.
  const navRef = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, animate: false });

  const placeIndicator = useCallback((target: HTMLElement) => {
    const left = target.offsetLeft;
    const width = target.offsetWidth;
    setIndicator((prev) =>
      prev.left === left && prev.width === width
        ? prev
        : // Never animate the very first placement, or it would fly in from the edge.
          { left, width, animate: prev.width > 0 },
    );
  }, []);

  const measureIndicator = useCallback(() => {
    const active = navRef.current?.querySelector<HTMLElement>('.nav-link[aria-current="page"]');
    if (!active) {
      // No primary tab is active (Settings, say): fade the pill out where it stands.
      setIndicator((prev) => (prev.width === 0 ? prev : { ...prev, width: 0, animate: true }));
      return;
    }
    placeIndicator(active);
  }, [placeIndicator]);

  // Move on the click itself: waiting for the route to commit would stall the slide
  // behind however long the next page takes to render.
  const onNavClick = useCallback(
    (to: string, event: React.MouseEvent<HTMLAnchorElement>) => {
      go(to, event);
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (event.button !== 0 || modified) return;
      placeIndicator(event.currentTarget);
    },
    [go, placeIndicator],
  );

  // When the bar is too narrow for every tab, the tabs scroll sideways, with an arrow on
  // each side that hides one.
  const {
    edges: overflow,
    measure: measureOverflow,
    scrollByPage: scrollTabs,
  } = useScrollEdges(navRef);

  // Narrower still, the top bar is too small for a scrolling row to be any use: under
  // 480px of room, with tabs that do not fit, the pages move to the bottom bar, as on a
  // phone. The width the tabs need is remembered from the last time they showed, so the
  // bar knows when there is room for them again.
  const [crowded, setCrowded] = useState(false);
  const neededWidth = useRef(0);
  const measureCrowd = useCallback(() => {
    const nav = navRef.current;
    const scroller = nav?.parentElement;
    const inner = scroller?.parentElement;
    if (!nav || !scroller || !inner || sidebar) {
      setCrowded(false);
      return;
    }
    if (scroller.offsetParent !== null) neededWidth.current = nav.scrollWidth;
    const style = getComputedStyle(inner);
    const gap = parseFloat(style.columnGap) || 0;
    let room = inner.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    for (const child of Array.from(inner.children)) {
      if (child === scroller) continue;
      // The spacer grows to fill the bar once the tabs are hidden, so its width is room the
      // tabs would have, not a control. Counting it kept the bottom bar on for good.
      const width = child.classList.contains('nav-spacer')
        ? 0
        : child.getBoundingClientRect().width;
      room -= width + gap;
    }
    room -= parseFloat(getComputedStyle(scroller).marginLeft) || 0;
    setCrowded(neededWidth.current > room + 1 && room < 480);
  }, [sidebar]);

  // The bottom bar shows on phones, and on a computer whose top bar is crowded.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const phone = window.matchMedia('(max-width: 767px)');
    const apply = () => {
      if (phone.matches || crowded) root.dataset.tabbar = '1';
      else delete root.dataset.tabbar;
    };
    apply();
    phone.addEventListener('change', apply);
    return () => {
      phone.removeEventListener('change', apply);
      delete root.dataset.tabbar;
    };
  }, [crowded]);

  // The current tab should never sit scrolled out of sight: not on arrival, and not when
  // the counters beside the tabs appear and take some of the room.
  const revealActive = useCallback(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('.nav-link[aria-current="page"]');
    if (!nav || !active) return;
    const start = active.offsetLeft;
    const end = start + active.offsetWidth;
    if (start < nav.scrollLeft) nav.scrollLeft = start - 32;
    else if (end > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = end - nav.clientWidth + 32;
  }, []);

  useLayoutEffect(() => {
    measureCrowd();
    measureIndicator();
    revealActive();
    measureOverflow();
  }, [
    measureCrowd,
    measureIndicator,
    revealActive,
    measureOverflow,
    location.pathname,
    shown.length,
  ]);

  // The bars firm up as the page scrolls under them, so text passing behind stays legible;
  // at the top they keep their usual glass. 0 at the top, 1 after the first 80px. Written on
  // the bars themselves: on the root, every scrolled frame restyled the whole page.
  const headerRef = useRef<HTMLElement | null>(null);
  const tabbarRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let last = '';
    // Scroll events already arrive once per frame, so this writes straight through.
    const update = () => {
      const fade = String(Math.round(Math.min(1, window.scrollY / 80) * 100) / 100);
      if (fade === last) return;
      last = fade;
      headerRef.current?.style.setProperty('--scroll-fade', fade);
      tabbarRef.current?.style.setProperty('--scroll-fade', fade);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // Window resizes, the nav's own reflow, and late web fonts all move the links.
    const onChange = () => {
      measureCrowd();
      measureIndicator();
      revealActive();
    };
    const ro = new ResizeObserver(onChange);
    ro.observe(nav);
    if (nav.parentElement) ro.observe(nav.parentElement);
    // The bar itself and the controls beside the tabs decide how much room they have.
    if (nav.parentElement?.parentElement) {
      for (const sibling of Array.from(nav.parentElement.parentElement.children))
        ro.observe(sibling);
    }
    for (const child of Array.from(nav.children)) ro.observe(child);
    window.addEventListener('resize', onChange);
    void document.fonts?.ready.then(onChange);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onChange);
    };
  }, [measureCrowd, measureIndicator, revealActive]);

  const user = me.data?.user;
  const lp = user ? levelProgress(user.xp) : null;

  return (
    <>
      <Backdrop
        backgroundId={appearance.backgroundId}
        theme={appearance.theme}
        customImageUrl={appearance.customImageUrl}
      />
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Chosen in Settings › Appearance: a slim sidebar that opens to show labels, or stays open. */}
      {sidebar && (
        <aside
          className={`sidenav chrome${pinned ? ' is-pinned' : ''}${resting ? ' is-resting' : ''}`}
          aria-label="Primary"
          onMouseLeave={() => setResting(false)}
        >
          <NavLink to="/" className="sidenav-brand" aria-label="Komodon home" title="Komodon">
            <span className="sidenav-icon" aria-hidden>
              <LogoMark size={22} />
            </span>
            <span className="sidenav-label sidenav-wordmark">Komodon</span>
          </NavLink>
          <nav className="sidenav-group">
            {main.map((l) => (
              <RailLink
                key={l.to}
                to={l.to}
                label={l.label}
                icon={l.icon}
                active={isUnder(target, l.to)}
                onGo={go}
              />
            ))}
          </nav>
          {more.length > 0 && (
            <>
              <div className="sidenav-divider" aria-hidden />
              <nav className="sidenav-group" aria-label="More pages">
                {more.map((l) => (
                  <RailLink
                    key={l.to}
                    to={l.to}
                    label={l.label}
                    icon={l.icon}
                    active={isUnder(target, l.to)}
                    onGo={go}
                  />
                ))}
              </nav>
            </>
          )}
          <div className="flex-1" />
          <div className="sidenav-group">
            {user && (
              <RailStats
                streak={user.streak.current}
                weeks={user.streak.weeks?.current ?? 0}
                level={user.level}
                ratio={lp?.ratio ?? 0}
                toNext={lp?.toNext ?? 0}
              />
            )}
            {isAdmin && (
              <RailLink
                to="/admin"
                label="Admin"
                icon={ShieldCheck}
                active={isUnder(target, '/admin')}
                onGo={go}
              />
            )}
            {FEEDBACK_URL && (
              <a
                href={FEEDBACK_URL}
                target="_blank"
                rel="noreferrer"
                className="sidenav-link"
                title="Send feedback"
              >
                <span className="sidenav-icon" aria-hidden>
                  <MessageSquareText size={19} strokeWidth={1.9} />
                </span>
                <span className="sidenav-label">Send feedback</span>
              </a>
            )}
            <RailLink
              to="/settings"
              label="Settings"
              icon={SettingsIcon}
              active={isUnder(target, '/settings')}
              onGo={go}
            />
            {/*
              Your profile takes the sign-out row; signing out is on the profile itself. With
              Social off there is no profile, so Sign out is back (and always for a dev account).
            */}
            {signOutShown && <SignOutButton rail />}
            {profileShown && (
              <NavLink to="/profile" className="sidenav-link" title="Your profile">
                <span className="sidenav-icon" aria-hidden>
                  {avatarUrl ? (
                    <img className="nav-avatar" src={avatarUrl} alt="" />
                  ) : (
                    <UserRound size={19} strokeWidth={1.9} />
                  )}
                </span>
                <span className="sidenav-label">Your profile</span>
              </NavLink>
            )}
            <button
              type="button"
              className="sidenav-link"
              onClick={togglePinned}
              aria-pressed={pinned}
              aria-label={pinned ? 'Collapse the sidebar' : 'Keep the sidebar open'}
              title={pinned ? 'Collapse the sidebar' : 'Keep the sidebar open'}
            >
              <span className="sidenav-icon" aria-hidden>
                {pinned ? (
                  <PanelLeftClose size={19} strokeWidth={1.9} />
                ) : (
                  <PanelLeftOpen size={19} strokeWidth={1.9} />
                )}
              </span>
              {/* Unpinned it is just the icon; pinned, it says what it does. */}
              {pinned && (
                <span className="sidenav-label" aria-hidden>
                  Collapse
                </span>
              )}
            </button>
          </div>
        </aside>
      )}

      <header ref={headerRef} className="nav chrome">
        <div className="nav-inner">
          <NavLink to="/" className="brand" aria-label="Komodon home">
            <span className="brand-logo" aria-hidden>
              <LogoMark size={22} />
            </span>
            <span>Komodon</span>
          </NavLink>
          <div
            className={`nav-scroll scroll-edges ml-2${overflow.left ? ' can-left' : ''}${
              overflow.right ? ' can-right' : ''
            }`}
          >
            {overflow.left && (
              <button
                type="button"
                className="scroll-arrow scroll-arrow-left"
                tabIndex={-1}
                aria-hidden
                title="More tabs"
                onClick={() => scrollTabs(-1)}
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
            )}
            <nav
              ref={navRef}
              className="nav-primary scroll-edges-track flex items-center gap-1"
              aria-label="Primary"
            >
              <span
                className={`nav-indicator${indicator.animate ? ' is-animated' : ''}`}
                style={{
                  opacity: indicator.width ? 1 : 0,
                  width: `${indicator.width}px`,
                  transform: `translate3d(${indicator.left}px, 0, 0)`,
                }}
                aria-hidden
              />
              {shown.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  className="nav-link"
                  aria-current={isUnder(target, l.to) ? 'page' : undefined}
                  onPointerDown={() => preloadPage(l.to)}
                  onClick={(e) => onNavClick(l.to, e)}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            {overflow.right && (
              <button
                type="button"
                className="scroll-arrow scroll-arrow-right"
                tabIndex={-1}
                aria-hidden
                title="More tabs"
                onClick={() => scrollTabs(1)}
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            )}
          </div>
          {/* With the tabs gone to the bottom bar, the counters and controls keep right. */}
          <div className="nav-spacer" aria-hidden />
          {user && (
            <div className="nav-stats">
              <NavLink
                to="/analytics"
                className="nav-streak"
                title={`Daily streak ${user.streak.current}, weekly streak ${user.streak.weeks?.current ?? 0}`}
              >
                <Flame size={15} aria-hidden className="nav-streak-flame" />
                <span className="tabular">{user.streak.current}</span>
                <span className="sr-only">
                  day streak, {user.streak.weeks?.current ?? 0} week streak
                </span>
              </NavLink>
              <LevelPill xp={user.xp} level={user.level} />
            </div>
          )}
          {isAdmin && (
            <NavLink to="/admin" className="nav-icon" aria-label="Admin" title="Admin">
              <ShieldCheck size={18} aria-hidden />
            </NavLink>
          )}
          {FEEDBACK_URL && (
            <a
              href={FEEDBACK_URL}
              target="_blank"
              rel="noreferrer"
              className="nav-icon"
              aria-label="Send feedback"
              title="Send feedback"
            >
              <MessageSquareText size={18} aria-hidden />
            </a>
          )}
          <NavLink to="/settings" className="nav-icon" aria-label="Settings" title="Settings">
            <SettingsIcon size={18} aria-hidden />
          </NavLink>
          {signOutShown && <SignOutButton />}
          {profileShown && (
            <NavLink
              to="/profile"
              className="nav-icon"
              aria-label="Your profile"
              title="Your profile"
            >
              {avatarUrl ? (
                <img className="nav-avatar" src={avatarUrl} alt="" />
              ) : (
                <UserRound size={18} aria-hidden />
              )}
            </NavLink>
          )}
        </div>
      </header>

      {/* Phones, and a crowded top bar: every page as an icon, and the one you are on widens
          to show its name. The tap moves the highlight straight away; the page follows. */}
      <nav ref={tabbarRef} className="tabbar chrome" aria-label="Primary">
        {shown.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="tabbar-link"
            aria-label={l.label}
            aria-current={isUnder(target, l.to) ? 'page' : undefined}
            onPointerDown={() => preloadPage(l.to)}
            onClick={(e) => go(l.to, e)}
          >
            <span className="tabbar-icon" aria-hidden>
              <l.icon size={21} strokeWidth={1.9} />
            </span>
            <span className="tabbar-label" aria-hidden>
              <span>{l.short}</span>
            </span>
          </Link>
        ))}
      </nav>

      <main id="main" className="page on-backdrop" tabIndex={-1}>
        {!online && (
          <Glass className="offline-bar" role="status">
            <WifiOff size={16} aria-hidden />
            <span>You're currently offline. Stats will update when you reconnect.</span>
          </Glass>
        )}
        <ErrorBoundary>
          {/* Keyed by route so each page rises in as it arrives. A page whose code is still
              on its way shows a quiet spinner here, inside the shell, rather than holding the
              old page on screen. */}
          <div key={location.pathname} className="route-in">
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </div>
        </ErrorBoundary>
      </main>
    </>
  );
}
