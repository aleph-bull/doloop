// "Why it works" (/why-it-works/). The homepage's sky and header (a trimmed copy of main.js's
// skyAndHeader, since main.js runs the homepage's scenes), its entrance motion, and the
// timelapses in the first rows, which play only while they are on screen. Nothing here is
// needed to read the page.

const root = document.documentElement;
const still =
  root.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);
const range = (v, a, b) => clamp((v - a) / (b - a));

// The heading comes in on load; each study rises as it arrives.
if (!still && 'IntersectionObserver' in window) {
  root.classList.add('has-motion');
  const items = [...document.querySelectorAll('.rise')];
  const inHero = (el) => el.closest('.why-head') !== null;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const el of items) if (inHero(el)) el.classList.add('is-in');
    }),
  );
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
  );
  for (const el of items) if (!inHero(el)) io.observe(el);
}

// The timelapses play while they're on screen and rest when they aren't. With less motion
// asked for, they stay on their posters.
const clips = [...document.querySelectorAll('.study-clip')];
if (!still && clips.length && 'IntersectionObserver' in window) {
  const watch = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) target.play().catch(() => {});
        else target.pause();
      }
    },
    { threshold: 0.2 },
  );
  for (const clip of clips) watch.observe(clip);
}

/*
 * The sky and the header, as on the homepage: the sky behind the page never scrolls, and fades
 * from the lavender morning of the studies to the clear blue of the closing as the closing's top
 * comes up the window. The header is clear at the very top, then a compact bar in the portal's
 * frosted white glass. On a phone everything is plain white (styles.css, why.css).
 */
const LIGHTS = {
  dawn: { tone: 'light', base: '#eeeaf5' },
  morning: { tone: 'light', base: '#dee7fb' },
};
const WHITE = { tone: 'light', base: '#fff' };
const STILL_LIGHTS = { dawn: WHITE, morning: WHITE };

function skyAndHeader(head) {
  const layers = [...document.querySelectorAll('.sky-layer')];
  const turns = [];
  for (const el of document.querySelectorAll('main [data-sky]')) {
    if (turns.at(-1)?.sky !== el.dataset.sky) turns.push({ el, sky: el.dataset.sky });
  }
  if (!turns.length) return;
  root.classList.add('has-sky');
  const flat = window.matchMedia('(max-width: 640px), (max-height: 500px)');
  // Where each change sits on the page, measured only when the layout changes.
  let tops = [];
  const measure = () => {
    tops = turns.map(
      (turn) => turn.el.getBoundingClientRect().top + turn.el.clientTop + window.scrollY,
    );
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
      const w = flat.matches ? Number(top <= 30) : smooth(range(vh * 0.9 - top, 0, vh * 0.65));
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
    for (const layer of flat.matches ? [] : layers) {
      const name = layer.dataset.sky;
      const o = name === from ? 1 : name === to ? t : 0;
      const value = o.toFixed(3);
      if (shown.get(layer) === value) continue;
      shown.set(layer, value);
      layer.style.opacity = value;
      layer.classList.toggle('is-on', o > 0);
    }
    const now = (flat.matches ? STILL_LIGHTS : LIGHTS)[t > 0.5 ? to : from] ?? LIGHTS.dawn;
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
  flat.addEventListener('change', () => {
    shown.clear();
    remeasure();
  });
  window.addEventListener('load', remeasure);
  document.fonts?.ready.then(remeasure);
  if ('ResizeObserver' in window)
    new ResizeObserver(remeasure).observe(document.querySelector('main'));
  frame();
}

skyAndHeader(document.querySelector('.site-nav'));
