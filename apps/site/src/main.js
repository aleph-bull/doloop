// Motion for the homepage. The hero lifts in on load, devices and all, and each section rises
// as it scrolls into view. Below the hero, scenes marked [data-scrub] follow the scroll: the
// Track tour, the ring of looks, the focus screen that grows, and the social fields. Nothing
// here is needed to read the page; without it everything lays out flat.

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

/** The heading's word, scrambled through random letters on its way to the next one. */
function scrambler(el) {
  const words = el.dataset.words.split(',');
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let shown = el.textContent;
  let raf = 0;
  return (i) => {
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
}

/*
 * The ring of looks, like the inside of a drum: small cards in a strip across the middle,
 * growing and turning to face inward as they reach the sides. Each card sits at a place `u`
 * along the arc (-1 at the left edge, 0 in the middle, 1 at the right). The drum turns on
 * its own while it's on screen, right to left, and those leaving one side come back on the
 * other; scrolling gives it a push that eases off. The scroll still fans the cards out.
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
  let lastP = null;
  let raf = 0;
  let last = 0;
  let onScreen = false;

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
    draw();
    if (onScreen) raf = requestAnimationFrame(tick);
    else last = 0;
  };
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (onScreen && !raf) raf = requestAnimationFrame(tick);
  }).observe(scene);

  return {
    measure,
    update(p) {
      // The cards start stacked in the middle and fan out as the scene arrives.
      fan = 0.06 + 0.94 * ease(range(p, 0, 0.22));
      if (lastP !== null) push = clamp(push + (p - lastP) * 9, -1.2, 1.2);
      lastP = p;
      word(Math.floor(range(p, 0.06, 0.8) * 4));
      if (!onScreen) draw();
    },
  };
}

/*
 * The Track tour: the screens on the chambers of a cylinder, a revolver's six with three
 * filled. Scrolling sets which chamber should face the front, holding on each screen and
 * turning between them; the cylinder eases toward it, so each turn settles into place.
 * Chambers fade as they turn away. The list on the left follows the nearest screen.
 */
function tourScene(scene) {
  const steps = Number(scene.dataset.steps) || 1;
  const win = scene.querySelector('.tour-window');
  const drum = scene.querySelector('.tour-drum');
  const faces = [...scene.querySelectorAll('.tour-drum img')];
  const TURN = 60;
  let R = 400;
  let target = 0;
  let pos = 0;
  let raf = 0;
  let last = 0;

  const draw = () => {
    if (!drum) return;
    drum.style.transform = `translateZ(${(-R).toFixed(1)}px) rotateX(${(pos * TURN).toFixed(2)}deg)`;
    faces.forEach((face, i) => {
      const off = Math.abs(pos - i) * TURN;
      face.style.transform = `rotateX(${-i * TURN}deg) translateZ(${R.toFixed(1)}px)`;
      face.style.opacity = (1 - range(off, 10, 58)).toFixed(3);
    });
  };
  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    pos += (target - pos) * (1 - Math.exp(-dt * 6));
    if (Math.abs(target - pos) < 0.0005) pos = target;
    draw();
    if (pos !== target) raf = requestAnimationFrame(tick);
    else last = 0;
  };

  return {
    measure() {
      // The cylinder's radius puts six chambers of the window's height edge to edge.
      R = (win?.clientHeight || 500) * 0.866;
      draw();
    },
    update(p) {
      const run = range(p, 0.06, 0.94) * (steps - 1);
      const k = Math.min(steps - 2, Math.floor(run));
      const turn = range(run - k, 0.22, 0.78);
      target = k + turn * turn * (3 - 2 * turn);
      setStep(scene, Math.round(target));
      if (!raf) raf = requestAnimationFrame(tick);
    },
  };
}

/** The focus screen: it grows to fill the window, the page goes dark, then a Pomodoro runs. */
function zoomScene(scene) {
  const stepsOf = Number(scene.dataset.steps) || 1;
  let s0 = 0.75;
  const measure = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const narrow = vw < 900;
    const sw = narrow ? vw - 24 : Math.min(vw - 48, (vh - 48) * 1.6);
    scene.style.setProperty('--sw', `${sw}px`);
    s0 = narrow ? 0.86 : Math.min(1, Math.min(1040, vw - 120) / sw);
  };
  return {
    measure,
    update(p) {
      const grow = ease(range(p, 0, 0.2)) * (1 - ease(range(p, 0.88, 1)));
      scene.style.setProperty('--s', (s0 + (1 - s0) * grow).toFixed(4));
      scene.style.setProperty(
        '--dark',
        (range(p, 0.02, 0.18) * (1 - range(p, 0.86, 0.97))).toFixed(3),
      );
      scene.style.setProperty(
        '--ph',
        (ease(range(p, 0.42, 0.54)) * (1 - ease(range(p, 0.8, 0.9)))).toFixed(3),
      );
      setStep(scene, Math.min(stepsOf - 1, Math.floor(range(p, 0.1, 0.86) * stepsOf)));
    },
  };
}

function setStep(el, step) {
  const next = String(step);
  if (el.dataset.step !== next) el.dataset.step = next;
}

