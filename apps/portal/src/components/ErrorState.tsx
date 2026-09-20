import { Component, type ReactNode } from 'react';
import { Button, Glass } from '@doloop/ui';

export function ErrorPanel({
  message = 'Something went wrong.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Glass role="alert" className="p-6 flex flex-col gap-3 items-start">
      <p>{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
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

interface BoundaryState {
  error: Error | null;
}

/** Catches render errors so a bug in one page never blanks the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }
  override render() {
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
