import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  LogOut,
  Settings as SettingsIcon,
  WifiOff,
} from 'lucide-react';
import { Backdrop, Button, Glass, LogoMark } from '@komogon/ui';
import { useAppearance } from '../lib/appearance';
import { useAuth } from '../lib/auth';
import { useOnlineStatus } from '../lib/local-state';
import { useMe } from '../lib/queries';
import { useExtensionStatus } from '../lib/extension-bridge';
import { useScrollEdges } from '../lib/scroll-edges';
import { ErrorBoundary } from './ErrorState';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/routines', label: 'Routines' },
  { to: '/grades', label: 'Grades' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/achievements', label: 'Achievements' },
];

export function AppShell() {
  const me = useMe();
  const auth = useAuth();
  const navigate = useNavigate();
  const settings = me.data?.user.settings;
  const online = useOnlineStatus();
  // Hands the session to the Chrome extension whenever the shell mounts.
  useExtensionStatus();
  // Theme, accent, motion and backdrop: the same hook the focus screen uses.
  const appearance = useAppearance(settings);

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
      // No primary tab is active (Settings, say) — fade the pill out where it stands.
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
      <Glass as="header" className="nav" strong>
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
              {links.map((l) => (
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
            <div className="hidden sm:flex items-center gap-3 text-sm mr-1 shrink-0 whitespace-nowrap">
              <span className="inline-flex items-center gap-1" title="Current streak">
                <Flame size={16} aria-hidden />
                <span className="tabular">{user.streak.current}</span>
                <span className="sr-only">day streak</span>
              </span>
              <span className="tabular" title={`Level ${user.level}`}>
                Lv {user.level}
              </span>
            </div>
          )}
          <NavLink to="/settings" className="nav-link" aria-label="Settings">
            <SettingsIcon size={18} aria-hidden />
          </NavLink>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Sign out"
            onClick={async () => {
              await auth.signOut();
              navigate('/signin');
            }}
          >
            <LogOut size={16} aria-hidden />
          </Button>
        </div>
      </Glass>
      <main id="main" className="page" tabIndex={-1}>
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
          <Outlet />
        </ErrorBoundary>
      </main>
    </>
  );
}
