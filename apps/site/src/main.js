// Motion for the homepage. The hero lifts in on load, and each part rises as it scrolls into
// view. Scenes follow the scroll ([data-scrub]): the laptop's screen coming up to face you, the
// timelapses falling past the words while the night holds the screen (on a phone, two rows
// sliding past each other), and the drum of looks turning. The phones move on springs and open
// like a hand of cards, the picked one playing its screen, and the app's five parts play one
// after another in one window. Nothing here is needed to read the page; without it everything
// lays out flat.

const root = document.documentElement;
const still =
  root.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (t) => 1 - (1 - t) ** 3;
/** Slow in and slow out. */
const smooth = (t) => t * t * (3 - 2 * t);
/** How far `v` is from `a` to `b`, as 0 to 1. */
const range = (v, a, b) => clamp((v - a) / (b - a));

if (!still && 'IntersectionObserver' in window) {
  root.classList.add('has-motion');
  const items = [...document.querySelectorAll('.rise')];
  const inHero = (el) => el.closest('.hero') !== null;
  // The laptop and phone come and go with the top of the page (heroWait, below).
  const devices = document.querySelector('.hero-devices');

  // Above the fold: everything comes in on load, each with its own delay.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const el of items) if (inHero(el) && el !== devices) el.classList.add('is-in');
      if (devices) heroWait(devices);
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

/*
 * The hero on a computer (the owner, 2026-11-02: "hide the computer and centre the text until
 * scroll", "there shouldnt be a big gap between the text and the computer it should appear
 * instead of just being there", then "i should not see the computer and phone when i am on the
 * very top of the page"): whenever the page is at its very top, the words sit in the middle of
 * the window and the laptop and phone are hidden. Any scroll away from the top glides the words
 * up into their place and brings the devices up under them; back at the top they go again.
 * Nothing holds the scroll. A phone shows everything all the time.
 */
function heroWait(devices) {
  const copy = document.querySelector('.hero-copy');
  const roomy = window.matchMedia('(min-width: 641px) and (min-height: 501px)');
  // From where the words sit to the middle of the window (offsetTop ignores the move).
  const place = () => {
    const centre = copy.offsetTop + copy.offsetHeight / 2;
    copy.style.setProperty(
      '--shift',
      `${Math.max(0, window.innerHeight / 2 - centre).toFixed(1)}px`,
    );
  };
  let hidden = null;
  const set = () => {
    const hide = roomy.matches && window.scrollY <= 4;
    if (hide === hidden) return;
    hidden = hide;
    if (hide) place();
    root.classList.toggle('hero-waiting', hide);
    devices.classList.toggle('is-in', !hide);
  };
  devices.style.setProperty('--d', '120ms');
  set();
  // The headline's height can change once the fonts arrive; keep it in the middle.
  document.fonts?.ready.then(() => hidden && place());
  window.addEventListener('scroll', set, { passive: true });
  window.addEventListener('resize', () => {
    place();
    set();
  });
  roomy.addEventListener('change', set);
}

// ---------- Scroll scenes ----------

/** The words in the looks' last line (calm, bright, cozy), lit one after another. */
function cycler(words) {
  const to = (i) => words.forEach((w, k) => w.classList.toggle('is-lit', k === i));
  return { to, rest: () => to(0), count: words.length };
}

/*
 * The ring of looks, like the inside of a drum: small cards in a strip across the middle,
 * growing and turning to face inward as they reach the sides. Each card sits at a place `u`
 * along the arc (-1 at the left edge, 0 in the middle, 1 at the right). The drum turns on
 * its own while it's on screen, right to left, and those leaving one side come back on the
 * other, and it can be dragged round by hand and thrown. Scrolling leaves it alone (the owner,
 * 2026-11-02: "make scrolling not affect the drum only on entry should it do that fast
 * explosion thing"): the first time it comes up the window the cards burst out from a stack in
 * the middle, quickly, once. The last line lights its next word every few seconds.
 */
function ringScene(scene) {
  const view = scene.querySelector('.ring-view');
  const cards = [...scene.querySelectorAll('.ring-card')];
  const word = cycler([...scene.querySelectorAll('.cycle-word')]);
  // The arc the cards share, and its turn per second on its own: a card's width about every
  // second and a half.
  let span = 2.6;
  let cruise = 0.11;
  let W = window.innerWidth;
  // How far the cards spread (a share of the width), how evenly (1 is even, more bunches them
  // in the middle) and how much they grow toward the sides. A phone spaces them further apart
  // round the arc and evenly across, with bigger cards in the middle, or they'd crowd into a
  // stack (the owner, 2026-11-01: "spread the drum out").
  let spread = 0.6;
  let even = 1.4;
  let grow = [0.36, 1.45];
  let fan = 0.06;
  // When the burst out from the middle began (on the clock rAF hands the tick), once.
  let burst = null;
  const BURST_MS = 850;
  let slide = 0;
  let push = 0;
  let wordClock = 0;
  let wordAt = 0;
  let raf = 0;
  let last = 0;
  let onScreen = false;
  let live = false;
  /** The pointer holding the drum: its id, where and when it last moved, and how fast. */
  let held = null;
  // Arc turned for a drag across the whole strip.
  const DRAG = 1.3;

  const measure = () => {
    W = view.clientWidth || window.innerWidth;
    const phone = W < 640;
    span = phone ? 5.4 : 2.6;
    cruise = 0.11 * (span / 2.6);
    spread = phone ? 0.64 : 0.6;
    even = phone ? 1 : 1.4;
    grow = phone ? [0.44, 0.6] : [0.36, 1.45];
    scene.style.setProperty('--cw', `${phone ? W * 0.6 : Math.max(150, W * 0.19)}px`);
  };

  const draw = () => {
    for (let i = 0; i < cards.length; i++) {
      const u = (((((i / cards.length) * span - slide) % span) + span) % span) - span / 2;
      const seen = 1 - range(Math.abs(u), 1.02, 1.2);
      const card = cards[i];
      card.style.opacity = seen.toFixed(3);
      card.style.visibility = seen > 0 ? 'visible' : 'hidden';
      if (seen <= 0) continue;
      const f = u * fan;
      const a = Math.abs(f);
      const x = Math.sign(f) * W * spread * a ** even;
      const s = grow[0] + grow[1] * a ** 2;
      card.style.zIndex = String(Math.round(a * 100));
      card.style.transform = `translateX(${x.toFixed(1)}px) perspective(1100px) rotateY(${(-f * 58).toFixed(2)}deg) scale(${s.toFixed(3)})`;
    }
  };

  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    // While it's held, the hand turns it; otherwise its own turn and whatever push it has.
    if (!held) {
      slide += dt * (cruise + push);
      push *= Math.exp(-dt * 2.2);
    }
    wordClock += dt;
    if (wordClock > 2.8) {
      wordClock = 0;
      wordAt = (wordAt + 1) % word.count;
      word.to(wordAt);
    }
    if (burst !== null && fan < 1) {
      // A quick start and a long, soft landing, a touch past its place and back.
      const k = clamp((now - burst) / BURST_MS);
      const out = 1 - (1 - k) ** 4;
      fan = 0.06 + 0.94 * (out + Math.sin(k * Math.PI) * 0.04 * (1 - k));
      if (k >= 1) fan = 1;
    }
    draw();
    if (live && onScreen) raf = requestAnimationFrame(tick);
    else last = 0;
  };
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (live && onScreen && !raf) raf = requestAnimationFrame(tick);
  }).observe(scene);

  // Dragged sideways, the cards follow the pointer; let go and the drum carries on at the
  // speed it was thrown, easing back to its own turn. A touch that moves up or down scrolls
  // the page instead (touch-action in the CSS), which lets go here.
  view.addEventListener('pointerdown', (e) => {
    if (!live || e.button !== 0) return;
    held = { id: e.pointerId, x: e.clientX, t: e.timeStamp, v: 0 };
    view.setPointerCapture(e.pointerId);
    view.classList.add('is-dragging');
    push = 0;
    e.preventDefault();
  });
  view.addEventListener('pointermove', (e) => {
    if (!held || e.pointerId !== held.id) return;
    const step = ((held.x - e.clientX) / W) * DRAG;
    const dt = Math.max(1, e.timeStamp - held.t) / 1000;
    slide += step;
    held.v = held.v * 0.6 + (step / dt) * 0.4;
    held.x = e.clientX;
    held.t = e.timeStamp;
  });
  const letGo = (e) => {
    if (!held || e.pointerId !== held.id) return;
    // Held still before letting go is no throw.
    const v = e.timeStamp - held.t > 80 ? 0 : held.v;
    push = clamp(v - cruise, -3, 3);
    held = null;
    view.classList.remove('is-dragging');
  };
  view.addEventListener('pointerup', letGo);
  view.addEventListener('pointercancel', letGo);

  return {
    measure,
    update(enter) {
      // The burst starts once a good third of the drum's part is up the window; after that the
      // scroll has nothing to do with it.
      if (burst === null && enter > 0.4) {
        burst = performance.now();
        if (live && onScreen && !raf) raf = requestAnimationFrame(tick);
      }
      if (!onScreen) draw();
    },
    start() {
      live = true;
      scene.classList.add('is-live');
      if (onScreen && !raf) raf = requestAnimationFrame(tick);
    },
    stop() {
      live = false;
      scene.classList.remove('is-live');
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      burst = null;
      fan = 0.06;
      push = 0;
      held = null;
      view.classList.remove('is-dragging');
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
 * --v, in vh, turning by --dr, as the band passes through the window; nothing holds the screen,
 * the owner, 2026-11-02: "remove the screen pin but keep the reactive falling"), so they sink
 * through the band slower than the page and seem farther off. A card doesn't snap there: it
 * drifts toward it a beat behind, like something settling in water, and sways, bobs and tilts
 * a little on its own clock, so it keeps moving when the page stops. The loop runs only while
 * it's on screen.
 */
function fallScene(scene) {
  const floaters = scene.querySelector('.floaters');
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
  // On a phone the clips are two rows instead, sliding past each other as the night goes by:
  // `--slide` (px) moves the top row left and the bottom one right.
  let rows = false;
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
    update(enter, through, p) {
      if (rows) {
        const slide = (through - 0.5) * window.innerWidth * 0.5;
        floaters.style.setProperty('--slide', slide.toFixed(1));
        return;
      }
      target = through;
    },
    start(flat) {
      rows = flat;
      if (rows) return;
      live = true;
      if (onScreen && !raf) raf = requestAnimationFrame(tick);
    },
    stop() {
      live = false;
      rows = false;
      cancelAnimationFrame(raf);
      raf = 0;
      floaters.style.removeProperty('--slide');
      for (const c of cards) {
        c.at = null;
        c.el.style.removeProperty('transform');
      }
    },
  };
}

