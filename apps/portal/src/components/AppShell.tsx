import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Flame, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { applyPanelStyle, applyTheme, Backdrop, Button, Glass, resolveTheme } from '@doloop/ui';
import { CUSTOM_BACKGROUND_UPLOAD, levelProgress as levelProgressView } from '@doloop/core';
import { useAuth } from '../lib/auth';
import { useCustomBackground, useMe } from '../lib/queries';
import { useExtensionStatus } from '../lib/extension-bridge';
import { ErrorBoundary } from './ErrorState';

const links = [
  { to: '/', label: 'Today' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/achievements', label: 'Achievements' },
];

export function AppShell() {
  const me = useMe();
  const auth = useAuth();
  const navigate = useNavigate();
  const settings = me.data?.user.settings;
  // Hands the session to the Chrome extension whenever the shell mounts.
  useExtensionStatus();

  useEffect(() => {
    if (!settings) return;
    applyTheme({
      mode: settings.theme.mode,
      accent: settings.theme.accent,
      reducedMotion: settings.effects.reducedMotion,
    });
    // Custom accent: "custom:<h>,<s>,<l>"
    const root = document.documentElement;
    if (settings.theme.accent.startsWith('custom:')) {
      const [h, s, l] = settings.theme.accent.slice(7).split(',').map(Number);
      root.dataset.accent = 'custom';
      root.style.setProperty('--accent-h', String(h ?? 240));
      root.style.setProperty('--accent-s', `${s ?? 84}%`);
      root.style.setProperty('--accent-l', `${l ?? 62}%`);
    } else {
      root.style.removeProperty('--accent-h');
      root.style.removeProperty('--accent-s');
      root.style.removeProperty('--accent-l');
    }
  }, [settings]);

  // Follow OS theme changes while in system mode.
  useEffect(() => {
    if (!settings || settings.theme.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () =>
      applyTheme({
        mode: 'system',
        accent: settings.theme.accent.startsWith('custom:') ? 'custom' : settings.theme.accent,
        reducedMotion: settings.effects.reducedMotion,
      });
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings]);

  const theme = resolveTheme(settings?.theme.mode ?? 'system');
  const uploaded = useCustomBackground(
    settings?.theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD,
  );
  const customImageUrl =
    settings?.theme.customBackgroundUrl === CUSTOM_BACKGROUND_UPLOAD
      ? (uploaded.data?.dataUrl ?? null)
      : (settings?.theme.customBackgroundUrl ?? null);

  useEffect(() => {
    if (!settings) return;
    applyPanelStyle({
      panel: settings.theme.panel,
      color: settings.theme.panelColor,
      alpha: settings.theme.panelAlpha,
      theme,
    });
  }, [settings, theme]);
  const user = me.data?.user;
  const lp = user ? levelProgressView(user.xp) : null;

  return (
    <>
      <Backdrop
        backgroundId={settings?.theme.backgroundId ?? 'aurora'}
        theme={theme}
        customImageUrl={customImageUrl}
      />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Glass as="header" className="nav" strong>
        <div className="nav-inner">
          <NavLink to="/" className="brand" aria-label="Doloop home">
            <span className="brand-mark" aria-hidden />
            <span>Doloop</span>
          </NavLink>
          <nav className="flex items-center gap-1 ml-2" aria-label="Primary">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} className="nav-link">
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          {user && (
            <div className="hidden sm:flex items-center gap-3 text-sm mr-1">
              <span className="inline-flex items-center gap-1" title="Current streak">
                <Flame size={16} aria-hidden />
                <span className="tabular">{user.streak.current}</span>
                <span className="sr-only">day streak</span>
              </span>
              <span className="tabular" title={`${lp?.toNext} XP to level ${(lp?.level ?? 0) + 1}`}>
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
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </>
  );
}
