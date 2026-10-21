import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { levelProgress, type UserSettings } from '@komogon/core';
import {
  CalendarDays,
  ChartColumn,
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
  WifiOff,
  Users,
  type LucideIcon,
  Route as RouteIcon,
} from 'lucide-react';
import { Backdrop, Glass, LogoMark } from '@komogon/ui';
import { useAppearance } from '../lib/appearance';
import { useCalendarImportRefresh } from '../lib/calendar-import-refresh';
import { FEEDBACK_URL } from '../lib/monitoring';
import { useIsAdmin } from '../lib/admin';
import { useOnlineStatus } from '../lib/local-state';
import { useMe } from '../lib/queries';
import { useExtensionStatus } from '../lib/extension-bridge';
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
  { to: '/social', label: 'Social', short: 'Social', icon: Users, group: 'main' },
  { to: '/analytics', label: 'Analytics', short: 'Stats', icon: ChartColumn, group: 'main' },
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
  end,
  children,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <NavLink to={to} end={end} className="sidenav-link" title={label}>
      <span className="sidenav-icon" aria-hidden>
        <Icon size={19} strokeWidth={1.9} />
      </span>
      <span className="sidenav-label">{label}</span>
      {children}
    </NavLink>
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
  level,
  ratio,
  toNext,
}: {
  streak: number;
  level: number;
  ratio: number;
  toNext: number;
}) {
  const days = `${streak} ${streak === 1 ? 'day' : 'days'} in a row`;
  const lvl = `Level ${level}, ${toNext} XP to level ${level + 1}`;
  return (
    <div className="sidenav-stats">
      <NavLink to="/analytics" className="sidenav-stat" title={days} aria-label={days}>
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
          <Trophy size={15} strokeWidth={1.9} />
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
  const main = shown.filter((l) => l.group === 'main');
  const more = shown.filter((l) => l.group === 'more');
  const sidebar = settings?.nav?.style === 'sidebar';
  const [pinned, setPinned] = usePinnedRail();
  const location = useLocation();

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
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (event.button !== 0 || modified) return;
      placeIndicator(event.currentTarget);
    },
    [placeIndicator],
  );

  useLayoutEffect(() => {
    measureIndicator();
  }, [measureIndicator, location.pathname, shown.length]);

  // The bars firm up as the page scrolls under them, so text passing behind stays legible;
  // at the top they keep their usual glass. 0 at the top, 1 after the first 80px.
  useEffect(() => {
    const root = document.documentElement;
    // Scroll events already arrive once per frame, so this writes straight through.
    const update = () =>
      root.style.setProperty('--scroll-fade', String(Math.min(1, window.scrollY / 80)));
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      root.style.removeProperty('--scroll-fade');
    };
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // Window resizes, the nav's own reflow, and late web fonts all move the links.
    const onChange = () => measureIndicator();
    const ro = new ResizeObserver(onChange);
    ro.observe(nav);
    if (nav.parentElement) ro.observe(nav.parentElement);
    for (const child of Array.from(nav.children)) ro.observe(child);
    window.addEventListener('resize', onChange);
    void document.fonts?.ready.then(onChange);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onChange);
    };
  }, [measureIndicator]);

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
        <aside className={`sidenav chrome${pinned ? ' is-pinned' : ''}`} aria-label="Primary">
          <NavLink to="/" className="sidenav-brand" aria-label="Komodon home" title="Komodon">
            <span className="sidenav-icon" aria-hidden>
              <LogoMark size={22} />
            </span>
            <span className="sidenav-label sidenav-wordmark">Komodon</span>
          </NavLink>
          <nav className="sidenav-group">
            {main.map((l) => (
              <RailLink key={l.to} to={l.to} label={l.label} icon={l.icon} end={l.to === '/'} />
            ))}
          </nav>
          {more.length > 0 && (
            <>
              <div className="sidenav-divider" aria-hidden />
              <nav className="sidenav-group" aria-label="More pages">
                {more.map((l) => (
                  <RailLink key={l.to} to={l.to} label={l.label} icon={l.icon} />
                ))}
              </nav>
            </>
          )}
          <div className="flex-1" />
          <div className="sidenav-group">
            {user && (
              <RailStats
                streak={user.streak.current}
                level={user.level}
                ratio={lp?.ratio ?? 0}
                toNext={lp?.toNext ?? 0}
              />
            )}
            {isAdmin && <RailLink to="/admin" label="Admin" icon={ShieldCheck} />}
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
            <RailLink to="/settings" label="Settings" icon={SettingsIcon} />
            <SignOutButton rail />
            <button
              type="button"
              className="sidenav-link"
              onClick={() => setPinned(!pinned)}
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

      <header className="nav chrome">
        <div className="nav-inner">
          <NavLink to="/" className="brand" aria-label="Komodon home">
            <span className="brand-logo" aria-hidden>
              <LogoMark size={22} />
            </span>
            <span>Komodon</span>
          </NavLink>
          <div className="nav-scroll scroll-edges ml-2">
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
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === '/'}
                  className="nav-link"
                  onClick={onNavClick}
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>
          {user && (
            <div className="nav-stats">
              <NavLink to="/analytics" className="nav-streak" title="Current streak">
                <Flame size={15} aria-hidden className="nav-streak-flame" />
                <span className="tabular">{user.streak.current}</span>
                <span className="sr-only">day streak</span>
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
          <SignOutButton />
        </div>
      </header>

      {/* Phones: every page as an icon, and the one you are on widens to show its name. */}
      <nav className="tabbar chrome" aria-label="Primary">
        {shown.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className="tabbar-link"
            aria-label={l.label}
          >
            <span className="tabbar-icon" aria-hidden>
              <l.icon size={21} strokeWidth={1.9} />
            </span>
            <span className="tabbar-label" aria-hidden>
              {l.short}
            </span>
          </NavLink>
        ))}
      </nav>

      <main id="main" className="page on-backdrop" tabIndex={-1}>
        {!online && (
          <Glass className="offline-bar" role="status">
            <WifiOff size={16} aria-hidden />
            <span>
              You are offline. This is your saved data — it will refresh once you reconnect, and
              anything you change now will not be saved.
            </span>
          </Glass>
        )}
        <ErrorBoundary>
          {/* Keyed by route so each page rises in as it arrives. */}
          <div key={location.pathname} className="route-in">
            <Outlet />
          </div>
        </ErrorBoundary>
      </main>
    </>
  );
}