/*
 * The laptop and phone in the hero, once they're shown: the laptop's screen leans back a little
 * and comes up to face you as the devices rise up the window, and the phone in front climbs a
 * touch faster than the page, so the two part in depth. It trails the scroll a beat, so a
 * wheel's steps glide.
 */
function heroScene(scene) {
  const devices = scene.querySelector('.hero-devices');
  const laptop = scene.querySelector('.laptop');
  const phone = scene.querySelector('.hero-phone');
  let tilt = 14;
  let lift = 56;
  // The devices' top within the hero, measured with the layout, not on every frame.
  let devTop = 0;
  // Where the scroll puts the scene (0 to 1) and where it is drawn, a beat behind.
  let target = 0;
  let at = null;
  let raf = 0;
  let last = 0;
  const draw = (q) => {
    const s = smooth(q);
    laptop.style.setProperty('--tilt', `${(tilt * (1 - s)).toFixed(2)}deg`);
    phone.style.setProperty('--lift', `${(lift * (0.5 - s)).toFixed(1)}px`);
  };
  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    at += (target - at) * (1 - Math.exp(-dt * 9));
    if (Math.abs(target - at) < 0.0005) at = target;
    draw(at);
    if (at !== target) raf = requestAnimationFrame(tick);
    else last = 0;
  };
  const measure = () => {
    const phoneSized = window.innerWidth < 641;
    tilt = phoneSized ? 9 : 14;
    lift = phoneSized ? 36 : 56;
    devTop = devices.offsetTop;
    if (at !== null) draw(at);
  };
  return {
    measure,
    update(enter, through, p, r) {
      // How far the devices' top has come up the window (0 at its foot): upright once it nears
      // the top.
      const vh = window.innerHeight;
      const rise = (vh - (r.top + devTop)) / vh;
      target = range(rise, 0.3, 1);
      if (at === null) {
        at = target;
        draw(at);
      } else if (!raf && at !== target) raf = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      at = null;
      laptop.style.removeProperty('--tilt');
      phone.style.removeProperty('--lift');
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
    else if (kind === 'hero') Object.assign(scene, heroScene(el));
    return scene;
  });

  // Each scene's place on the page, measured when the layout changes rather than on every frame,
  // so a scroll only does arithmetic: reading a rectangle after the last frame's writes would
  // lay the whole page out again each time.
  const place = () => {
    const y = window.scrollY;
    for (const s of scenes) {
      const r = s.el.getBoundingClientRect();
      s.top = r.top + y;
      s.height = r.height;
    }
  };
  let queued = false;
  const frame = () => {
    queued = false;
    const vh = window.innerHeight;
    const y = window.scrollY;
    scenes.forEach((s) => {
      if (!s.running) return;
      const top = s.top - y;
      const r = { top, height: s.height, bottom: top + s.height };
      if (r.bottom < -vh || r.top > vh * 2) return;
      // enter: 0 to 1 as it comes up the screen; through: 0 to 1 from its top reaching the
      // bottom to its bottom leaving the top; p: 0 to 1 while it holds the screen.
      const enter = clamp((vh - r.top) / vh);
      const through = clamp((vh - r.top) / (vh + r.height));
      const p = clamp(-r.top / Math.max(1, r.height - vh));
      s.update?.(enter, through, p, r);
    });
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  };
  const measure = () => {
    for (const s of scenes) if (s.running) s.measure?.();
    place();
    queue();
  };

  // A phone gets the page flat (the owner, 2026-10-28): nothing pins, and each part is its
  // words then its pictures, laid out by the CSS under the same query (change both together).
  // A phone keeps the scenes that pin nothing: the laptop coming up, the drum a thumb turns
  // (the owner, 2026-10-31) and the timelapses as two sliding rows. A window dragged across the
  // line switches between the two as it goes.
  const flat = window.matchMedia('(max-width: 640px), (max-height: 500px)');
  const rowsQuery = window.matchMedia('(max-width: 640px)');
  const apply = () => {
    const wide = !flat.matches;
    root.classList.toggle('has-scrub', wide);
    for (const s of scenes) {
      // The timelapses change how they move across the line, so they start again in the new way.
      const mode = s.kind === 'fall' ? (wide ? 'float' : rowsQuery.matches ? 'rows' : '') : 'on';
      if (mode === (s.running || '')) continue;
      if (s.running) {
        s.stop?.();
        for (const name of SCENE_VARS) s.el.style.removeProperty(name);
      }
      s.running = mode;
      if (mode) s.start?.(mode === 'rows');
    }
    measure();
    frame();
  };
  apply();
  flat.addEventListener('change', apply);
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  document.fonts?.ready.then(measure);
  if ('ResizeObserver' in window)
    new ResizeObserver(measure).observe(document.querySelector('main'));
}

