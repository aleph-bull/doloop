import { Component, type ReactNode } from 'react';
import { Button, Glass } from '@komogon/ui';
import { reportError } from '../lib/monitoring';

export function ErrorPanel({
  message = 'Something went wrong.',
  onRetry,
  retryLabel = 'Try again',
}: {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <Glass role="alert" className="p-5 flex flex-col gap-3 items-start">
      <p>{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </Glass>
  );
}

/** Shows an error panel for any query in the list that failed; renders children otherwise. */
export function QueryGate({
  queries,
  children,
}: {
  queries: Array<{ isError: boolean; error: unknown; refetch: () => unknown }>;
  children: ReactNode;
}) {
  const failed = queries.find((q) => q.isError);
  if (failed) {
    const msg = failed.error instanceof Error ? failed.error.message : 'Could not load this page.';
    return <ErrorPanel message={msg} onRetry={() => queries.forEach((q) => q.refetch())} />;
  }
  return <>{children}</>;
}

/**
 * A tab opened before a deploy still asks for the old build's page files. Each deploy renames
 * them, the host answers the old names with the app's HTML, and loading the page fails.
 */
export function isStaleBuildError(error: Error): boolean {
  // Offline, a page that never downloaded fails the same way; that isn't a new build.
  if (!navigator.onLine) return false;
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    error.message,
  );
}

const RELOADED_AT = 'komogon.staleBuildReloadAt';

/**
 * Reload to pick up the new build, unless this tab did that in the last minute: then the file
 * is missing for some other reason, and reloading again would only loop. Says whether it did.
 */
function reloadForNewBuild(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < 60_000) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

interface BoundaryState {
  error: Error | null;
  /** A page from an older build failed to load and a reload was just tried. */
  stillStale: boolean;
}

/**
 * Catches render errors so a bug in one page never blanks the whole app. A page that fails
 * to load because a deploy replaced the build reloads the tab once instead, quietly.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null, stillStale: false };
  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }
  override componentDidCatch(error: Error) {
    if (isStaleBuildError(error)) {
      if (reloadForNewBuild()) return;
      this.setState({ stillStale: true });
    }
    reportError(error);
  }
  override render() {
    if (this.state.error && isStaleBuildError(this.state.error)) {
      // Blank while the reload starts; a message only if reloading didn't help.
      if (!this.state.stillStale) return null;
      return (
        <div className="page">
          <ErrorPanel
            message="Komodon was just updated. Refresh the page to load the new version."
            retryLabel="Refresh"
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div className="page">
          <ErrorPanel
            message={`This page hit an error: ${this.state.error.message}`}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
