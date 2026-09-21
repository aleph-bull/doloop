import { levelProgress } from '@doloop/core';
import { Award, Lock } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BACKGROUND_DEFS,
  Button,
  Chip,
  Glass,
  Input,
  Panel,
  ProgressBar,
  resolveTheme,
  Spinner,
  useToast,
} from '@doloop/ui';
import { ErrorPanel } from '../components/ErrorState';
import { RewardShelf } from '../components/RewardShelf';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { keys, useMe, useShop } from '../lib/queries';

export function Achievements() {
  const shop = useShop();
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [breakDate, setBreakDate] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  if (shop.isError)
    return (
      <ErrorPanel
        message={shop.error instanceof Error ? shop.error.message : 'Could not load the shop.'}
        onRetry={() => shop.refetch()}
      />
    );
  if (!shop.data || !me.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );
  const s = shop.data;
  const lp = levelProgress(s.xp);
  const theme = resolveTheme(me.data.user.settings.theme.mode);
  const unlocked = new Map(s.achievements.map((a) => [a.key, a.unlockedAt]));

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast(ok, { tone: 'ok' });
      void qc.invalidateQueries({ queryKey: keys.shop });
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.restDays });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl">Achievements</h1>

      <Glass className="p-5 flex flex-col gap-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular">Level {lp.level}</span>
          <span className="muted tabular">{s.xp} XP</span>
          <span className="flex-1" />
          <span className="muted text-sm tabular">
            {lp.toNext} XP to level {lp.level + 1}
          </span>
        </div>
        <ProgressBar value={lp.ratio} label="Progress to next level" />
        <p className="muted text-sm">
          Levels unlock accent colours (5, 10, 20) and backgrounds (3, 8). XP is only ever earned by
          studying or ticking off a routine — never by buying anything.
        </p>
      </Glass>

      <section className="flex flex-col gap-3" aria-labelledby="badges-h">
        <div className="flex items-baseline gap-3">
          <h2 id="badges-h" className="text-lg flex-1">
            Badges
          </h2>
          <span className="muted text-sm tabular">
            {unlocked.size} of {s.badges.length} unlocked
          </span>
        </div>
        <div className="card-grid">
          {s.badges.map((b) => {
            const at = unlocked.get(b.key);
            return (
              <Panel
                key={b.key}
                className="p-4 flex gap-3 items-start"
                style={{ opacity: at ? 1 : 0.7 }}
              >
                <span
                  className="mt-0.5"
                  style={{ color: at ? 'var(--accent)' : 'var(--fg-subtle)' }}
                  aria-hidden
                >
                  {at ? <Award size={20} /> : <Lock size={20} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{b.name}</div>
                  <div className="muted text-sm">{b.description}</div>
                  {at && <div className="subtle text-xs mt-1">Unlocked {fmtDate(at)}</div>}
                </div>
              </Panel>
            );
          })}
        </div>
      </section>

      <RewardShelf />

      <section className="flex flex-col gap-3" aria-labelledby="shop-h">
        <h2 id="shop-h" className="text-lg">
          Shop
        </h2>
        <p className="muted text-sm">
          Cosmetics and safety nets only. Nothing here inflates XP or streaks.
        </p>
        <div className="card-grid">
          <Panel className="p-4 flex flex-col gap-3">
            <div>
              <div className="font-medium">Streak freeze</div>
              <div className="muted text-sm">
                Covers one missed study day automatically. Hold up to {s.freeze.max}.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Chip tone="neutral">{s.freeze.held} held</Chip>
              <span className="flex-1" />
              <Button
                variant="primary"
                size="sm"
                disabled={s.freeze.held >= s.freeze.max || s.xp < s.freeze.cost}
                loading={busy === 'freeze'}
                onClick={() => run('freeze', api.buyFreeze, 'Freeze added')}
              >
                Buy for {s.freeze.cost} XP
              </Button>
            </div>
          </Panel>

          <Panel className="p-4 flex flex-col gap-3">
            <div>
              <div className="font-medium">Break day</div>
              <div className="muted text-sm">
                A one-off rest day outside your weekly pattern.{' '}
                {s.breakDay.boughtThisMonth > 0
                  ? `Price rises each purchase this month (${s.breakDay.boughtThisMonth} so far).`
                  : 'First one this month is cheapest.'}{' '}
                Hold up to {s.breakDay.max}.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Chip tone="neutral">{s.breakDay.held} held</Chip>
              <span className="flex-1" />
              <Button
                variant="primary"
                size="sm"
                disabled={s.breakDay.held >= s.breakDay.max || s.xp < s.breakDay.cost}
                loading={busy === 'break'}
                onClick={() => run('break', api.buyBreakDay, 'Break day added')}
              >
                Buy for {s.breakDay.cost} XP
              </Button>
            </div>
            {s.breakDay.held > 0 && (
              <div className="flex items-end gap-2">
                <Input
                  label="Apply to"
                  type="date"
                  value={breakDate}
                  onChange={(e) => setBreakDate(e.target.value)}
                  hint={`At least ${s.breakDay.minLeadHours} h ahead. Never retroactive.`}
                />
                <Button
                  size="sm"
                  disabled={!breakDate}
                  loading={busy === 'apply'}
                  onClick={() =>
                    run(
                      'apply',
                      () => api.applyBreakDay(breakDate),
                      `Break day set for ${breakDate}`,
                    )
                  }
                >
                  Apply
                </Button>
              </div>
            )}
          </Panel>
        </div>

        <h3 className="font-medium mt-2">Backgrounds</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {s.backgrounds.map((b) => {
            const def = BACKGROUND_DEFS.find((d) => d.id === b.id);
            return (
              <div key={b.id} className="flex flex-col gap-1">
                <div
                  className="bg-thumb"
                  style={{
                    background: def ? (theme === 'dark' ? def.dark.css : def.light.css) : undefined,
                    cursor: 'default',
                  }}
                  aria-hidden
                >
                  <span className="bg-thumb-label">{b.name}</span>
                </div>
                {b.owned ? (
                  <span className="text-xs muted">Available</span>
                ) : b.costXp !== null ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={s.xp < b.costXp}
                    loading={busy === b.id}
                    onClick={() => run(b.id, () => api.buyBackground(b.id), `${b.name} unlocked`)}
                  >
                    {b.costXp} XP
                  </Button>
                ) : (
                  <span className="text-xs muted">Level {b.minLevel}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