// ---------- Timelapses ----------

// The timelapses play while they're on screen and pause off it, so they load only when someone
// gets that far. With reduced motion they wait on their poster with controls. The phones'
// screens play only when picked, and the app's five recordings one at a time (below).
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

// A recording that can't start on its own (an iPhone in Low Power Mode) shows its poster, and
// keeps showing it behind the video when the browser hides the poster to load it.
for (const v of document.querySelectorAll('video[poster]')) {
  const at = getComputedStyle(v).objectPosition;
  v.style.background = `#1d1a25 url("${v.getAttribute('poster')}") ${at} / cover no-repeat`;
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
  // The row's top on the page, so a frame works out where it is from the scroll alone.
  let rowTop = 0;
  let hover = -1;
  let lean = [0, 0];
  let leanTo = [0, 0];
  let raf = 0;
  let last = 0;
  let fresh = true;
  let onScreen = false;
  let mode = '';
  const words = rail.querySelector('.hand-text');
  /** The pick the cards held low were placed for, and the bounds they were placed in. */
  let lowFor = -2;
  let lowFloor = -Infinity;
  let lowView = Infinity;

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
    rowTop = box.top + window.scrollY;
    foot = rail.getBoundingClientRect().bottom - box.top;
    lowFor = -2;
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
    // The rest, in their order, fanned under the words. They peek up from the rail's foot, but
    // never lower than half a card above the window's foot, so they stay in view in a short
    // window (the owner, 2026-11-02: "bump up the phones at the bottom not visible"); and never
    // over the words.
    const d = (i < k ? i : i - 1) - 1.5;
    const s = (W * 0.16) / p.w;
    const h = p.h * s;
    const up = hover === i ? h * 0.2 : 0;
    const top = Math.max(lowFloor, Math.min(foot - h * 0.42, lowView - h * 0.5));
    const [x, y] = move(W * 0.2 + d * W * 0.105, top + d * d * 8 - up, s);
    return { x, y, r: d * 6, s };
  };

  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.034, (now - last) / 1000) : 1 / 60;
    last = now;
    const top = rowTop - window.scrollY;
    // 0 while the row is still low on the screen, stacked; 1 once it's well up, spread out.
    const fan = ease(range((window.innerHeight - top) / window.innerHeight, 0.15, 0.8));
    const k = picked();
    // Where the words end and where the window ends, read once for each pick (so the cards
    // don't follow the scroll), from the row's top.
    if (k !== lowFor) {
      lowFor = k;
      if (k >= 0 && words) {
        lowFloor = words.getBoundingClientRect().bottom - top + 20;
        lowView = window.innerHeight - top;
      }
    }
    const lk = 1 - Math.exp(-dt * 6);
    lean = [lean[0] + (leanTo[0] - lean[0]) * lk, lean[1] + (leanTo[1] - lean[1]) * lk];
    // Still moving: a spring short of its place or a lean not caught up. Once nothing is, the
    // loop rests until a scroll, the pointer or a pick wakes it.
    let moving = Math.abs(leanTo[0] - lean[0]) + Math.abs(leanTo[1] - lean[1]) > 0.002;
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
      } else {
        x = -(1 - fan) * rest[i].cx * 0.88 + lean[0] * 14 * depth;
        y = Math.abs(d) ** 1.6 * 6 * fan + (1 - fan) * (30 + Math.abs(d) * 12);
        // The fan stays even: the pointer slides the row a little, it never turns it, or the
        // phones on one side tip over further than the other (the owner: "is tilted").
        r = d * 3 * fan + (1 - fan) * d * 6;
        s = 1 - (1 - fan) * 0.05 * Math.abs(d);
        y += lean[1] * 8 * depth;
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
        const still = key === 's' ? 0.0005 : 0.05;
        if (Math.abs(to[key] - v[0]) > still || Math.abs(v[1]) > still * 4) moving = true;
      }
      put(i, sp.x[0], sp.y[0], sp.r[0], sp.s[0]);
      const z = k === i ? '7' : hover === i ? '6' : '';
      if (items[i].style.zIndex !== z) items[i].style.zIndex = z;
    });
    fresh = false;
    if (onScreen && mode === 'springs' && moving) raf = requestAnimationFrame(tick);
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
      start();
    });
    p.addEventListener('pointerleave', () => {
      if (hover === i) hover = -1;
      start();
    });
    p.addEventListener('focus', () => {
      hover = i;
      start();
    });
    p.addEventListener('blur', () => {
      if (hover === i) hover = -1;
      start();
    });
  });
  // A pick (a phone, Next, the close button, the arrow keys) moves the hand.
  rail.addEventListener('click', () => start());
  rail.addEventListener('keydown', () => start());
  window.addEventListener('scroll', () => start(), { passive: true });
  const section = row.closest('section') ?? row;
  section.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = row.getBoundingClientRect();
    leanTo = [
      clamp((e.clientX - b.left) / b.width) * 2 - 1,
      clamp((e.clientY - b.top) / b.height) * 2 - 1,
    ];
    start();
  });
  section.addEventListener('pointerleave', () => {
    leanTo = [0, 0];
    start();
  });
  new IntersectionObserver(
    ([e]) => {
      onScreen = e.isIntersecting;
      start();
    },
    { rootMargin: '200px 0px' },
  ).observe(row);
  window.addEventListener('resize', () => {
    if (mode === 'springs') {
      measure();
      start();
    } else strip();
  });
  // Anything that moves the row on the page (a font, a video's size arriving) re-measures it.
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (mode === 'springs') measure();
    }).observe(document.querySelector('main'));
  }
  swipe.addEventListener('change', apply);
  apply();
}

