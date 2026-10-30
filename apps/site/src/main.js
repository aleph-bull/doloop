// Motion for the homepage. The hero lifts in on load, devices and all, with two stickers of the
// app leaning away from the pointer, and each section rises as it scrolls into view. Nothing
// pins: the floating timelapses drift a little slower than the page and the drum of looks
// turns on its own ([data-scrub]). The phones move on springs and open like a hand of cards,
// the app's four parts play one after another in one window, and pills down the left show
// where you are. Nothing here is needed to read the page; without it everything lays out flat,
// and on a phone it stays flat on purpose.

const root = document.documentElement;
const still =
  root.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (t) => 1 - (1 - t) ** 3;
/** How far `v` is from `a` to `b`, as 0 to 1. */
const range = (v, a, b) => clamp((v - a) / (b - a));

if (!still && 'IntersectionObserver' in window) {
  root.classList.add('has-motion');
  const items = [...document.querySelectorAll('.rise')];
  const inHero = (el) => el.closest('.hero') !== null;

  // Above the fold: everything comes in on load, each with its own delay.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const el of items) if (inHero(el)) el.classList.add('is-in');
    }),
  );

  // Below: in when they arrive, siblings staggering by their own --d.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
  );
  for (const el of items) if (!inHero(el)) io.observe(el);
}

// ---------- Scroll scenes ----------

/** A word in the looks' last line, scrambled through random letters on its way to the next. */
function scrambler(el) {
  const words = el.dataset.words.split(',');
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let shown = el.textContent;
  let raf = 0;
  const to = (i) => {
    const target = words[clamp(i, 0, words.length - 1)];
    if (target === shown) return;
    shown = target;
    cancelAnimationFrame(raf);
    const start = performance.now();
    el.classList.add('is-scrambling');
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 480);
      const fixed = Math.floor(t * target.length);
      let out = target.slice(0, fixed);
      for (let k = fixed; k < target.length; k++) out += letters[(Math.random() * 26) | 0];
      el.textContent = out;
      if (t < 1) raf = requestAnimationFrame(tick);
      else el.classList.remove('is-scrambling');
    };
    raf = requestAnimationFrame(tick);
  };
  /** Straight to the first word, as the page reads without the scene. */
  const rest = () => {
    cancelAnimationFrame(raf);
    shown = words[0];
    el.textContent = shown;
    el.classList.remove('is-scrambling');
  };
  return { to, rest, count: words.length };
}

/*
 * The ring of looks, like the inside of a drum: small cards in a strip across the middle,
 * growing and turning to face inward as they reach the sides. Each card sits at a place `u`
 * along the arc (-1 at the left edge, 0 in the middle, 1 at the right). The drum turns on
 * its own while it's on screen, right to left, and those leaving one side come back on the
 * other; scrolling gives it a push that eases off. The cards fan out from the middle as the
 * card comes up the screen, and the last line's word changes every few seconds.
 */
