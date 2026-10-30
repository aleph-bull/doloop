// Motion for the homepage. The hero lifts in on load, devices and all, and each section rises
// as it scrolls into view. Below the hero, scenes marked [data-scrub] follow the scroll: the
// timelapses and the ring of looks. The row of social phones moves on springs of its own, and
// a rail down the left shows where you are in the walkthrough. Nothing here is needed to read
// the page; without it everything lays out flat, and on a phone it stays flat on purpose.

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
    update(p) {
      // The cards start stacked in the middle and fan out as the scene arrives.
      fan = 0.06 + 0.94 * ease(range(p, 0, 0.22));
      if (lastP !== null) push = clamp(push + (p - lastP) * 9, -1.2, 1.2);
      lastP = p;
      word.to(Math.floor(range(p, 0.06, 0.8) * word.count));
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
      lastP = null;
      push = 0;
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
  let live = false;
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
    if (live && onScreen) raf = requestAnimationFrame(tick);
  };
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (live && onScreen && !raf) raf = requestAnimationFrame(tick);
  }).observe(scene);
  return {
    update(p) {
      target = p;
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
const SCENE_VARS = ['--p', '--enter', '--cw'];

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
    if (!on) return;
    for (const s of scenes) s.measure?.();
    queue();
  };

  // A phone gets the page flat (the owner, 2026-10-28): nothing pins, and each section is its
  // words then its pictures, laid out by the CSS under the same query (change both together).
  // A window dragged across the line switches between the two as it goes.
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

// ---------- Timelapses ----------

// The timelapses play while they're on screen and pause off it, so they load only when
// someone gets that far. With reduced motion they wait on their poster with controls, except
// the phones' screens, which are inside the buttons that open the slideshow.
const clips = [...document.querySelectorAll('video.clip')];
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const v of clips) if (!v.closest('button')) v.controls = true;
} else if ('IntersectionObserver' in window) {
  const watch = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        // One someone paused stays paused until they play it again.
        if (e.isIntersecting && !e.target.dataset.held) e.target.play().catch(() => {});
        else e.target.pause();
      }
    },
    { threshold: 0.25 },
  );
  for (const v of clips) watch.observe(v);
  // Each recording in a window has a quiet pause and play in its corner.
  for (const v of document.querySelectorAll('.window video.clip')) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'window-toggle';
    const label = () => {
      const held = Boolean(v.dataset.held);
      b.setAttribute('aria-label', held ? 'Play' : 'Pause');
      b.classList.toggle('is-held', held);
    };
    b.addEventListener('click', () => {
      if (v.dataset.held) {
        delete v.dataset.held;
        v.play().catch(() => {});
      } else {
        v.dataset.held = '1';
        v.pause();
      }
      label();
    });
    label();
    v.after(b);
  }
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

// ---------- The social phones ----------

/*
 * The row of phones in Social, on springs. As the row comes up the screen the phones fan out
 * from a stack in the middle; the row leans a little toward the pointer, each phone floats on
 * its own slow clock, and the one pointed at (or focused) rises and straightens while its
 * neighbours lean out of its way. On a phone the row is a strip to swipe through instead, and
 * the phone nearest the middle is the biggest.
 */
