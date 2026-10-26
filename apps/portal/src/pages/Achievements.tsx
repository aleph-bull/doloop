import {
  levelProgress,
  ROLL_NAME_TIER,
  ROLL_TIERS,
  rollOdds,
  rollTierInfo,
  type RollNameChoice,
  type UserSettings,
} from '@komogon/core';
import { Award, Check, ChevronDown, Lock } from 'lucide-react';
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
import { CountingNumber, usePurchase } from '../components/Purchase';
import { RewardShelf } from '../components/RewardShelf';
import { RollIndex } from '../components/slot/RollIndex';
import { RollSlot } from '../components/slot/RollSlot';
import { api, type RollRecord, type RollResult } from '../lib/api';
import { useResolvedTheme } from '../lib/appearance';
import { fmtDate } from '../lib/format';
import { keys, useMe, useShop, useUpdateSettings } from '../lib/queries';
import { rollClass } from '../lib/rolls';

type ShopData = Awaited<ReturnType<typeof api.shop>>;

export function Achievements() {
  const shop = useShop();
  const me = useMe();
  const qc = useQueryClient();
  const update = useUpdateSettings();
  const { toast } = useToast();
  const [breakDate, setBreakDate] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const sounds = me.data?.user.settings.sounds;
  const { wallet, walletRef, fresh, said, buy } = usePurchase(
    shop.data?.xp ?? 0,
    sounds?.enabled ? sounds.volume : 0,
  );
  /** Backgrounds bought on this visit stay where they were, lit up, with Use it. */
  const [kept, setKept] = useState<string[]>([]);
  // Sent here from a locked background in Settings: its fold starts open.
  const [fromSettings] = useState(() => window.location.hash.startsWith('#bg-'));

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
  const lp = levelProgress(wallet);
  const theme = resolvedTheme;
  const unlocked = new Map(s.achievements.map((a) => [a.key, a.unlockedAt]));
  // Locked ones, and the ones bought on this visit (they stay, lit up, with Use it).
  const shopBackgrounds = s.backgrounds.filter((b) => !b.owned || kept.includes(b.id));
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

  /** What a purchase changed, written in as its last coin lands. */
  const patchShop = (fn: (d: ShopData) => ShopData) =>
    qc.setQueryData<ShopData>(keys.shop, (d) => (d ? fn(d) : d));
  const settle = () => {
    void qc.invalidateQueries({ queryKey: keys.shop });
    void qc.invalidateQueries({ queryKey: keys.me });
    void qc.invalidateQueries({ queryKey: keys.restDays });
  };
  const chosen = me.data.user.settings.theme;
  const pickBackground = (id: string) =>
    update
      .mutateAsync({ theme: { backgroundId: id, customBackgroundUrl: null } })
      .catch((err) => toast(err instanceof Error ? err.message : 'Could not save'));

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
            <CountingNumber ref={walletRef} value={wallet} className="ach-hero-xp-n tabular" /> XP
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

      <RewardShelf buy={buy} />

      <section className="flex flex-col gap-3" aria-labelledby="shop-h">
        <h2 id="shop-h" className="section-title">
          Shop
        </h2>
        <p className="sr-only" aria-live="polite">
          {said}
        </p>
        <div className="card-grid">
          <Panel id="shop-freeze" className="p-5 flex flex-col gap-3">
            <div>
              <div className="font-medium">Streak freeze</div>
              <div className="muted text-sm">
                Covers one missed study day automatically. Hold up to {s.freeze.max}.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Chip
                key={s.freeze.held}
                tone="neutral"
                className={fresh === 'freeze' ? 'buy-count' : undefined}
              >
                {s.freeze.held} held
              </Chip>
              <span className="flex-1" />
              <BuyButton
                added={fresh === 'freeze'}
                disabled={s.freeze.held >= s.freeze.max || s.xp < s.freeze.cost}
                onClick={() =>
                  void buy({
                    key: 'freeze',
                    cost: s.freeze.cost,
                    card: '#shop-freeze',
                    goal: '.chip',
                    float: '+1',
                    said: 'Freeze added',
                    call: api.buyFreeze,
                    apply: (r) =>
                      patchShop((d) => ({
                        ...d,
                        xp: r.xp,
                        freeze: { ...d.freeze, held: d.freeze.held + 1 },
                      })),
                  }).then(settle)
                }
              >
                Buy for {s.freeze.cost} XP
              </BuyButton>
            </div>
          </Panel>

          <Panel id="shop-break" className="p-5 flex flex-col gap-3">
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
              <Chip
                key={s.breakDay.held}
                tone="neutral"
                className={fresh === 'break' ? 'buy-count' : undefined}
              >
                {s.breakDay.held} held
              </Chip>
              <span className="flex-1" />
              <BuyButton
                added={fresh === 'break'}
                disabled={s.breakDay.held >= s.breakDay.max || s.xp < s.breakDay.cost}
                onClick={() =>
                  void buy({
                    key: 'break',
                    cost: s.breakDay.cost,
                    card: '#shop-break',
                    goal: '.chip',
                    float: '+1',
                    said: 'Break day added',
                    call: api.buyBreakDay,
                    apply: (r) =>
                      patchShop((d) => ({
                        ...d,
                        xp: r.xp,
                        breakDay: {
                          ...d.breakDay,
                          held: d.breakDay.held + 1,
                          boughtThisMonth: d.breakDay.boughtThisMonth + 1,
                          cost: r.nextCost,
                        },
                      })),
                  }).then(settle)
                }
              >
                Buy for {s.breakDay.cost} XP
              </BuyButton>
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
        {/* Folded on entry; open when Settings sent you to one of them (#bg-<id>). */}
        <Fold
          label={`Show all ${shopBackgrounds.length} backgrounds`}
          gridClassName="grid grid-cols-2 sm:grid-cols-5 gap-3"
          startOpen={fromSettings}
        >
          {shopBackgrounds.map((b) => {
            const using = b.owned && chosen.backgroundId === b.id && !chosen.customBackgroundUrl;
            const cost = b.costXp;
            return (
              <div key={b.id} id={`bg-${b.id}`} className="shop-bg flex flex-col gap-1">
                <BackgroundThumb
                  id={b.id}
                  theme={theme}
                  label={b.name}
                  disabled={!b.owned}
                  selected={using}
                  className={b.owned ? 'is-unlocked' : undefined}
                  onClick={b.owned ? () => void pickBackground(b.id) : undefined}
                />
                {b.owned ? (
                  <Button
                    size="sm"
                    variant={using ? 'secondary' : 'primary'}
                    disabled={using}
                    onClick={() => void pickBackground(b.id)}
                  >
                    {using ? 'In use' : 'Use it'}
                  </Button>
                ) : cost !== null ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={s.xp < cost}
                    onClick={() =>
                      void buy({
                        key: b.id,
                        cost,
                        card: `#bg-${b.id}`,
                        goal: '.bg-thumb',
                        said: `${b.name} unlocked`,
                        call: () => api.buyBackground(b.id),
                        apply: (r) => {
                          setKept((k) => [...k, b.id]);
                          patchShop((d) => ({
                            ...d,
                            xp: r.xp,
                            backgrounds: d.backgrounds.map((x) =>
                              x.id === b.id ? { ...x, owned: true } : x,
                            ),
                          }));
                        },
                      }).then(settle)
                    }
                  >
                    {cost} XP
                  </Button>
                ) : (
                  <span className="text-xs muted">Level {b.minLevel}</span>
                )}
              </div>
            );
          })}
        </Fold>
        {shopBackgrounds.length === 0 && (
          <p className="muted text-sm">Every background is unlocked.</p>
        )}
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
        <Fold label={`Show all ${badges.length} badges`} gridClassName="badge-grid">
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
        </Fold>
      </section>
    </div>
  );
}

