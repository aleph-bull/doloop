import type { RewardUnlock, RewardView, StudyNode } from '@komogon/core';
import { useMemo, useState } from 'react';
import { Button, Input, Modal, Segmented, Select, Textarea } from '@komogon/ui';
import type { RewardInput } from '../lib/api';
import { useNodes } from '../lib/queries';

export interface RewardDialogProps {
  open: boolean;
  /** The reward being edited, or null to create a new one. */
  reward: RewardView | null;
  limits: { minCostXp: number; maxCostXp: number; maxCooldownDays: number };
  onClose: () => void;
  onSave: (input: RewardInput) => Promise<unknown>;
}

const SUGGESTIONS = ['🎮', '📱', '🍰', '🎧', '🧥', '🛌', '🍿', '⚽', '🎁'];

/** Open tasks and tests, grouped under their course, plus the one already linked. */
function useTaskChoices(keepId: string | null) {
  const nodes = useNodes();
  return useMemo(() => {
    const all = nodes.data?.nodes ?? [];
    const byId = new Map(all.map((n) => [n.id, n]));
    const courseOf = (n: StudyNode): string => {
      let cur: StudyNode | undefined = n;
      while (cur?.parentId) cur = byId.get(cur.parentId);
      return cur && cur.id !== n.id ? cur.title : 'Other';
    };
    const groups = new Map<string, StudyNode[]>();
    for (const n of all) {
      if (n.kind === 'course' || n.archived) continue;
      if (n.completedAt && n.id !== keepId) continue;
      const g = courseOf(n);
      groups.set(g, [...(groups.get(g) ?? []), n]);
    }
    return [...groups.entries()];
  }, [nodes.data, keepId]);
}

export function RewardDialog({ open, reward, limits, onClose, onSave }: RewardDialogProps) {
  const [name, setName] = useState(reward?.name ?? '');
  const [note, setNote] = useState(reward?.note ?? '');
  const [emoji, setEmoji] = useState(reward?.emoji ?? '');
  const [cost, setCost] = useState(String(reward?.costXp ?? limits.minCostXp));
  const [cooldown, setCooldown] = useState(String(reward?.cooldownDays ?? 0));
  const [unlock, setUnlock] = useState<RewardUnlock>(reward?.unlock ?? 'xp');
  const [taskId, setTaskId] = useState(reward?.unlockNodeId ?? '');
  const taskGroups = useTaskChoices(reward?.unlockNodeId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const costNum = Number(cost);
  const costInvalid =
    !Number.isInteger(costNum) || costNum < limits.minCostXp || costNum > limits.maxCostXp;

  const save = async () => {
    if (!name.trim()) return setError('Give the reward a name.');
    if (unlock === 'task' && !taskId) return setError('Pick the task that unlocks it.');
    if (unlock === 'xp' && costInvalid)
      return setError(`The price must be a whole number from ${limits.minCostXp} XP up.`);
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        note: note.trim() || null,
        emoji: emoji.trim() || null,
        ...(unlock === 'task'
          ? { unlock, unlockNodeId: taskId, costXp: 0, cooldownDays: 0 }
          : { unlock, unlockNodeId: null, costXp: costNum, cooldownDays: Number(cooldown) || 0 }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the reward.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Modal
      phone="full"
      open
      onClose={onClose}
      title={reward ? 'Edit reward' : 'New reward'}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {reward ? 'Save' : 'Add reward'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="What is it?"
          placeholder="An hour of doomscrolling"
          value={name}
          autoFocus
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="field">
          <span className="field-label">Icon</span>
          <div className="pill-row items-center">
            {SUGGESTIONS.map((g) => (
              <button
                key={g}
                type="button"
                className="emoji-pick"
                aria-label={`Use ${g}`}
                aria-pressed={emoji === g}
                onClick={() => setEmoji(emoji === g ? '' : g)}
              >
                {g}
              </button>
            ))}
            <Input
              aria-label="Custom icon"
              className="emoji-input"
              value={emoji}
              maxLength={8}
              onChange={(e) => setEmoji(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <span className="field-label">How you earn it</span>
          <Segmented
            ariaLabel="How you earn it"
            value={unlock}
            onChange={(v) => setUnlock(v as RewardUnlock)}
            options={[
              { value: 'xp', label: 'Spend XP' },
              { value: 'task', label: 'Finish a task' },
            ]}
          />
        </div>
        {unlock === 'task' ? (
          <Select
            label="Unlocks when this is done"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            hint="Mark it done in Tasks and the reward opens. It can be redeemed once."
          >
            <option value="" disabled>
              Choose a task or test
            </option>
            {taskGroups.map(([course, list]) => (
              <optgroup key={course} label={course}>
                {list.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Price (XP)"
              type="number"
              min={limits.minCostXp}
              max={limits.maxCostXp}
              step={10}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              hint={`At least ${limits.minCostXp} XP. 150 XP takes about an hour of focus.`}
            />
            <Input
              label="Cooldown (days)"
              type="number"
              min={0}
              max={limits.maxCooldownDays}
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value)}
              hint="0 means whenever you can afford it."
            />
          </div>
        )}
        <Textarea
          label="Note"
          placeholder="Optional — the grey one, size M"
          value={note}
          rows={2}
          maxLength={280}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && (
          <p className="text-sm" style={{ color: 'var(--status-bad)' }} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