if (!still) for (const row of document.querySelectorAll('.phones')) phoneRow(row);

/*
 * Picking a phone: it marks the rail (data-picked), which the springs above follow, its screen
 * plays and its words come out beside it; the others stay still, back at their first frame.
 * Picking another swaps them; the close button or Escape fans the hand out again. On a phone
 * nothing needs a tap: whichever phone is in the middle of the strip is the picked one, its
 * words under the strip and its dot lit, and tapping a phone or a dot brings it to the middle.
 * On a computer the words end with where the phone is in the five (the ones already read
 * tinted) and Next, so the hand reads as something to go through in order (the owner,
 * 2026-11-02); the arrow keys step through too.
 */
for (const rail of document.querySelectorAll('.phones-rail')) {
  const row = rail.querySelector('.phones');
  const phones = [...rail.querySelectorAll('.phones-phone')];
  const items = phones.map((p) => p.closest('.phones-item'));
  const screens = phones.map((p) => p.querySelector('.hand-clip'));
  const cards = [...rail.querySelectorAll('.hand-card')];
  const dots = [...rail.querySelectorAll('.hand-dots button')];
  const pips = [...rail.querySelectorAll('.hand-pips span')];
  const next = rail.querySelector('.hand-next');
  const nextLabel = rail.querySelector('.hand-next-label');
  const seen = new Set();
  const swipe = window.matchMedia('(max-width: 640px)');
  let at = -1;
  let onScreen = true;
  const play = () => {
    screens.forEach((v, k) => {
      if (k === at && onScreen) {
        v.play().catch(() => {});
        return;
      }
      if (v.paused && v.currentTime === 0) return;
      v.pause();
      v.currentTime = 0;
    });
  };
  const pick = (i) => {
    if (i === at) return;
    at = i;
    if (i < 0) delete rail.dataset.picked;
    else rail.dataset.picked = String(i);
    items.forEach((li, k) => li.classList.toggle('is-picked', k === i));
    phones.forEach((p, k) => p.setAttribute('aria-expanded', String(k === i)));
    cards.forEach((c, k) => c.classList.toggle('is-on', k === i));
    dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
    if (i >= 0) seen.add(i);
    pips.forEach((p, k) => {
      p.classList.toggle('is-on', k === i);
      p.classList.toggle('is-seen', seen.has(k));
    });
    if (next && i >= 0) {
      const end = i === phones.length - 1;
      nextLabel.textContent = end ? 'Start over' : 'Next';
      next.setAttribute(
        'aria-label',
        `${end ? 'Start over' : 'Next'}: ${phones[end ? 0 : i + 1].getAttribute('aria-label')}`,
      );
    }
    play();
  };
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      play();
    }).observe(rail);
  }

  // The strip on a phone: the one nearest its middle, and bringing one there.
  const centred = () => {
    const box = row.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    let best = 0;
    let gap = Infinity;
    items.forEach((li, k) => {
      const b = li.getBoundingClientRect();
      const d = Math.abs(b.left + b.width / 2 - middle);
      if (d < gap) {
        gap = d;
        best = k;
      }
    });
    return best;
  };
  const centre = (i, smooth = true) => {
    const b = items[i].getBoundingClientRect();
    const box = row.getBoundingClientRect();
    const by = b.left + b.width / 2 - (box.left + box.width / 2);
    // To a place, not by an amount: the strip snaps, and a nudge by a sliver of a pixel would
    // carry it on to the next phone.
    if (Math.abs(by) < 1) return;
    row.scrollTo({ left: row.scrollLeft + by, behavior: smooth && !still ? 'smooth' : 'instant' });
  };
  let queued = false;
  row.addEventListener(
    'scroll',
    () => {
      if (!swipe.matches || queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        pick(centred());
      });
    },
    { passive: true },
  );
  const settle = () => {
    if (swipe.matches) {
      centre(at >= 0 ? at : Math.floor(items.length / 2), false);
      pick(centred());
    } else pick(-1);
  };

  const close = () => {
    const was = at;
    pick(-1);
    phones[was]?.focus({ preventScroll: true });
  };
  phones.forEach((p, i) =>
    p.addEventListener('click', () => {
      if (swipe.matches) centre(i);
      else if (at !== i) pick(i);
    }),
  );
  dots.forEach((d, i) => d.addEventListener('click', () => centre(i)));
  rail.querySelector('.hand-close')?.addEventListener('click', close);
  next?.addEventListener('click', () => pick((at + 1) % phones.length));
  rail.addEventListener('keydown', (e) => {
    if (at < 0 || swipe.matches) return;
    if (e.key === 'Escape') close();
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step || e.target.closest('.phones')) return;
    e.preventDefault();
    pick((at + step + phones.length) % phones.length);
  });
  swipe.addEventListener('change', settle);
  if (swipe.matches) settle();
}

