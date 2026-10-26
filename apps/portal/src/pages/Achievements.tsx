import {
  levelProgress,
  ROLL_GRADIENT_FROM,
  ROLL_TIERS,
  rollOdds,
  rollTierInfo,
  type RollNameChoice,
  type UserSettings,
} from '@komogon/core';
import { Award, ChevronDown, Lock } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  BackgroundThumb,
  Button,
  Chip,
  Glass,
  Input,
  Panel,
  ProgressBar,
  Spinner,
  useToast,
} from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { RewardShelf } from '../components/RewardShelf';
import { RollIndex } from '../components/slot/RollIndex';
import { RollSlot } from '../components/slot/RollSlot';
import { api, type RollRecord, type RollResult } from '../lib/api';
import { useResolvedTheme } from '../lib/appearance';
import { fmtDate } from '../lib/format';
import { keys, useMe, useShop, useUpdateSettings } from '../lib/queries';
import { rollClass } from '../lib/rolls';

export function Achievements() {
  const shop = useShop();
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [breakDate, setBreakDate] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Arriving from a locked background in Settings (#bg-<id>): scroll to it and light it up.
  const ready = !!shop.data && !!me.data;
  useEffect(() => {
    if (!ready) return;
    const id = window.location.hash.slice(1);
    if (!id.startsWith('bg-')) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('is-spotlit');
    const t = window.setTimeout(() => el.classList.remove('is-spotlit'), 2600);
    return () => window.clearTimeout(t);
  }, [ready]);

  const resolvedTheme = useResolvedTheme(me.data?.user.settings);
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
  const theme = resolvedTheme;
  const unlocked = new Map(s.achievements.map((a) => [a.key, a.unlockedAt]));
  // Jack mode's badges show once it is on, or once one is earned; the rolls' once you roll.
  const jackOn = me.data?.user.settings.pomodoro.jackMode ?? false;
  const rolled = (s.rolls?.count ?? 0) > 0;
  const badges = s.badges.filter(
    (b) => (!b.jack || jackOn || unlocked.has(b.key)) && (!b.roll || rolled || unlocked.has(b.key)),
  );

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
      </Glass>

      <RewardShelf />

      <section className="flex flex-col gap-3" aria-labelledby="shop-h">
        <h2 id="shop-h" className="section-title">
          Shop
        </h2>
        <div className="card-grid">
          <Panel className="p-5 flex flex-col gap-3">
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

          <Panel className="p-5 flex flex-col gap-3">
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
          Pick any of these backgrounds in <Link to="/settings#theme">Appearance</Link> to use them.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {s.backgrounds
            .filter((b) => !b.owned)
            .map((b) => (
              <div key={b.id} id={`bg-${b.id}`} className="shop-bg flex flex-col gap-1">
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
      {s.rolls && (
        <Rolls
          record={s.rolls}
          xp={s.xp}
          volume={me.data.user.settings.sounds.enabled ? me.data.user.settings.sounds.volume : 0}
          confetti={me.data.user.settings.effects.confetti !== false}
          choice={me.data.user.settings.rolls}
        />
      )}

      <section className="flex flex-col gap-3" aria-labelledby="badges-h">
        <div className="flex items-baseline gap-3">
          <h2 id="badges-h" className="section-title flex-1">
            Badges
          </h2>
          <span className="ach-count tabular">
            <strong>{unlocked.size}</strong> of {badges.length} unlocked
          </span>
        </div>
        <BadgeFold count={badges.length}>
          {badges.map((b) => {
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
                <span
                  className="badge-xp tabular"
                  title={at ? `Earned ${b.xp} XP` : `Earns ${b.xp} XP`}
                >
                  {at ? '' : '+'}
                  {b.xp} XP
                </span>
              </Panel>
            );
          })}
        </BadgeFold>
      </section>
    </div>
  );
}

/**
 * RNG Rolls: your rarest roll, every rarity with how often it came up, the button that opens
 * the slot machine, and in small text what your profile and your name show. Each pull is
 * written straight into the shop's cached copy; the rest of the page (badges, level) catches
 * up when the machine closes.
 */
function Rolls({
  record,
  xp,
  volume,
  confetti,
  choice,
}: {
  record: RollRecord;
  xp: number;
  volume: number;
  confetti: boolean;
  choice: UserSettings['rolls'];
}) {
  const qc = useQueryClient();
  const update = useUpdateSettings();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const best = rollTierInfo(record.best);
  const save = (rolls: Partial<UserSettings['rolls']>) =>
    update
      .mutateAsync({ rolls })
      .catch((err) => toast(err instanceof Error ? err.message : 'Could not save'));
  // The styles a name can wear: from 1/32 up to the rarest roll.
  const styles = ROLL_TIERS.filter((t) => t.tier >= ROLL_GRADIENT_FROM && t.tier <= record.best);

  const rolled = (r: RollResult) =>
    qc.setQueryData<Awaited<ReturnType<typeof api.shop>>>(keys.shop, (shop) => {
      if (!shop?.rolls) return shop;
      const counts = [...shop.rolls.counts];
      for (const t of r.tiers ?? [r.tier]) counts[t - 1] = (counts[t - 1] ?? 0) + 1;
      return { ...shop, xp: r.xp, rolls: { ...shop.rolls, best: r.best, count: r.count, counts } };
    });
  const close = () => {
    setOpen(false);
    void qc.invalidateQueries({ queryKey: keys.shop });
    void qc.invalidateQueries({ queryKey: keys.me });
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="rolls-h">
      <h2 id="rolls-h" className="section-title">
        RNG Rolls
      </h2>
      <Panel className="rng-card">
        <div className="rng-head">
          <div className="rng-best">
            <span className="rng-label">Rarest</span>
            <span className={`rng-best-title${best ? ` ${rollClass(best.tier)}` : ''}`}>
              {best ? best.title : 'Nothing yet'}
            </span>
            {best && (
              <span className="rng-best-meta tabular">
                {rollOdds(best.tier)} · {record.count.toLocaleString()}{' '}
                {record.count === 1 ? 'roll' : 'rolls'}
              </span>
            )}
          </div>
          <Button variant="primary" disabled={xp < record.cost} onClick={() => setOpen(true)}>
            Roll for {record.cost} XP
          </Button>
        </div>
        <RollIndex counts={record.counts} best={record.best} />
        <div className="rng-options">
          <label className="rng-option">
            <input
              type="checkbox"
              checked={choice.profile}
              onChange={(e) => void save({ profile: e.target.checked })}
            />
            Show on my profile
          </label>
          {styles.length > 0 && (
            <label className="rng-option">
              Name
              <select
                className="rng-select"
                value={String(choice.name)}
                onChange={(e) => {
                  const v = e.target.value;
                  void save({
                    name: (v === 'auto' || v === 'off' ? v : Number(v)) as RollNameChoice,
                  });
                }}
              >
                <option value="auto">Auto</option>
                <option value="off">Plain</option>
                {styles.map((t) => (
                  <option key={t.tier} value={t.tier}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Panel>
      {open && (
        <RollSlot
          cost={record.cost}
          xp={xp}
          best={record.best}
          volume={volume}
          confetti={confetti}
          onRolled={rolled}
          onClose={close}
        />
      )}
    </section>
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
      // The second row carries the fold's fade itself (see .badge-fold in index.css).
      cards.forEach((c, i) =>
        c.toggleAttribute('data-fold-edge', !!second && Math.abs(rects[i]!.top - second.top) < 1),
      );
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

  // On opening, the badges that were hidden rise into place in a quick cascade,
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