function ringScene(scene) {
  const view = scene.querySelector('.ring-view');
  const cards = [...scene.querySelectorAll('.ring-card')];
  const word = scrambler(scene.querySelector('.scramble'));
  const SPAN = 2.6;
  // Arc per second on its own: a card's width about every second and a half.
  const CRUISE = 0.11;
  let W = window.innerWidth;
  // How far the cards spread (a share of the width) and how much they grow toward the sides.
  // A phone gets bigger cards in the middle and a gentler spread, or they'd be specks.
  let spread = 0.6;
  let grow = [0.36, 1.45];
  let fan = 0.06;
  let slide = 0;
  let push = 0;
  let lastThrough = null;
  let wordClock = 0;
  let wordAt = 0;
  let raf = 0;
  let last = 0;
  let onScreen = false;
  let live = false;

  const measure = () => {
    W = view.clientWidth || window.innerWidth;
    const phone = W < 640;
    spread = phone ? 0.5 : 0.6;
    grow = phone ? [0.42, 0.8] : [0.36, 1.45];
    scene.style.setProperty('--cw', `${phone ? W * 0.6 : Math.max(150, W * 0.19)}px`);
  };

  const draw = () => {
    for (let i = 0; i < cards.length; i++) {
      const u = (((((i / cards.length) * SPAN - slide) % SPAN) + SPAN) % SPAN) - SPAN / 2;
      const seen = 1 - range(Math.abs(u), 1.02, 1.2);
      const card = cards[i];
      card.style.opacity = seen.toFixed(3);
      card.style.visibility = seen > 0 ? 'visible' : 'hidden';
      if (seen <= 0) continue;
      const f = u * fan;
      const a = Math.abs(f);
      const x = Math.sign(f) * W * spread * a ** 1.4;
      const s = grow[0] + grow[1] * a ** 2;
      card.style.zIndex = String(Math.round(a * 100));
      card.style.transform = `translateX(${x.toFixed(1)}px) perspective(1100px) rotateY(${(-f * 58).toFixed(2)}deg) scale(${s.toFixed(3)})`;
    }
  };

  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    slide += dt * (CRUISE + push);
    push *= Math.exp(-dt * 2.2);
    wordClock += dt;
    if (wordClock > 2.8) {
      wordClock = 0;
      wordAt = (wordAt + 1) % word.count;
      word.to(wordAt);
    }
    draw();
    if (live && onScreen) raf = requestAnimationFrame(tick);
    else last = 0;
  };
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (live && onScreen && !raf) raf = requestAnimationFrame(tick);
  }).observe(scene);

  return {
    measure,
    update(enter, through) {
      fan = 0.06 + 0.94 * ease(range(enter, 0.3, 0.95));
      if (lastThrough !== null) push = clamp(push + (through - lastThrough) * 12, -1.2, 1.2);
      lastThrough = through;
      if (!onScreen) draw();
    },
    start() {
      live = true;
      if (onScreen && !raf) raf = requestAnimationFrame(tick);
    },
    stop() {
      live = false;
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      lastThrough = null;
      push = 0;
      wordClock = 0;
      wordAt = 0;
      word.rest();
      for (const card of cards) {
        for (const prop of ['opacity', 'visibility', 'z-index', 'transform']) {
          card.style.removeProperty(prop);
        }
      }
    },
  };
}

/*
 * The floating timelapses. Each card has a place the scroll gives it (from --y, falling by
 * --v, in vh, turning by --dr, as the band goes by) but doesn't snap there: it drifts toward
 * it a beat behind, like something settling in water, and sways, bobs and tilts a little on
 * its own clock, so it keeps moving when the page stops. Falling as the band rises, the cards
 * go by slower than the page, as if farther off. The loop runs only while it's on screen.
 */
