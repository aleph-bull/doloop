import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { Spinner } from '@komogon/ui';
import { AppShell } from './components/AppShell';
import { ErrorBoundary, ErrorPanel } from './components/ErrorState';
import { ApiError } from './lib/api';
import {
  NOT_INVITED_MESSAGE,
  SUSPENDED_MESSAGE,
  authMode,
  leaveSignInNotice,
  useAuth,
} from './lib/auth';
import { useCachePersistence } from './lib/local-state';
import {
  loadAchievements,
  loadAnalytics,
  loadCalendar,
  loadFocus,
  loadGrades,
  loadPlan,
  loadPlans,
  loadProfile,
  loadRoutines,
  loadSettings,
  loadSocial,
  loadTasks,
} from './lib/page-loaders';
import { useMe } from './lib/queries';
import { SignIn } from './pages/SignIn';
import { Today } from './pages/Today';

// Route-level code splitting keeps the first paint small (spec §9: LCP < 2 s).
const AuthCallback = lazy(() =>
  import('./pages/AuthCallback').then((m) => ({ default: m.AuthCallback })),
);
const Onboarding = lazy(() =>
  import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })),
);
// The nav's pages load through lib/page-loaders, which also warms them up ahead of a tap.
const Tasks = lazy(() => loadTasks().then((m) => ({ default: m.Tasks })));
const Grades = lazy(() => loadGrades().then((m) => ({ default: m.Grades })));
const Routines = lazy(() => loadRoutines().then((m) => ({ default: m.Routines })));
const Plans = lazy(() => loadPlans().then((m) => ({ default: m.Plans })));
const Plan = lazy(() => loadPlan().then((m) => ({ default: m.Plan })));
const Calendar = lazy(() => loadCalendar().then((m) => ({ default: m.Calendar })));
const Analytics = lazy(() => loadAnalytics().then((m) => ({ default: m.Analytics })));
const Achievements = lazy(() => loadAchievements().then((m) => ({ default: m.Achievements })));
const Settings = lazy(() => loadSettings().then((m) => ({ default: m.Settings })));
const Extension = lazy(() => import('./pages/Extension').then((m) => ({ default: m.Extension })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const Profile = lazy(() => loadProfile().then((m) => ({ default: m.Profile })));
const Social = lazy(() => loadSocial().then((m) => ({ default: m.Social })));
const Focus = lazy(() => loadFocus().then((m) => ({ default: m.Focus })));
const ResetPassword = lazy(() =>
  import('./pages/ResetPassword').then((m) => ({ default: m.ResetPassword })),
);

/** An old /social/:id link: the same profile at its new address. */
function ProfileRedirect() {
  const { id } = useParams();
  return <Navigate to={`/profile/${id}`} replace />;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div>{children}</div>
    </div>
  );
}

const fallback = (
  <div className="flex justify-center p-12">
    <Spinner />
  </div>
);

function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading')
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  if (auth.status === 'signed-out')
    return <Navigate to="/signin" state={{ from: location }} replace />;
  return <>{children}</>;
}

/**
 * The API turned this account away (not on `ALLOWED_EMAILS`, or suspended by an admin):
 * sign out and say why.
 */
function TurnedAway({ message }: { message: string }) {
  const auth = useAuth();
  const { signOut } = auth;
  const navigate = useNavigate();
  useEffect(() => {
    // Go on once signed out: RequireAuth then sends the signed-out app to sign in in this
    // component's place, so the <Navigate> below would never get to say why.
    leaveSignInNotice(message);
    void signOut().then(() => navigate('/signin', { replace: true, state: { error: message } }));
  }, [signOut, navigate, message]);
  if (auth.status === 'signed-in')
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  return <Navigate to="/signin" replace state={{ error: message }} />;
}

/** Sends new users through onboarding once; everything else renders in the shell. */
function Gate({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  const refused = me.error instanceof ApiError && me.error.status === 403 ? me.error.message : null;
  if (refused === 'invite_only') return <TurnedAway message={NOT_INVITED_MESSAGE} />;
  if (refused === 'account_suspended') return <TurnedAway message={SUSPENDED_MESSAGE} />;
  // The API no longer takes this sign-in (a dev account that has expired, a session ended
  // elsewhere): sign out and say so, rather than claim the API can't be reached.
  if (me.error instanceof ApiError && me.error.status === 401 && authMode !== 'supabase')
    return (
      <TurnedAway
        message={
          me.error.message.endsWith('Sign in again.')
            ? me.error.message
            : 'Your sign-in has run out. Sign in again.'
        }
      />
    );
  if (me.isError && !me.data)
    return (
      <Centered>
        <ErrorPanel
          message="Could not reach the Komodon API. Check that it is running, then try again."
          onRetry={() => me.refetch()}
        />
      </Centered>
    );
  if (!me.data)
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  if (!me.data.onboarded && location.pathname !== '/onboarding')
    return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export function App() {
  useCachePersistence();
  return (
    <ErrorBoundary>
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignIn />} />
          {/* The app's own landing page was removed (2026-10-21); signed-out visitors sign in. */}
          <Route path="/welcome" element={<Navigate to="/signin" replace />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <Gate>
                  <Onboarding />
                </Gate>
              </RequireAuth>
            }
          />
          {/* The focus screen is its own tab with no nav or page chrome, so it sits outside the shell. */}
          <Route
            path="/focus"
            element={
              <RequireAuth>
                <Gate>
                  <Focus />
                </Gate>
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <Gate>
                  <AppShell />
                </Gate>
              </RequireAuth>
            }
          >
            <Route path="/" element={<Today />} />
            <Route path="/tasks" element={<Tasks />} />
            {/* The dashboard is the home page now; the old URL still resolves. */}
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/grades" element={<Grades />} />
            <Route path="/routines" element={<Routines />} />
            <Route path="/plans" element={<Plans />} />
            <Route path="/plans/:id" element={<Plan />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/analytics" element={<Analytics />} />
            {/* The weekly review page was removed (2026-10-20); old links land on Analytics. */}
            <Route path="/analytics/review" element={<Navigate to="/analytics" replace />} />
            <Route path="/achievements" element={<Achievements />} />
            {/* Social: the feed, friends, compare and the leaderboard. Profiles are their own pages. */}
            <Route path="/social" element={<Social />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/:id" element={<Profile />} />
            {/* Profiles lived under /social until 2026-10-21; old links still land. */}
            <Route path="/social/:id" element={<ProfileRedirect />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/extension" element={<Extension />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
