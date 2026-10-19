import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
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
  LogOut,
  Repeat,
  Settings as SettingsIcon,
  Trophy,
  WifiOff,
  type LucideIcon,
  Route as RouteIcon,
} from 'lucide-react';
import { Backdrop, Button, Glass, LogoMark } from '@komogon/ui';
import { useAppearance } from '../lib/appearance';
import { useAuth } from '../lib/auth';
import { useOnlineStatus } from '../lib/local-state';
import { useMe } from '../lib/queries';
import { useExtensionStatus } from '../lib/extension-bridge';
import { useScrollEdges } from '../lib/scroll-edges';
import { useUndoShortcuts } from '../lib/undo';
import { ErrorBoundary } from './ErrorState';

/**
 * `short` is the phone tab bar's label, where seven tabs share 390px. `feature` names the
 * setting that can take a page out of the nav.
 */
const links: Array<{
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
  feature?: keyof UserSettings['features'];
}> = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: House },
  { to: '/tasks', label: 'Tasks', short: 'Tasks', icon: ListChecks },
  { to: '/routines', label: 'Routines', short: 'Routines', icon: Repeat, feature: 'routines' },
  { to: '/plans', label: 'Plans', short: 'Plans', icon: RouteIcon, feature: 'plans' },
  { to: '/grades', label: 'Grades', short: 'Grades', icon: GraduationCap, feature: 'grades' },
  {
    to: '/calendar',
    label: 'Calendar',
    short: 'Calendar',
    icon: CalendarDays,
    feature: 'calendar',
  },
  { to: '/analytics', label: 'Analytics', short: 'Stats', icon: ChartColumn },
  { to: '/achievements', label: 'Achievements', short: 'Awards', icon: Trophy },
];

/** The level as a small ring that fills toward the next one. */
function LevelRing({ xp, level }: { xp: number; level: number }) {
  const ratio = levelProgress(xp).ratio;
  const r = 12;
  const c = 2 * Math.PI * r;
  return (
    <span className="nav-level" title={`Level ${level}`}>
      <svg viewBox="0 0 30 30" width={30} height={30} aria-hidden>
        <circle cx={15} cy={15} r={r} className="nav-level-track" />
        <circle
          cx={15}
          cy={15}
          r={r}
          className="nav-level-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          transform="rotate(-90 15 15)"
        />
      </svg>
      <span className="nav-level-num tabular">{level}</span>
      <span className="sr-only">Level {level}</span>
    </span>
  );
}

export function AppShell() {
  const me = useMe();
  const auth = useAuth();
  const navigate = useNavigate();
  const settings = me.data?.user.settings;
  const online = useOnlineStatus();
  // Hands the session to the Chrome extension whenever the shell mounts.
  useExtensionStatus();
  // Ctrl+Z and Ctrl+Y for the small reversible things, anywhere in the app.
  useUndoShortcuts();
  // Theme, accent, motion and backdrop: the same hook the focus screen uses.
  const appearance = useAppearance(settings);
  const shown = links.filter((l) => !l.feature || settings?.features?.[l.feature] !== false);

  // The active pill is one element that slides and resizes between links, so a tab
  // change reads as movement rather than a jump.
  const navRef = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, animate: false });
  const location = useLocation();

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
      // No primary tab is active (Settings, say) â€” fade the pill out where it stands.
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

  // When the bar is too narrow for every tab, the tabs scroll sideways, with an arrow
  // on each side that hides one.
  const {
    edges: overflow,
    measure: measureOverflow,
    scrollByPage: scrollTabs,
  } = useScrollEdges(navRef);

  useLayoutEffect(() => {
    measureIndicator();
    // Arriving on a tab from elsewhere should never leave it scrolled out of sight.
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('.nav-link[aria-current="page"]');
    if (nav && active) {
      const start = active.offsetLeft;
      const end = start + active.offsetWidth;
      if (start < nav.scrollLeft) nav.scrollLeft = start - 32;
      else if (end > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = end - nav.clientWidth + 32;
    }
    measureOverflow();
  }, [measureIndicator, measureOverflow, location.pathname]);

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
    const ro = new ResizeObserver(() => measureIndicator());
    ro.observe(nav);
    for (const child of Array.from(nav.children)) ro.observe(child);
    window.addEventListener('resize', measureIndicator);
    void document.fonts?.ready.then(() => measureIndicator());
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measureIndicator);
    };
  }, [measureIndicator]);

  const user = me.data?.user;

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
      <header className="nav chrome">
        <div className="nav-inner">
          <NavLink to="/" className="brand" aria-label="Komogon home">
            <span className="brand-logo" aria-hidden>
              <LogoMark size={22} />
            </span>
            <span>Komogon</span>
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
          <div className="flex-1" />
          {user && (
            <div className="nav-stats">
              <NavLink to="/analytics" className="nav-streak" title="Current streak">
                <Flame size={15} aria-hidden className="nav-streak-flame" />
                <span className="tabular">{user.streak.current}</span>
                <span className="sr-only">day streak</span>
              </NavLink>
              <LevelRing xp={user.xp} level={user.level} />
            </div>
          )}
          <NavLink to="/settings" className="nav-icon" aria-label="Settings" title="Settings">
            <SettingsIcon size={18} aria-hidden />
          </NavLink>
          <Button
            variant="ghost"
            size="sm"
            icon
            className="nav-signout"
            aria-label="Sign out"
            title="Sign out"
            onClick={async () => {
              await auth.signOut();
              navigate('/signin');
            }}
          >
            <LogOut size={16} aria-hidden />
          </Button>
        </div>
      </header>
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
              You are offline. This is your saved data â€” it will refresh once you reconnect, and
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