function fallScene(scene) {
  const cards = [...scene.querySelectorAll('.floater')].map((el, i) => {
    const css = getComputedStyle(el);
    const num = (name) => parseFloat(css.getPropertyValue(name)) || 0;
    return {
      el,
      y: num('--y'),
      v: num('--v'),
      r: num('--r'),
      dr: num('--dr'),
      // Small cards read as farther away: they settle slower and sway less.
      near: Math.min(1, num('--w') / 280),
      phase: i * 2.17,
      rate: 0.32 + ((i * 7) % 5) * 0.06,
      at: null,
    };
  });
  let target = 0.5;
  let raf = 0;
  let onScreen = false;
  let live = false;
  const tick = (now) => {
    raf = 0;
    const t = now / 1000;
    const vh = window.innerHeight / 100;
    for (const c of cards) {
      const goal = c.y + target * c.v;
      c.at = c.at === null ? goal : c.at + (goal - c.at) * (0.035 + 0.04 * c.near);
      const w = t * c.rate + c.phase;
      const x = Math.sin(w) * 16 * c.near;
      const y = c.at * vh + Math.sin(w * 0.8 + 1.3) * 10;
      const turn = c.r + target * c.dr + Math.sin(w * 0.6) * 2.4;
      const tilt = Math.sin(w * 0.5 + 0.7) * 9;
      c.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) perspective(1000px) rotateY(${tilt.toFixed(2)}deg) rotate(${turn.toFixed(2)}deg)`;
    }
    if (live && onScreen) raf = requestAnimationFrame(tick);
  };
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (live && onScreen && !raf) raf = requestAnimationFrame(tick);
  }).observe(scene);
  return {
    update(enter, through) {
      target = 0.2 + 0.6 * through;
    },
    start() {
      live = true;
      if (onScreen && !raf) raf = requestAnimationFrame(tick);
    },
    stop() {
      live = false;
      cancelAnimationFrame(raf);
      raf = 0;
      for (const c of cards) {
        c.at = null;
        c.el.style.removeProperty('transform');
      }
    },
  };
}

// Everything a scene writes on its own element; cleared when the scenes turn off.
const SCENE_VARS = ['--cw'];

if (!still) {
  const scenes = [...document.querySelectorAll('[data-scrub]')].map((el) => {
    const kind = el.dataset.scrub;
    const scene = { el, kind };
    if (kind === 'looks') Object.assign(scene, ringScene(el));
    else if (kind === 'fall') Object.assign(scene, fallScene(el));
    return scene;
  });

  let queued = false;
  let on = false;
  const frame = () => {
    queued = false;
    if (!on) return;
    const vh = window.innerHeight;
    for (const s of scenes) {
      const r = s.el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;
      // enter: 0 to 1 as it comes up the screen; through: 0 to 1 from its top reaching the
      // bottom to its bottom leaving the top.
      const enter = clamp((vh - r.top) / vh);
      const through = clamp((vh - r.top) / (vh + r.height));
      s.update?.(enter, through);
    }
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  };
  const measure = () => {
    if (!on) return;
    for (const s of scenes) s.measure?.();
    queue();
  };

  // A phone gets the page flat (the owner, 2026-10-28): the scenes stay off, and each section
  // is its words then its pictures, laid out by the CSS under the same query (change both
  // together). A window dragged across the line switches between the two as it goes.
  const flat = window.matchMedia('(max-width: 640px), (max-height: 500px)');
  const apply = () => {
    if (on === !flat.matches) return;
    on = !flat.matches;
    root.classList.toggle('has-scrub', on);
    for (const s of scenes) {
      if (on) {
        s.start?.();
        continue;
      }
      s.stop?.();
      for (const name of SCENE_VARS) s.el.style.removeProperty(name);
    }
    if (on) {
      measure();
      frame();
    }
  };
  apply();
  flat.addEventListener('change', apply);
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', measure);
}

// ---------- The hero's stickers ----------

// They lean away from the pointer, a beat behind it.
const stickers = document.querySelector('.stickers');
if (!still && stickers && window.matchMedia('(hover: hover)').matches) {
  const hero = stickers.closest('.hero');
  let to = [0, 0];
  let at = [0, 0];
  let raf = 0;
  const step = () => {
    raf = 0;
    at = [at[0] + (to[0] - at[0]) * 0.08, at[1] + (to[1] - at[1]) * 0.08];
    stickers.style.setProperty('--mx', at[0].toFixed(3));
    stickers.style.setProperty('--my', at[1].toFixed(3));
    if (Math.abs(to[0] - at[0]) + Math.abs(to[1] - at[1]) > 0.002) {
      raf = requestAnimationFrame(step);
    }
  };
  const aim = (x, y) => {
    to = [x, y];
    if (!raf) raf = requestAnimationFrame(step);
  };
  hero.addEventListener('pointermove', (e) =>
    aim((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1),
  );
  hero.addEventListener('pointerleave', () => aim(0, 0));
}

// ---------- Timelapses ----------

// The timelapses and the phones' screens play while they're on screen and pause off it, so
// they load only when someone gets that far. With reduced motion they wait on their poster,
// with controls unless they're inside a button. The app's four recordings play one at a time
// (below).
const clips = [...document.querySelectorAll('video.clip')];
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const v of clips) if (!v.closest('button')) v.controls = true;
} else if ('IntersectionObserver' in window) {
  const watch = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) e.target.play().catch(() => {});
        else e.target.pause();
      }
    },
    { threshold: 0.25 },
  );
  for (const v of clips) watch.observe(v);
} else {
  for (const v of clips) v.play().catch(() => {});
}

// No picture-in-picture. The attribute covers Chrome and Edge; Safari ignores it, so any
// video that gets popped out anyway goes straight back into the page.
for (const v of document.querySelectorAll('video')) {
  v.disablePictureInPicture = true;
  v.addEventListener('enterpictureinpicture', () =>
    document.exitPictureInPicture().catch(() => {}),
  );
  v.addEventListener('webkitpresentationmodechanged', () => {
    if (v.webkitPresentationMode === 'picture-in-picture') v.webkitSetPresentationMode('inline');
  });
}

// ---------- The phones ----------

/*
 * The row of phones, on springs. As the row comes up the screen the phones fan out from a
 * stack in the middle; the row leans a little toward the pointer, each phone floats on its own
 * slow clock, and the one pointed at (or focused) rises and straightens while its neighbours
 * lean out of its way. With one picked (data-picked on the rail, set below) it moves to the
 * left and grows, and the rest drop down to the foot of the rail like a hand of cards held
 * low, the one pointed at peeking up. On a phone the row is a strip to swipe through instead,
 * and the phone nearest the middle is the biggest.
 */
function phoneRow(row) {
  const rail = row.closest('.phones-rail') ?? row;
  const items = [...row.querySelectorAll('.phones-item')];
  const phones = items.map((li) => li.querySelector('.phones-phone'));
  const mid = (items.length - 1) / 2;
  const swipe = window.matchMedia('(max-width: 640px)');
  // Stiffness and damping: a little overshoot, then still.
  const K = 170;
  const C = 17;
  /** Each phone's spring for x, y (px), turn (deg) and scale: [value, velocity]. */
  const springs = phones.map(() => ({ x: [0, 0], y: [0, 0], r: [0, 0], s: [1, 0] }));
  /** Each phone at rest in the row: its middle from the row's, its top, width and height. */
  let rest = phones.map(() => ({ cx: 0, top: 0, w: 1, h: 1 }));
  let W = 1;
  let foot = 0;
  let hover = -1;
  let lean = [0, 0];
  let leanTo = [0, 0];
  let raf = 0;
  let last = 0;
  let fresh = true;
  let onScreen = false;
  let mode = '';

  const picked = () => (rail.dataset.picked === undefined ? -1 : Number(rail.dataset.picked));
  const put = (i, x, y, r, s) => {
    const st = phones[i].style;
    st.setProperty('--x', `${x.toFixed(1)}px`);
    st.setProperty('--y', `${y.toFixed(1)}px`);
    st.setProperty('--r', `${r.toFixed(2)}deg`);
    st.setProperty('--s', s.toFixed(4));
  };
  const clear = () => {
    for (const p of phones) for (const v of ['--x', '--y', '--r', '--s']) p.style.removeProperty(v);
    for (const li of items) li.style.zIndex = '';
  };
  const measure = () => {
    const box = row.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    W = box.width;
    foot = rail.getBoundingClientRect().bottom - box.top;
    rest = items.map((li) => {
      const b = li.getBoundingClientRect();
      return { cx: b.left + b.width / 2 - centre, top: b.top - box.top, w: b.width, h: b.height };
    });
  };

  /** Where phone i goes while phone k is picked: x and y from rest (px), turn and scale. */
  const handPlace = (i, k) => {
    const p = rest[i];
    // From a middle and a top in the row to the move, given the transform's origin 90% down.
    const move = (cx, top, s) => [cx - p.cx, top - p.top - 0.9 * p.h * (1 - s)];
    if (i === k) {
      const s = (W * 0.26) / p.w;
      const [x, y] = move(-W * 0.3, -12, s);
      return { x, y, r: -2, s };
    }
    // The rest, in their order, fanned at the foot under the words.
    const d = (i < k ? i : i - 1) - 1.5;
    const s = (W * 0.16) / p.w;
    const h = p.h * s;
    const up = hover === i ? h * 0.2 : 0;
    const [x, y] = move(W * 0.2 + d * W * 0.105, foot - h * 0.42 + d * d * 8 - up, s);
    return { x, y, r: d * 6, s };
  };

  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.034, (now - last) / 1000) : 1 / 60;
    last = now;
    const t = now / 1000;
    const box = row.getBoundingClientRect();
    // 0 while the row is still low on the screen, stacked; 1 once it's well up, spread out.
    const fan = ease(range((window.innerHeight - box.top) / window.innerHeight, 0.15, 0.8));
    const k = picked();
    const lk = 1 - Math.exp(-dt * 6);
    lean = [lean[0] + (leanTo[0] - lean[0]) * lk, lean[1] + (leanTo[1] - lean[1]) * lk];
    phones.forEach((_, i) => {
      const d = i - mid;
      const depth = 1 - Math.abs(d) * 0.18;
      let x;
      let y;
      let r;
      let s;
      if (k >= 0) {
        ({ x, y, r, s } = handPlace(i, k));
        x += lean[0] * 6;
        y += Math.sin(t * 1.1 + i * 1.7) * 3;
      } else {
        x = -(1 - fan) * rest[i].cx * 0.88 + lean[0] * 14 * depth;
        y = Math.abs(d) ** 1.6 * 6 * fan + (1 - fan) * (30 + Math.abs(d) * 12);
        r = d * 3 * fan + (1 - fan) * d * 6 + lean[0] * 1.6;
        s = 1 - (1 - fan) * 0.05 * Math.abs(d);
        y += lean[1] * 8 * depth + Math.sin(t * 1.1 + i * 1.7) * 4;
        if (hover === i) {
          y -= 34;
          s *= 1.06;
          r *= 0.25;
        } else if (hover >= 0) {
          const away = i - hover;
          x += (Math.sign(away) * 30) / Math.abs(away);
          y += 8;
          r += Math.sign(away) * 1.5;
        }
      }
      const sp = springs[i];
      const to = { x, y, r, s };
      for (const key of ['x', 'y', 'r', 's']) {
        const v = sp[key];
        if (fresh) {
          v[0] = to[key];
          v[1] = 0;
          continue;
        }
        v[1] += (K * (to[key] - v[0]) - C * v[1]) * dt;
        v[0] += v[1] * dt;
      }
      put(i, sp.x[0], sp.y[0], sp.r[0], sp.s[0]);
      items[i].style.zIndex = k === i ? '7' : hover === i ? '6' : '';
    });
    fresh = false;
    if (onScreen && mode === 'springs') raf = requestAnimationFrame(tick);
    else last = 0;
  };

  // On a phone: the one nearest the middle of the strip is full size, the rest a step back.
  const strip = () => {
    const box = row.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    items.forEach((li, i) => {
      const b = li.getBoundingClientRect();
      const off = b.left + b.width / 2 - centre;
      const k = clamp(Math.abs(off) / b.width);
      put(i, 0, k * 18, Math.sign(off) * k * 4, 1 - 0.12 * k);
    });
  };
  let stripQueued = false;
  row.addEventListener(
    'scroll',
    () => {
      if (mode !== 'strip' || stripQueued) return;
      stripQueued = true;
      requestAnimationFrame(() => {
        stripQueued = false;
        strip();
      });
    },
    { passive: true },
  );

  const start = () => {
    if (mode === 'springs' && onScreen && !raf) raf = requestAnimationFrame(tick);
  };
  const apply = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    clear();
    mode = swipe.matches ? 'strip' : 'springs';
    if (mode === 'strip') {
      // Open on the middle phone, the feed.
      const b = items[Math.round(mid)].getBoundingClientRect();
      const box = row.getBoundingClientRect();
      row.scrollLeft += b.left + b.width / 2 - (box.left + box.width / 2);
      strip();
    } else {
      fresh = true;
      measure();
      start();
    }
  };

  phones.forEach((p, i) => {
    p.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') hover = i;
    });
    p.addEventListener('pointerleave', () => {
      if (hover === i) hover = -1;
    });
    p.addEventListener('focus', () => {
      hover = i;
    });
    p.addEventListener('blur', () => {
      if (hover === i) hover = -1;
    });
  });
  const section = row.closest('section') ?? row;
  section.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = row.getBoundingClientRect();
    leanTo = [
      clamp((e.clientX - b.left) / b.width) * 2 - 1,
      clamp((e.clientY - b.top) / b.height) * 2 - 1,
    ];
  });
  section.addEventListener('pointerleave', () => {
    leanTo = [0, 0];
  });
  new IntersectionObserver(
    ([e]) => {
      onScreen = e.isIntersecting;
      start();
    },
    { rootMargin: '200px 0px' },
  ).observe(row);
  window.addEventListener('resize', () => {
    if (mode === 'springs') measure();
    else strip();
  });
  swipe.addEventListener('change', apply);
  apply();
}

if (!still) for (const row of document.querySelectorAll('.phones')) phoneRow(row);

/*
 * Picking a phone: it marks the rail (data-picked), which the springs above follow, a pin goes
 * in, and its words come out beside it. Picking another swaps them; the close button or Escape
 * fans the hand out again. On a phone the picked one is brought to the middle of the strip and
 * its words show under it.
 */
for (const rail of document.querySelectorAll('.phones-rail')) {
  const row = rail.querySelector('.phones');
  const phones = [...rail.querySelectorAll('.phones-phone')];
  const items = phones.map((p) => p.closest('.phones-item'));
  const cards = [...rail.querySelectorAll('.hand-card')];
  const swipe = window.matchMedia('(max-width: 640px)');
  let at = -1;
  const pick = (i) => {
    at = i;
    if (i < 0) delete rail.dataset.picked;
    else rail.dataset.picked = String(i);
    items.forEach((li, k) => li.classList.toggle('is-picked', k === i));
    phones.forEach((p, k) => p.setAttribute('aria-expanded', String(k === i)));
    cards.forEach((c, k) => c.classList.toggle('is-on', k === i));
  };
  const close = () => {
    const was = at;
    pick(-1);
    phones[was]?.focus({ preventScroll: true });
  };
  phones.forEach((p, i) =>
    p.addEventListener('click', () => {
      if (at === i) return;
      pick(i);
      if (swipe.matches) {
        const b = items[i].getBoundingClientRect();
        const box = row.getBoundingClientRect();
        row.scrollBy({
          left: b.left + b.width / 2 - (box.left + box.width / 2),
          behavior: 'smooth',
        });
      }
    }),
  );
  rail.querySelector('.hand-close')?.addEventListener('click', close);
  rail.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && at >= 0) close();
  });
}

// ---------- The app, a part at a time ----------

/*
 * One window, four recordings: Start, Plan, Track and Earn. The picked one plays through while
 * the window is on screen, then the next comes up by itself, round and round, its tab filling
 * along the foot as it plays. The tabs (and the arrow keys on them), the card's button and the
 * pills down the left pick one by hand, and the window's pause holds it. With reduced motion
 * nothing plays by itself: the picked recording has controls.
 */
function appTabs(section) {
  const stage = section.querySelector('.app-stage');
  const tabs = [...section.querySelectorAll('.app-tab')];
  const names = tabs.map((t) => t.dataset.tab);
  const panels = names.map((n) => section.querySelector(`.app-panel[data-tab="${n}"]`));
  const clips = names.map((n) => section.querySelector(`.app-clip[data-tab="${n}"]`));
  const win = section.querySelector('.app-window');
  const nextLabel = section.querySelector('.app-next-label');
  const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners = [];
  let at = 0;
  let onScreen = false;
  let held = false;
  let raf = 0;

  // Pause and play, in the window's corner.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'window-toggle';
  const label = () => {
    toggle.setAttribute('aria-label', held ? 'Play' : 'Pause');
    toggle.classList.toggle('is-held', held);
  };

  const progress = () => {
    raf = 0;
    const v = clips[at];
    const p = v.duration ? v.currentTime / v.duration : 0;
    tabs[at].style.setProperty('--prog', p.toFixed(4));
    if (!v.paused) raf = requestAnimationFrame(progress);
  };
  const play = () => {
    const v = clips[at];
    if (quiet || held || !onScreen) {
      v.pause();
      return;
    }
    // The next one loads while this one plays.
    clips[(at + 1) % clips.length].preload = 'auto';
    v.play()
      .then(() => {
        if (!raf) raf = requestAnimationFrame(progress);
      })
      .catch(() => {});
  };
  const show = (i) => {
    at = (i + names.length) % names.length;
    stage.dataset.tab = names[at];
    tabs.forEach((t, k) => {
      const on = k === at;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.style.setProperty('--prog', '0');
    });
    panels.forEach((p, k) => p.classList.toggle('is-on', k === at));
    clips.forEach((v, k) => {
      const on = k === at;
      v.classList.toggle('is-on', on);
      if (quiet) v.controls = on;
      if (!on) v.pause();
    });
    try {
      clips[at].currentTime = 0;
    } catch {
      // Not loaded yet: it starts from the beginning anyway.
    }
    nextLabel.textContent = tabs[(at + 1) % tabs.length].textContent;
    play();
    for (const fn of listeners) fn(names[at]);
  };
  /** Picked by hand: a hold lets go. */
  const choose = (i) => {
    held = false;
    label();
    show(i);
  };

  for (const v of clips) {
    v.addEventListener('ended', () => {
      if (v === clips[at] && !held) show(at + 1);
    });
  }
  tabs.forEach((t, i) => t.addEventListener('click', () => choose(i)));
  section.querySelector('.app-tabs').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    choose(at + step);
    tabs[at].focus();
  });
  section.querySelector('.app-next').addEventListener('click', () => choose(at + 1));
  if (!quiet) {
    toggle.addEventListener('click', () => {
      held = !held;
      label();
      play();
    });
    label();
    win.append(toggle);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting;
        play();
      },
      { threshold: 0.35 },
    ).observe(win);
  }
  if (quiet) clips[at].controls = true;
  return {
    pick: (name) => choose(Math.max(0, names.indexOf(name))),
    get current() {
      return names[at];
    },
    onChange: (fn) => listeners.push(fn),
  };
}

const appSection = document.getElementById('app');
const app = appSection ? appTabs(appSection) : null;
// Links to a part of the app (the nav's Planner, the pills) pick its tab on the way there.
for (const a of document.querySelectorAll('a[data-tab]')) {
  a.addEventListener('click', () => app?.pick(a.dataset.tab));
}

// ---------- Where you are ----------

// The pills down the left: the part on screen is filled in, and while the app is up, its tab.
// They show only from the timelapses to the closing.
const pills = document.querySelector('.pills');
if (pills) {
  const links = [...pills.querySelectorAll('a')];
  const parts = [...new Set(links.map((a) => a.getAttribute('href')))].map((h) =>
    document.querySelector(h),
  );
  const closing = document.querySelector('.closing');
  let queued = false;
  const update = () => {
    queued = false;
    const mid = window.innerHeight / 2;
    let on = null;
    for (const el of parts) if (el.getBoundingClientRect().top <= mid) on = el;
    const tab = app?.current;
    for (const a of links) {
      const lit =
        on !== null &&
        a.getAttribute('href') === `#${on.id}` &&
        (!a.dataset.tab || a.dataset.tab === tab);
      a.classList.toggle('is-on', lit);
      if (lit) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
    root.classList.toggle('show-pills', on !== null && closing.getBoundingClientRect().top > mid);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  app?.onChange(queue);
  update();
}