// ---------- The app, a part at a time ----------

/*
 * One window, five recordings: Start, Plan, Track, Earn and Social. The picked one plays
 * through while the window is on screen, then the next comes up by itself, round and round, its
 * tab filling along the foot as it plays. The tabs (and the arrow keys on them) and the card's
 * button pick one by hand, and the window's pause holds it. With reduced motion nothing plays
 * by itself: the picked recording has controls.
 */
function appTabs(section) {
  const stage = section.querySelector('.app-stage');
  const tabs = [...section.querySelectorAll('.app-tab')];
  const names = tabs.map((t) => t.dataset.tab);
  const panels = names.map((n) => section.querySelector(`.app-panel[data-tab="${n}"]`));
  const clips = names.map((n) => section.querySelector(`.app-clip[data-tab="${n}"]`));
  const win = section.querySelector('.app-window');
  const nextLabel = section.querySelector('.app-next-label');
  const thumb = section.querySelector('.app-thumb');
  const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let at = 0;
  let onScreen = false;
  let held = false;
  let raf = 0;

  // The switch's thumb sits under the picked tab, measured from the tab itself so it fits
  // whatever the font and the width.
  const place = () => {
    const tab = tabs[at];
    if (!thumb || !tab.offsetWidth) return;
    thumb.style.setProperty('--tx', `${tab.offsetLeft}px`);
    thumb.style.setProperty('--tw', `${tab.offsetWidth}px`);
    root.classList.add('has-thumb');
  };

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
    thumb?.style.setProperty('--prog', p.toFixed(4));
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
    section.dataset.tab = names[at];
    tabs.forEach((t, k) => {
      const on = k === at;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    thumb?.style.setProperty('--prog', '0');
    place();
    panels.forEach((p, k) => p.classList.toggle('is-on', k === at));
    clips.forEach((v, k) => {
      const on = k === at;
      v.classList.toggle('is-on', on);
      if (quiet) v.controls = on;
      if (!on) v.pause();
    });
    // Not loaded yet, it starts from the beginning anyway (and moving it would hide its poster).
    if (clips[at].readyState > 0) clips[at].currentTime = 0;
    nextLabel.textContent = tabs[(at + 1) % tabs.length].textContent;
    play();
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
  place();
  window.addEventListener('resize', place);
  document.fonts?.ready.then(place);
  return {
    pick: (name) => choose(Math.max(0, names.indexOf(name))),
  };
}

const appSection = document.getElementById('app');
const app = appSection ? appTabs(appSection) : null;
// Links to a part of the app (the nav's Planner) pick its tab on the way there.
for (const a of document.querySelectorAll('a[data-tab]')) {
  a.addEventListener('click', () => app?.pick(a.dataset.tab));
}

// ---------- Settling on each part ----------

/*
 * On a computer, when a scroll comes to rest between two parts, the page eases onto whichever
 * is nearer, so the screen never stands half way between them (the owner, 2026-11-02: "it goes
 * to one or the other screen should never stand in the middle"; before that "make the screen
 * stick to sections and then go with enough scroll", then "too aggressive, make it smoother",
 * which is why it waits for the scroll to rest and eases rather than snapping). The timelapses and the phones settle at their top; the app, the looks and the
 * closing in the middle of the screen. The hero has none: its opening scene follows the scroll
 * by itself, and easing the page along inside it felt like a tug. Any new scroll, key, touch
 * or click stops the ease where it is.
 */
if (!still) {
  const roomy = window.matchMedia('(min-width: 641px) and (min-height: 501px)');
  // The phones settle with their heading just under the header, the sunrise above them.
  const parts = [
    ['.record', 'top', 0],
    ['.phones-head', 'top', 92],
    ['.app-wrap', 'middle', 0],
    ['.looks', 'middle', 0],
    ['.closing-inner', 'middle', 0],
  ]
    .map(([q, at, gap]) => [document.querySelector(q), at, gap])
    .filter(([el]) => el);
  // Above the first part or past the last, a scroll is eased onto it only this near (a share of
  // the screen); between two it always goes to one.
  const NEAR = 0.22;
  const inOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
  let wait = 0;
  let raf = 0;
  let gliding = false;
  const halt = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    gliding = false;
  };
  const glide = (to) => {
    const from = window.scrollY;
    const start = performance.now();
    // Longer for further, within limits, so a short hop isn't sluggish nor a long one abrupt.
    const ms = Math.min(950, Math.max(480, 360 + Math.abs(to - from) * 0.6));
    gliding = true;
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      window.scrollTo({ top: from + (to - from) * inOut(t), behavior: 'instant' });
      if (t < 1) raf = requestAnimationFrame(step);
      else halt();
    };
    raf = requestAnimationFrame(step);
  };
  const settle = () => {
    if (!roomy.matches) return;
    const y = window.scrollY;
    const vh = window.innerHeight;
    const max = document.documentElement.scrollHeight - vh;
    // Scrolled right to the end, to the footer: stay there.
    if (y >= max - 2) return;
    const stops = parts
      .map(([el, at, gap]) => {
        const r = el.getBoundingClientRect();
        const top = r.top + y;
        // A part settles in the middle of what the header leaves, not of the window.
        const mid = top + r.height / 2 - (vh + 60) / 2;
        return Math.min(max, Math.max(0, at === 'top' ? top - gap : mid));
      })
      .sort((a, b) => a - b);
    // Already resting on a part: stay, rather than be pulled on to the next one.
    if (stops.some((s) => Math.abs(s - y) <= 2)) return;
    let best = null;
    for (let i = 0; i < stops.length - 1; i++) {
      const [a, b] = [stops[i], stops[i + 1]];
      if (y > a && y < b) best = y - a <= b - y ? a : b;
    }
    if (best === null) {
      const near = stops.find((s) => Math.abs(s - y) < vh * NEAR);
      if (near !== undefined) best = near;
    }
    if (best !== null) glide(best);
  };
  window.addEventListener(
    'scroll',
    () => {
      if (gliding) return;
      clearTimeout(wait);
      wait = setTimeout(settle, 180);
    },
    { passive: true },
  );
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
    window.addEventListener(
      type,
      () => {
        clearTimeout(wait);
        if (gliding) halt();
      },
      { passive: true },
    );
  }
}

