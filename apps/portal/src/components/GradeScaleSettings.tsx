import { sortScale, UOFT_GRADE_SCALE, type GradeBand, type UserSettings } from '@doloop/core';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, useToast } from '@doloop/ui';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface GradeScaleSettingsProps {
  settings: UserSettings;
  onPatch: (patch: DeepPartial<UserSettings>) => void | Promise<unknown>;
}

const isValid = (band: GradeBand) =>
  Number.isFinite(band.minPercent) &&
  band.minPercent >= 0 &&
  band.minPercent <= 100 &&
  band.letter.trim().length > 0 &&
  Number.isFinite(band.points) &&
  band.points >= 0;

/**
 * The percentage -> letter -> grade point table.
 *
 * Defaults to the U of T scale because that is the one this app was built around, but the
 * whole table is editable: a band is just a floor percentage, a name and a number of
 * points, which covers most schools and a plain pass/fail scheme alike.
 */
export function GradeScaleSettings({ settings, onPatch }: GradeScaleSettingsProps) {
  const { toast } = useToast();
  const saved = sortScale(settings.grading.scale);
  const [draft, setDraft] = useState<GradeBand[] | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const scale = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(sortScale(draft)) !== JSON.stringify(saved);

  const edit = (index: number, patch: Partial<GradeBand>) =>
    setDraft(scale.map((b, i) => (i === index ? { ...b, ...patch } : b)));

  const save = () => {
    const next = sortScale(scale);
    if (next.length === 0) {
      toast('A scale needs at least one band');
      return;
    }
    const bad = next.find((b) => !isValid(b));
    if (bad) {
      toast('Every band needs a percentage from 0 to 100, a name, and grade points');
      return;
    }
    if (new Set(next.map((b) => b.minPercent)).size !== next.length) {
      toast('Two bands start at the same percentage');
      return;
    }
    void onPatch({ grading: { scale: next } });
    setDraft(null);
  };

  return (
    <>
      <div className="field">
        <span className="field-label">Grading scale</span>
        <p className="field-hint">
          Each row is the lowest percentage that earns that grade. Rows are sorted highest first
          when you save.
        </p>
      </div>

      <div className="table-wrap">
        <table className="data-table grade-table">
          <thead>
            <tr>
              <th scope="col" className="grade-num">
                From %
              </th>
              <th scope="col">Grade</th>
              <th scope="col" className="grade-num">
                Points
              </th>
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {scale.map((band, i) => (
              <tr key={`${band.letter}-${i}`}>
                <td className="grade-num">
                  <Input
                    aria-label={`Lowest percentage for ${band.letter}`}
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    inputMode="decimal"
                    value={String(band.minPercent)}
                    onChange={(e) => edit(i, { minPercent: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <Input
                    aria-label={`Name of the band starting at ${band.minPercent}%`}
                    maxLength={8}
                    value={band.letter}
                    onChange={(e) => edit(i, { letter: e.target.value })}
                  />
                </td>
                <td className="grade-num">
                  <Input
                    aria-label={`Grade points for ${band.letter}`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={String(band.points)}
                    onChange={(e) => edit(i, { points: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={`Remove the ${band.letter} band`}
                    onClick={() => setDraft(scale.filter((_, x) => x !== i))}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setDraft([...scale, { minPercent: 0, letter: 'New', points: 0 }])}
        >
          <Plus size={14} aria-hidden /> Add band
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft([...UOFT_GRADE_SCALE])}>
          <RotateCcw size={14} aria-hidden /> Reset to U of T
        </Button>
        <span className="flex-1" />
        {draft !== null && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            Discard
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>
          Save scale
        </Button>
      </div>

      <Input
        label="Goal GPA (optional)"
        hint="Shown against your average on the Grades page."
        type="number"
        min={0}
        max={10}
        step="any"
        inputMode="decimal"
        className="w-32"
        value={goal ?? (settings.grading.goalGpa === null ? '' : String(settings.grading.goalGpa))}
        onChange={(e) => setGoal(e.target.value)}
        onBlur={() => {
          if (goal === null) return;
          const trimmed = goal.trim();
          const next = trimmed === '' ? null : Number(trimmed);
          if (next !== null && (!Number.isFinite(next) || next < 0)) {
            toast('A goal GPA has to be a number');
            return;
          }
          if (next !== settings.grading.goalGpa) void onPatch({ grading: { goalGpa: next } });
        }}
      />
    </>
  );
}