/*
 * The floating timelapses. Each card has a place the scroll gives it (falling from --y by
 * --v, in vh, turning by --dr) but doesn't snap there: it drifts toward it a beat behind,
 * like something settling in water, and sways, bobs and tilts a little on its own clock, so
 * it keeps moving when the page stops. The loop runs only while the scene is on screen.
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
  let target = 0.4;
  let raf = 0;
  let onScreen = false;
  const tick = (now) => {
    raf = 0;
    const t = now / 1000;
    const vh = window.innerHeight / 100;
    // On a phone the cards have half a screen under the words: they fall half as far, from a
    // little lower, so two or three are always in view.
    const [k, b] = window.innerWidth < 640 ? [0.5, 10] : [1, 0];
    for (const c of cards) {
      const goal = (c.y + target * c.v) * k + b;
      c.at = c.at === null ? goal : c.at + (goal - c.at) * (0.035 + 0.04 * c.near);
      const w = t * c.rate + c.phase;
      const x = Math.sin(w) * 16 * c.near;
      const y = c.at * vh + Math.sin(w * 0.8 + 1.3) * 10;
      const turn = c.r + target * c.dr + Math.sin(w * 0.6) * 2.4;
      const tilt = Math.sin(w * 0.5 + 0.7) * 9;
      c.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) perspective(1000px) rotateY(${tilt.toFixed(2)}deg) rotate(${turn.toFixed(2)}deg)`;
    }
    if (onScreen) raf = requestAnimationFrame(tick);
  };
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (onScreen && !raf) raf = requestAnimationFrame(tick);
  }).observe(scene);
  return {
    update(p) {
      target = p;
    },
  };
}

if (!still) {
  root.classList.add('has-scrub');
  const scenes = [...document.querySelectorAll('[data-scrub]')].map((el) => {
    const kind = el.dataset.scrub;
    const steps = Number(el.dataset.steps) || 0;
    const scene = { el, kind };
    if (kind === 'looks') Object.assign(scene, ringScene(el));
    else if (kind === 'zoom') Object.assign(scene, zoomScene(el));
    else if (kind === 'tour') Object.assign(scene, tourScene(el));
    else if (kind === 'fall') Object.assign(scene, fallScene(el));
    else if (kind === 'plan')
      // The week, Plan my week's suggestions, then the week planned; the phone joins last.
      scene.update = (p) => {
        setStep(el, Math.min(steps - 1, Math.floor(range(p, 0.08, 0.86) * steps)));
        el.style.setProperty('--ph', ease(range(p, 0.6, 0.78)).toFixed(3));
      };
    else if (kind === 'cell') {
      const frame = el.querySelector('.frame');
      const img = frame?.querySelector('img');
      // The feed's long picture scrolls inside its frame while the cell crosses the screen.
      scene.update = (_p, _enter, through) => {
        if (!img || !el.classList.contains('cell-feed')) return;
        const travel = Math.max(0, img.offsetHeight - frame.clientHeight);
        el.style.setProperty(
          '--shift',
          `${(-travel * ease(range(through, 0.25, 0.85))).toFixed(1)}px`,
        );
      };
    }
    if (el.dataset.step === undefined && steps) el.dataset.step = '0';
    return scene;
  });

  let queued = false;
  const frame = () => {
    queued = false;
    const vh = window.innerHeight;
    for (const s of scenes) {
      const r = s.el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;
      // p: 0 to 1 while the scene is pinned; enter: 0 to 1 as it comes up the screen;
      // through: 0 to 1 from its top reaching the bottom to its bottom leaving the top.
      const p = clamp(-r.top / Math.max(1, r.height - vh));
      const enter = clamp((vh - r.top) / vh);
      const through = clamp((vh - r.top) / (vh + r.height));
      s.el.style.setProperty('--p', p.toFixed(4));
      s.el.style.setProperty('--enter', ease(enter).toFixed(4));
      s.update?.(p, enter, through);
    }
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  };
  const measure = () => {
    for (const s of scenes) s.measure?.();
    queue();
  };
  measure();
  frame();
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', measure);

  // On a phone a pinned stage is only as tall as what's in it and pins in the middle of the
  // screen; the CSS takes half its height for that.
  const half = new ResizeObserver((entries) => {
    for (const e of entries) e.target.style.setProperty('--half', `${e.target.offsetHeight / 2}px`);
  });
  for (const el of document.querySelectorAll('.looks-stage, .zoom-stage, .plan-stage')) {
    half.observe(el);
  }
}

// ---------- Timelapses ----------

// The timelapses play while they're on screen and pause off it, so they load only when
// someone gets that far. With reduced motion they wait on their poster with controls.
const clips = [...document.querySelectorAll('video.clip')];
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const v of clips) v.controls = true;
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
// clip that gets popped out anyway goes straight back into the page.
for (const v of clips) {
  v.disablePictureInPicture = true;
  v.addEventListener('enterpictureinpicture', () =>
    document.exitPictureInPicture().catch(() => {}),
  );
  v.addEventListener('webkitpresentationmodechanged', () => {
    if (v.webkitPresentationMode === 'picture-in-picture') v.webkitSetPresentationMode('inline');
  });
}