// ---------- The sky and the header ----------

/*
 * One sky behind the page: the photograph for the hero, the same soft light in each other
 * part's colours (the owner, 2026-11-02: "the background style should be consistent but not
 * necessarily the same colour", "hero can have the cloud image but the rest cannot"). Each part
 * names its light (data-sky). As a part's top comes up the window the sky fades to its light: none of
 * it while the top is near the bottom of the window, half a little above the middle, all of it
 * once the top nears the header. Only the light being left and the one coming are drawn.
 *
 * The header rides on it: clear at the very top, then from the first scroll a compact bar in the
 * portal's glass that stays (the owner, 2026-11-02: "shrink a taller hero header into a compact
 * bar once scrolling starts instead of hiding on scroll"), smoked while the sky is dark and
 * frosted white while it's light.
 */
const LIGHTS = {
  dusk: { tone: 'dark', base: '#3a2c42' },
  night: { tone: 'dark', base: '#201627' },
  dawn: { tone: 'light', base: '#eeeaf5' },
  day: { tone: 'light', base: '#eceff5' },
  evening: { tone: 'dark', base: '#1a1442' },
  morning: { tone: 'light', base: '#dee7fb' },
};
// Between a dark part and a light one the sky passes through a third light, so the fade is a
// sunrise or a dusk rather than a grey halfway mix of the two.
const BETWEEN = { 'night>dawn': 'sunrise', 'day>evening': 'lilac', 'evening>morning': 'bluehour' };

