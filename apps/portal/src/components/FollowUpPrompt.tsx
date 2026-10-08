import { useQueryClient } from '@tanstack/react-query';
import { Button, Glass, useToast } from '@komogon/ui';
import { api } from '../lib/api';
import { keys, useFollowUps } from '../lib/queries';

/** "How did it go?" one day after an assessment (spec §11b). Asked once. */
export function FollowUpPrompt() {
  const q = useFollowUps();
  const qc = useQueryClient();
  const { toast } = useToast();
  const node = q.data?.followUps[0];
  if (!node) return null;
  const done = () => {
    void qc.invalidateQueries({ queryKey: keys.followUps });
    void qc.invalidateQueries({ queryKey: keys.nodes });
  };
  return (
    <Glass
      className="p-5 flex flex-col gap-3 fade-in"
      role="region"
      aria-label="Assessment follow-up"
    >
      <div>
        <h2 className="text-lg">How did {node.title} go?</h2>
        <p className="muted text-sm">
          Asked once per task. Your answer goes on the chart of how ready you felt as the due date
          came closer.
        </p>
      </div>
      <div
        className="flex gap-2 items-center flex-wrap"
        role="radiogroup"
        aria-label="How did it go, 1 to 5"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            size="sm"
            aria-label={`${n} of 5`}
            onClick={() =>
              api
                .updateNode(node.id, { outcomeRating: n })
                .then(done)
                .catch((e) => toast(e.message))
            }
          >
            {n}
          </Button>
        ))}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            api
              .dismissFollowUp(node.id)
              .then(done)
              .catch((e) => toast(e.message))
          }
        >
          Skip
        </Button>
      </div>
    </Glass>
  );
}
