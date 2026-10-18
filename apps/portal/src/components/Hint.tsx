import { Lightbulb, X } from 'lucide-react';
import { Button, Glass } from '@komogon/ui';
import { useHints, type HintKey } from '../lib/hints';

export interface HintProps {
  id: HintKey;
  /** Only render when true (e.g. "after the 3rd session"). */
  when: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}

/** Small dismissable hint (spec §13). */
export function Hint({ id, when, children, action }: HintProps) {
  const { isDismissed, dismiss } = useHints();
  if (!when || isDismissed(id)) return null;
  return (
    <Glass className="hint fade-in" role="note">
      <Lightbulb size={16} aria-hidden className="hint-icon" />
      <div className="hint-body">
        <div>{children}</div>
        {action && <div className="hint-action">{action}</div>}
      </div>
      <Button variant="ghost" size="sm" icon aria-label="Dismiss hint" onClick={() => dismiss(id)}>
        <X size={14} aria-hidden />
      </Button>
    </Glass>
  );
}
