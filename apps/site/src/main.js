// Entrance motion: the hero lifts in on load, the devices a beat later, and each section
// pops up as it scrolls into view. Nothing here is needed to read the page.

const root = document.documentElement;
const still =
  root.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!still && 'IntersectionObserver' in window) {
  root.classList.add('has-motion');
  const items = [...document.querySelectorAll('.rise')];
  const inHero = (el) => el.closest('.hero') !== null;

  // Above the fold: the text comes in on load with each element's own delay. The devices
  // wait a couple of seconds, or come in at once if the reader scrolls first.
  const devices = document.querySelector('.devices');
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const el of items) if (inHero(el) && el !== devices) el.classList.add('is-in');
    }),
  );
  if (devices) {
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      devices.classList.add('is-in');
    };
    const timer = window.setTimeout(show, 1300);
    const early = () => {
      window.clearTimeout(timer);
      devices.style.setProperty('--d', '0ms');
      show();
    };
    for (const ev of ['wheel', 'touchmove', 'keydown'])
      window.addEventListener(ev, early, { once: true, passive: true });
    window.addEventListener('scroll', early, { once: true, passive: true });
  }

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
  v.addEventListener('enterpictureinpicture', () => document.exitPictureInPicture().catch(() => {}));
  v.addEventListener('webkitpresentationmodechanged', () => {
    if (v.webkitPresentationMode === 'picture-in-picture') v.webkitSetPresentationMode('inline');
  });
}