function phoneRow(row) {
  const items = [...row.querySelectorAll('.phones-item')];
  const phones = items.map((li) => li.querySelector('.phones-phone'));
  const mid = (items.length - 1) / 2;
  const swipe = window.matchMedia('(max-width: 640px)');
  // Stiffness and damping: a little overshoot, then still.
  const K = 170;
  const C = 17;
  /** Each phone's spring for x, y (px), turn (deg) and scale: [value, velocity]. */
  const springs = phones.map(() => ({ x: [0, 0], y: [0, 0], r: [0, 0], s: [1, 0] }));
  let offsets = phones.map(() => 0);
  let hover = -1;
  let lean = [0, 0];
  let leanTo = [0, 0];
  let raf = 0;
  let last = 0;
  let fresh = true;
  let onScreen = false;
  let mode = '';

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
  // Where each phone stands at rest, from the middle of the row.
  const measure = () => {
    const box = row.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    offsets = items.map((li) => {
      const b = li.getBoundingClientRect();
      return b.left + b.width / 2 - centre;
    });
  };

  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.034, (now - last) / 1000) : 1 / 60;
    last = now;
    const t = now / 1000;
    const box = row.getBoundingClientRect();
    // 0 while the row is still low on the screen, stacked; 1 once it's well up, spread out.
    const fan = ease(range((window.innerHeight - box.top) / window.innerHeight, 0.15, 0.8));
    const k = 1 - Math.exp(-dt * 6);
    lean = [lean[0] + (leanTo[0] - lean[0]) * k, lean[1] + (leanTo[1] - lean[1]) * k];
    phones.forEach((_, i) => {
      const d = i - mid;
      const depth = 1 - Math.abs(d) * 0.18;
      let x = -(1 - fan) * offsets[i] * 0.88 + lean[0] * 14 * depth;
      let y = Math.abs(d) ** 1.6 * 6 * fan + (1 - fan) * (30 + Math.abs(d) * 12);
      let r = d * 3 * fan + (1 - fan) * d * 6 + lean[0] * 1.6;
      let s = 1 - (1 - fan) * 0.05 * Math.abs(d);
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
      items[i].style.zIndex = hover === i ? '6' : '';
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

// ---------- Where you are ----------

// The rail down the left: the step on screen is lit and the ones before it are done, and the
// line fills from dot to dot as each step scrolls by. It shows only from the first step to the
// closing, and turns light over the dark timelapse band.
const rail = document.querySelector('.progress');
if (rail) {
  const links = [...rail.querySelectorAll('a')];
  const steps = links.map((a) => document.querySelector(a.getAttribute('href')));
  const fill = rail.querySelector('.progress-fill');
  const line = rail.querySelector('.progress-line');
  const closing = document.querySelector('.closing');
  const band = document.querySelector('.fall-band');
  let queued = false;
  const update = () => {
    queued = false;
    const mid = window.innerHeight / 2;
    const tops = steps.map((el) => el.getBoundingClientRect().top);
    const end = closing.getBoundingClientRect().top;
    let on = -1;
    tops.forEach((t, i) => {
      if (t <= mid) on = i;
    });
    links.forEach((a, i) => {
      a.classList.toggle('is-on', i === on);
      a.classList.toggle('is-done', i < on);
      if (i === on) a.setAttribute('aria-current', 'step');
      else a.removeAttribute('aria-current');
    });
    // Each dot's middle, down the line; the fill runs to the lit dot and on toward the next.
    const dots = links.map((a) => a.offsetTop + a.offsetHeight / 2 - line.offsetTop);
    let y = 0;
    if (on >= 0) {
      const next = on + 1 < steps.length ? tops[on + 1] : end;
      const through = clamp((mid - tops[on]) / Math.max(1, next - tops[on]));
      const to = on + 1 < dots.length ? dots[on + 1] : dots[on];
      y = dots[on] + (to - dots[on]) * through;
    }
    fill.style.setProperty('--fill', `${Math.max(0, y).toFixed(1)}px`);
    root.classList.toggle('show-progress', on >= 0 && end > mid);
    const b = band?.getBoundingClientRect();
    rail.dataset.tone = b && b.top < mid && b.bottom > mid ? 'dark' : '';
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();
}

// ---------- The slideshow ----------

// Each social phone opens the slideshow at its own slide. The arrows, the dots, the arrow keys
// or a sideways swipe move through it; Escape, the close button or a click outside the box
// closes it, and focus goes back to the phone.
const show = document.getElementById('features');
if (show && typeof show.showModal === 'function') {
  const slides = [...show.querySelectorAll('.slide')];
  const dots = [...show.querySelectorAll('[data-go]')];
  let at = 0;
  /** Show slide `i`, coming in from the right (dir 1), the left (-1) or neither (0). */
  const go = (i, dir = 0) => {
    at = (i + slides.length) % slides.length;
    slides.forEach((s, k) => {
      s.classList.toggle('is-on', k === at);
      if (k === at) s.style.setProperty('--from', String(dir));
    });
    dots.forEach((d, k) => d.setAttribute('aria-current', String(k === at)));
  };
  for (const phone of document.querySelectorAll('.phones-phone')) {
    phone.addEventListener('click', () => {
      go(Number(phone.dataset.slide));
      show.showModal();
    });
  }
  show.querySelector('.slide-close').addEventListener('click', () => show.close());
  for (const b of show.querySelectorAll('[data-step]')) {
    const step = Number(b.dataset.step);
    b.addEventListener('click', () => go(at + step, step));
  }
  for (const d of dots) {
    const i = Number(d.dataset.go);
    d.addEventListener('click', () => go(i, Math.sign(i - at)));
  }
  show.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    go(at + step, step);
  });
  // A click on the backdrop lands on the dialog itself, outside its box.
  show.addEventListener('click', (e) => {
    if (e.target !== show) return;
    const r = show.getBoundingClientRect();
    const out =
      e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (out) show.close();
  });
  let x0 = null;
  show.addEventListener('pointerdown', (e) => {
    x0 = e.pointerType === 'mouse' ? null : e.clientX;
  });
  show.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) < 48) return;
    const step = dx < 0 ? 1 : -1;
    go(at + step, step);
  });
  show.addEventListener('pointercancel', () => {
    x0 = null;
  });
}
