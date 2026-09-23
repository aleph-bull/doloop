import {
  bandFor,
  neededOnRemaining,
  type CourseGrade,
  type GradeComponent,
  type StudyNode,
} from '@komodoit/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Chip, EmptyState, Input, Panel, Segmented, Spinner, useToast } from '@komodoit/ui';
import { ErrorPanel } from '../components/ErrorState';
import {
  useCreateComponent,
  useDeleteComponent,
  useGrades,
  useMe,
  useUpdateComponent,
  useUpdateNode,
} from '../lib/queries';

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 10) / 10}%`);

/** A course's mark as a big number plus its letter, or a clear "nothing marked yet". */
function GradeHeadline({ grade }: { grade: CourseGrade }) {
  if (grade.mode === 'off') return <span className="muted text-sm">Not graded</span>;
  if (grade.percent === null) {
    return <span className="muted text-sm">Nothing marked yet</span>;
  }
  return (
    <div className="flex items-baseline gap-2">
      <span className="grade-percent tabular">{pct(grade.percent)}</span>
      {grade.letter && <Chip tone="info">{grade.letter}</Chip>}
      {grade.points !== null && <span className="muted text-sm tabular">{grade.points} pts</span>}
    </div>
  );
}

interface ComponentRowProps {
  component: GradeComponent;
  unitless: boolean;
}

/** One weighted item. Weight and score commit on blur, so typing never fires a request per key. */
function ComponentRow({ component, unitless }: ComponentRowProps) {
  const update = useUpdateComponent();
  const remove = useDeleteComponent();
  const { toast } = useToast();
  const [title, setTitle] = useState(component.title);
  const [weight, setWeight] = useState(String(component.weight));
  const [score, setScore] = useState(component.score === null ? '' : String(component.score));

  const commit = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate(
      { id: component.id, patch },
      { onError: (e) => toast(e instanceof Error ? e.message : 'Could not save that') },
    );

  const commitNumber = (raw: string, key: 'weight' | 'score') => {
    if (raw.trim() === '') {
      if (key === 'score') commit({ score: null });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      toast('That has to be a number');
      return;
    }
    commit({ [key]: n });
  };

  return (
    <tr>
      <td>
        <Input
          aria-label="Item name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() =>
            title.trim() && title !== component.title && commit({ title: title.trim() })
          }
        />
      </td>
      <td className="grade-num">
        <Input
          aria-label={`Weight of ${component.title} in percent`}
          type="number"
          min={0}
          max={100}
          step="any"
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onBlur={() => commitNumber(weight, 'weight')}
        />
      </td>
      <td className="grade-num">
        <Input
          aria-label={`Score on ${component.title}${unitless ? '' : ' in percent'}`}
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          placeholder="—"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          onBlur={() => commitNumber(score, 'score')}
        />
      </td>
      <td>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`Remove ${component.title}`}
          loading={remove.isPending}
          onClick={() =>
            remove.mutate(component.id, {
              onError: (e) => toast(e instanceof Error ? e.message : 'Could not remove that'),
            })
          }
        >
          <Trash2 size={14} aria-hidden />
        </Button>
      </td>
    </tr>
  );
}

/**
 * Says what the weights add up to, in words.
 *
 * "Weights add to 0%" meant nothing on its own: the number is the share of the final grade
 * the user has described so far, and what matters is how much of the course is still
 * unaccounted for.
 */
function WeightNote({ components, total }: { components: number; total: number }) {
  if (components === 0) return null;
  const rounded = Math.round(total * 10) / 10;
  if (rounded === 100) return null;
  if (rounded === 0) {
    return (
      <>
        Each item needs a weight - the share of the final grade it is worth. They should add up to
        100%.
      </>
    );
  }
  if (rounded < 100) {
    return (
      <>
        Your items are worth {rounded}% of the final grade, so{' '}
        {Math.round((100 - rounded) * 10) / 10}% of the course is still unaccounted for.
      </>
    );
  }
  return (
    <>
      Your items add up to {rounded}% of the final grade, which is{' '}
      {Math.round((rounded - 100) * 10) / 10}% more than the whole course.
    </>
  );
}

interface CourseCardProps {
  node: StudyNode;
  grade: CourseGrade;
  components: GradeComponent[];
  goalPercent: number | null;
}

function CourseCard({ node, grade, components, goalPercent }: CourseCardProps) {
  const updateNode = useUpdateNode();
  const addComponent = useCreateComponent();
  const { toast } = useToast();
  const [overall, setOverall] = useState(
    node.gradeOverall === null ? '' : String(node.gradeOverall),
  );
  const [credits, setCredits] = useState(
    node.gradeCredits === null ? '' : String(node.gradeCredits),
  );
  const mode = node.gradeMode ?? 'components';
  const needed = goalPercent === null ? null : neededOnRemaining(grade, goalPercent);

  const patch = (p: Parameters<typeof updateNode.mutate>[0]['patch']) =>
    updateNode.mutate(
      { id: node.id, patch: p },
      { onError: (e) => toast(e instanceof Error ? e.message : 'Could not save that') },
    );

  return (
    <Panel as="section" className="p-5 flex flex-col gap-4" aria-labelledby={`gr-${node.id}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h2 id={`gr-${node.id}`} className="text-lg truncate">
            {node.title}
          </h2>
          <GradeHeadline grade={grade} />
        </div>
        <Segmented
          ariaLabel={`How ${node.title} is graded`}
          value={mode}
          onChange={(v) => patch({ gradeMode: v as 'off' | 'overall' | 'components' })}
          options={[
            { value: 'components', label: 'By weight' },
            { value: 'overall', label: 'One mark' },
            { value: 'off', label: 'Not graded' },
          ]}
        />
      </div>

      {mode === 'off' ? (
        <p className="muted text-sm">
          Not tracking a grade for this course. It stays out of your average.
        </p>
      ) : mode === 'overall' ? (
        <div className="flex gap-4 flex-wrap items-end">
          <Input
            label="Final mark (%)"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            className="w-32"
            value={overall}
            onChange={(e) => setOverall(e.target.value)}
            onBlur={() => patch({ gradeOverall: overall.trim() === '' ? null : Number(overall) })}
          />
          <Input
            label="Credits"
            hint="Weight in your GPA. 1 for a full course, 0.5 for a half."
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            className="w-32"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            onBlur={() => patch({ gradeCredits: credits.trim() === '' ? null : Number(credits) })}
          />
        </div>
      ) : (
        <>
          {components.length > 0 && (
            <div className="table-wrap">
              <table className="data-table grade-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="grade-num">
                      Weight %
                    </th>
                    <th scope="col" className="grade-num">
                      Score %
                    </th>
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => (
                    <ComponentRow key={c.id} component={c} unitless={false} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              loading={addComponent.isPending}
              onClick={() =>
                addComponent.mutate(
                  {
                    nodeId: node.id,
                    title: `Item ${components.length + 1}`,
                    weight: 0,
                  },
                  { onError: (e) => toast(e instanceof Error ? e.message : 'Could not add that') },
                )
              }
            >
              <Plus size={14} aria-hidden /> Add item
            </Button>
            <Input
              label="Credits"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              className="w-24"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              onBlur={() => patch({ gradeCredits: credits.trim() === '' ? null : Number(credits) })}
            />
            <p className="muted text-sm flex-1 min-w-0">
              {grade.weightGraded > 0
                ? `${pct(grade.percent)} of the ${grade.weightGraded}% of this course that has been marked.`
                : 'Enter a score to see where you stand.'}{' '}
              <WeightNote components={components.length} total={grade.weightTotal} />
            </p>
          </div>

          {needed !== null && goalPercent !== null && (
            <p className="muted text-sm">
              {needed > 100
                ? `A ${goalPercent}% is out of reach: the rest would have to average ${pct(needed)}.`
                : needed <= 0
                  ? `A ${goalPercent}% is already locked in.`
                  : `To finish at ${goalPercent}%, the remaining ${grade.weightTotal - grade.weightGraded}% has to average ${pct(needed)}.`}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/** Running grade per course, plus the GPA across them, on the user's own scale. */
export function Grades() {
  const grades = useGrades();
  const me = useMe();
  const [goal, setGoal] = useState('');

  if (grades.isError)
    return (
      <ErrorPanel
        message={grades.error instanceof Error ? grades.error.message : 'Could not load grades.'}
        onRetry={() => grades.refetch()}
      />
    );
  if (grades.isLoading || !grades.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  const { courses, gpa } = grades.data;
  const scale = me.data?.user.settings.grading.scale ?? [];
  const goalGpa = me.data?.user.settings.grading.goalGpa ?? null;
  const goalPercent = goal.trim() === '' ? null : Number(goal);
  const points = gpa.points;
  const gpaBand = points === null ? null : scale.find((b) => b.points <= points);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl">Grades</h1>
          <p className="muted text-sm mt-1">
            Your own scale, set in <Link to="/settings#grading">settings</Link>. Nothing here is
            sent anywhere.
          </p>
        </div>
        {gpa.points !== null && (
          <Panel className="p-4 text-right">
            <div className="muted text-xs">Average across {gpa.courseCount} graded</div>
            <div className="grade-percent tabular">{Math.round(gpa.points * 100) / 100}</div>
            {goalGpa !== null && (
              <div className="muted text-xs tabular">
                {gpa.points >= goalGpa ? 'above' : 'below'} your {goalGpa} goal
              </div>
            )}
            {gpaBand && <div className="muted text-xs">around {gpaBand.letter}</div>}
          </Panel>
        )}
      </div>

      {courses.length === 0 ? (
        <Panel className="p-2">
          <EmptyState
            title="No courses yet"
            body="Grades hang off your courses. Add one in Tasks and it will show up here."
            action={
              <Link to="/tasks" className="btn btn-primary">
                Go to Tasks
              </Link>
            }
          />
        </Panel>
      ) : (
        <>
          <Panel className="p-4 flex items-end gap-3 flex-wrap">
            <Input
              label="Target for each course (%)"
              hint="Optional. Shows what the ungraded part of a course has to average."
              type="number"
              min={0}
              max={100}
              step="any"
              inputMode="decimal"
              className="w-36"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
            {goalPercent !== null && Number.isFinite(goalPercent) && (
              <p className="muted text-sm flex-1">
                {bandFor(scale, goalPercent)?.letter
                  ? `That's ${bandFor(scale, goalPercent)!.letter} on your scale.`
                  : ''}
              </p>
            )}
          </Panel>

          {courses.map(({ node, grade, components }) => (
            <CourseCard
              key={node.id}
              node={node}
              grade={grade}
              components={components}
              goalPercent={
                goalPercent !== null && Number.isFinite(goalPercent) ? goalPercent : null
              }
            />
          ))}
        </>
      )}
    </div>
  );
}