/**
 * A shop item's Buy button. For a moment after its coins land it says Added, at the same
 * width (both labels sit in one cell, one hidden).
 */
function BuyButton({
  added,
  disabled,
  onClick,
  children,
}: {
  added: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="primary"
      size="sm"
      className="buy-btn"
      disabled={disabled && !added}
      onClick={added ? undefined : onClick}
    >
      <span className="buy-btn-face" data-shown={!added || undefined} aria-hidden={added}>
        {children}
      </span>
      <span className="buy-btn-face is-added" data-shown={added || undefined} aria-hidden={!added}>
        <Check size={15} aria-hidden /> Added
      </span>
    </Button>
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
  // The looks a name can wear: from Sapphire (1/256) up to the rarest roll.
  const styles = ROLL_TIERS.filter((t) => t.tier >= ROLL_NAME_TIER && t.tier <= record.best);

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
 * A grid folded: the first row in full and the second fading out, so the page isn't a wall
 * of forty cards. "Show all" (`label`) grows it to its full height. The badges and the shop's
 * backgrounds both start folded.
 */
function Fold({
  label,
  gridClassName,
  startOpen = false,
  children,
}: {
  label: string;
  gridClassName: string;
  startOpen?: boolean;
  children: ReactNode;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(startOpen);
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
        <div ref={gridRef} className={gridClassName} inert={folds && !open ? true : undefined}>
          {children}
        </div>
      </div>
      {folds && (
        <button type="button" className="badge-fold-toggle" aria-expanded={open} onClick={toggle}>
          {open ? 'Show fewer' : label}
          <ChevronDown size={16} aria-hidden className="badge-fold-chevron" />
        </button>
      )}
    </>
  );
}
