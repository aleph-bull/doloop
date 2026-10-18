import { levelProgress } from '@komogon/core';
import { Award, ChevronDown, Lock } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BackgroundThumb,
  Button,
  Chip,
  Glass,
  Input,
  Panel,
  ProgressBar,
  resolveTheme,
  Spinner,
  useToast,
} from '@komogon/ui';
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
      <h1 className="page-title">Achievements</h1>

      <Glass className="ach-hero">
        <div className="ach-hero-top">
          <div>
            <span className="ach-hero-label">Level</span>
            <span className="ach-hero-level tabular">{lp.level}</span>
          </div>
          <div className="ach-hero-xp">
            <span className="tabular">{s.xp.toLocaleString()}</span> XP
          </div>
        </div>
        <ProgressBar value={lp.ratio} label="Progress to next level" className="ach-hero-bar" />
        <div className="ach-hero-row tabular">
          <span>Level {lp.level}</span>
          <span>
            <strong>{lp.toNext} XP</strong> to level {lp.level + 1}
          </span>
        </div>
        <p className="ach-hero-note">
          Levels unlock backgrounds (3, 5, 8, 12), and every accent colour is free. XP is only ever
          earned by studying or ticking off a routine — never by buying anything.
        </p>
      </Glass>

      <RewardShelf />

      <section className="flex flex-col gap-3" aria-labelledby="shop-h">
        <h2 id="shop-h" className="section-title">
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

        <h3 className="card-title mt-4">Backgrounds</h3>
        <p className="muted text-sm">
          Most are free. These are the ones still to unlock — pick any of them in Settings once they
          are yours.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {s.backgrounds
            .filter((b) => !b.owned)
            .map((b) => (
              <div key={b.id} className="flex flex-col gap-1">
                <BackgroundThumb id={b.id} theme={theme} label={b.name} disabled />
                {b.costXp !== null ? (
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
            ))}
          {s.backgrounds.every((b) => b.owned) && (
            <p className="muted text-sm">Every background is unlocked.</p>
          )}
        </div>
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="badges-h">
        <div className="flex items-baseline gap-3">
          <h2 id="badges-h" className="section-title flex-1">
            Badges
          </h2>
          <span className="ach-count tabular">
            <strong>{unlocked.size}</strong> of {s.badges.length} unlocked
          </span>
        </div>
        <BadgeFold count={s.badges.length}>
          {s.badges.map((b) => {
            const at = unlocked.get(b.key);
            return (
              <Panel key={b.key} className={`badge-card${at ? ' is-earned' : ''}`}>
                <span className="badge-medal" aria-hidden>
                  {at ? <Award size={20} /> : <Lock size={16} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="badge-name">{b.name}</div>
                  <div className="badge-desc">{b.description}</div>
                  {at && <div className="badge-when">Unlocked {fmtDate(at)}</div>}
                </div>
              </Panel>
            );
          })}
        </BadgeFold>
      </section>
    </div>
  );
}

/**
 * The badge grid, folded: the first row in full and the second fading out, so the page
 * isn't a wall of forty cards. "Show all" grows it to its full height.
 */
function BadgeFold({ count, children }: { count: number; children: ReactNode }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [heights, setHeights] = useState<{ folded: number; full: number } | null>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const cards = Array.from(grid.children) as HTMLElement[];
      const top = grid.getBoundingClientRect().top;
      const rects = cards.map((c) => c.getBoundingClientRect());
      const first = rects[0];
      // The first card of the second row: the first one sitting lower than card one.
      const second = rects.find((r) => first && r.top > first.top + 1);
      if (!first || !second) return setHeights(null);
      setHeights({
        folded: Math.round(second.top - top + second.height * 0.6),
        full: grid.scrollHeight,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, []);

  const folds = heights !== null && heights.full > heights.folded + 4;

  // On opening, the badges that were hidden fade and rise into place in a quick cascade,
  // top to bottom, while the fold grows; the ones already on show stay put.
  const toggle = () => {
    const grid = gridRef.current;
    if (grid && !open && heights) {
      const top = grid.getBoundingClientRect().top;
      let n = 0;
      for (const card of Array.from(grid.children) as HTMLElement[]) {
        if (card.getBoundingClientRect().top - top < heights.folded - 1) continue;
        card.style.setProperty('--reveal-i', String(n++));
        card.classList.remove('is-revealing');
        // Restart the animation if the fold is opened again.
        void card.offsetWidth;
        card.classList.add('is-revealing');
      }
    }
    setOpen((o) => !o);
  };
  return (
    <>
      <div
        className={`badge-fold${folds && !open ? ' is-folded' : ''}`}
        style={folds ? { height: open ? heights.full : heights.folded } : undefined}
      >
        <div ref={gridRef} className="badge-grid" inert={folds && !open ? true : undefined}>
          {children}
        </div>
      </div>
      {folds && (
        <button type="button" className="badge-fold-toggle" aria-expanded={open} onClick={toggle}>
          {open ? 'Show fewer' : `Show all ${count} badges`}
          <ChevronDown size={16} aria-hidden className="badge-fold-chevron" />
        </button>
      )}
    </>
  );
}
