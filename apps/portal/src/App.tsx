import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Spinner } from '@doloop/ui';
import { AppShell } from './components/AppShell';
import { useAuth } from './lib/auth';
import { useMe } from './lib/queries';
import { AuthCallback } from './pages/AuthCallback';
import { Extension } from './pages/Extension';
import { Onboarding } from './pages/Onboarding';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { Tasks } from './pages/Tasks';
import { Today } from './pages/Today';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div>{children}</div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
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
function Gate({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading)
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  if (me.isError && !me.data)
    return (
      <Centered>
        <p className="muted">Could not reach the API. Is it running?</p>
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
  return (
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
        <Route path="/settings" element={<Settings />} />
        <Route path="/extension" element={<Extension />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