function skyAndHeader(head) {
  const layers = [...document.querySelectorAll('.sky-layer')];
  // Where the light changes: the first part of each run of parts sharing one.
  const turns = [];
  for (const el of document.querySelectorAll('main [data-sky]')) {
    if (turns.at(-1)?.sky !== el.dataset.sky) turns.push({ el, sky: el.dataset.sky });
  }
  if (!turns.length) return;
  root.classList.add('has-sky');
  // Where each change sits on the page, measured only when the page's layout changes, so a
  // scroll never has to lay the page out to read it. What was last written, so a frame writes
  // only what changed.
  let tops = [];
  const measure = () => {
    tops = turns.map((turn) => turn.el.getBoundingClientRect().top + window.scrollY);
  };
  const shown = new Map();
  let base = '';
  let compact = null;
  let queued = false;
  const frame = () => {
    queued = false;
    const vh = window.innerHeight;
    const y = window.scrollY;
    let from = turns[0].sky;
    let to = '';
    let t = 0;
    for (let i = 1; i < turns.length; i++) {
      const top = tops[i] - y;
      const w = smooth(range(vh * 0.9 - top, 0, vh * 0.65));
      if (w >= 1) {
        from = turns[i].sky;
        continue;
      }
      if (w > 0) {
        to = turns[i].sky;
        t = w;
      }
      break;
    }
    // With a light between, it comes in over the first half and the next over the second; the
    // layers are in that order, so each lies over the one before.
    const mid = BETWEEN[`${from}>${to}`];
    for (const layer of layers) {
      const name = layer.dataset.sky;
      let o = 0;
      if (name === from) o = 1;
      else if (name === mid) o = clamp(t * 2);
      else if (name === to) o = mid ? clamp(t * 2 - 1) : t;
      const value = o.toFixed(3);
      if (shown.get(layer) === value) continue;
      shown.set(layer, value);
      layer.style.opacity = value;
      layer.classList.toggle('is-on', o > 0);
    }
    const now = LIGHTS[t > 0.5 ? to : from] ?? LIGHTS.dusk;
    if (base !== now.base) {
      base = now.base;
      root.style.backgroundColor = base;
    }
    if (head) {
      const small = y > 8;
      if (compact !== small) {
        compact = small;
        head.classList.toggle('is-compact', small);
      }
      if (head.dataset.tone !== now.tone) head.dataset.tone = now.tone;
    }
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  };
  const remeasure = () => {
    measure();
    queue();
  };
  measure();
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', remeasure);
  window.addEventListener('load', remeasure);
  document.fonts?.ready.then(remeasure);
  // Anything that changes the page's height (a video's size arriving, a font) moves the changes.
  if ('ResizeObserver' in window)
    new ResizeObserver(remeasure).observe(document.querySelector('main'));
  frame();
}

skyAndHeader(document.querySelector('.site-nav'));
