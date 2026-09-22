import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Spinner } from '@doloop/ui';
import { AppShell } from './components/AppShell';
import { ErrorBoundary, ErrorPanel } from './components/ErrorState';
import { useAuth } from './lib/auth';
import { useCachePersistence } from './lib/local-state';
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
const Tasks = lazy(() => import('./pages/Tasks').then((m) => ({ default: m.Tasks })));
const Grades = lazy(() => import('./pages/Grades').then((m) => ({ default: m.Grades })));
const Routines = lazy(() => import('./pages/Routines').then((m) => ({ default: m.Routines })));
const Calendar = lazy(() => import('./pages/Calendar').then((m) => ({ default: m.Calendar })));
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })));
const WeeklyReviewPage = lazy(() =>
  import('./pages/WeeklyReviewPage').then((m) => ({ default: m.WeeklyReviewPage })),
);
const Achievements = lazy(() =>
  import('./pages/Achievements').then((m) => ({ default: m.Achievements })),
);
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Extension = lazy(() => import('./pages/Extension').then((m) => ({ default: m.Extension })));

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

/** Sends new users through onboarding once; everything else renders in the shell. */
function Gate({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isError && !me.data)
    return (
      <Centered>
        <ErrorPanel
          message="Could not reach the Doloop API. Check that it is running, then try again."
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
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/analytics/review" element={<WeeklyReviewPage />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/extension" element={<Extension />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
