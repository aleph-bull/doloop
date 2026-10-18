import '../components/plans/plans.css';
import { Flame, Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Glass, ProgressBar, Spinner, useToast } from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { PlanDialog } from '../components/plans/PlanDialog';
import { PlanStatus } from '../components/plans/PlanStatus';
import { fmtHours } from '../lib/format';
import { useCreatePlan, usePlans } from '../lib/queries';

/** Every study plan, each as a card: how far along, what is next, what is due back. */
export function Plans() {
  const q = usePlans();
  const create = useCreatePlan();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  if (q.isError)
    return (
      <ErrorPanel
        message={q.error instanceof Error ? q.error.message : 'Could not load your plans.'}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  const plans = q.data.plans;

  return (
    <div className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">Plans</h1>
          <p className="page-sub">
            For anything without a syllabus: a language, an exam, interview prep. Topics, hours and
            drills, tracked like training.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={15} aria-hidden /> New plan
        </Button>
      </div>

      {plans.length === 0 ? (
        <Glass className="plans-empty">
          <Target size={28} aria-hidden className="plans-empty-icon" />
          <h2 className="section-title">Nothing planned yet</h2>
          <p className="muted">
            Paste the outline you already have, or build one topic at a time. Sessions on a topic
            count toward it, and drills tell you when it is actually learned.
          </p>
          <Button onClick={() => setCreating(true)}>Make a plan</Button>
        </Glass>
      ) : (
        <ul className="plan-cards">
          {plans.map((p) => (
            <li key={p.plan.id}>
              <Link to={`/plans/${p.plan.id}`} className="plan-card glass">
                <div className="plan-card-head">
                  <h2 className="plan-card-title">{p.plan.title}</h2>
                  <PlanStatus status={p.pacing.status} />
                </div>
                <div className="plan-card-figure tabular">
                  {fmtHours(p.pacing.loggedMinutes)}
                  <small> of {fmtHours(p.pacing.plannedMinutes)}</small>
                </div>
                <ProgressBar
                  value={
                    p.pacing.plannedMinutes ? p.pacing.loggedMinutes / p.pacing.plannedMinutes : 0
                  }
                  label="Hours logged against planned"
                />
                <dl className="plan-card-meta">
                  <div>
                    <dt>Topics</dt>
                    <dd className="tabular">
                      {p.pacing.topicsDone}/{p.pacing.topicsTotal}
                    </dd>
                  </div>
                  {p.upNext && (
                    <div className="plan-card-next">
                      <dt>Up next</dt>
                      <dd>{p.upNext.title}</dd>
                    </div>
                  )}
                  {p.dueItems > 0 && (
                    <div>
                      <dt>Due back</dt>
                      <dd className="tabular">{p.dueItems}</dd>
                    </div>
                  )}
                  {p.streak > 1 && (
                    <div>
                      <dt>Streak</dt>
                      <dd className="tabular plan-streak">
                        <Flame size={14} aria-hidden /> {p.streak}
                      </dd>
                    </div>
                  )}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <PlanDialog
        open={creating}
        onClose={() => setCreating(false)}
        busy={create.isPending}
        onCreate={async (input) => {
          try {
            const view = await create.mutateAsync(input);
            setCreating(false);
            navigate(`/plans/${view.plan.id}`);
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not make that plan.');
          }
        }}
      />
    </div>
  );
}
