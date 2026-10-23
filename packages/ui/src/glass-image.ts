/**
 * Glass without a blur on every frame (2026-10-22, the owner's idea).
 *
 * A glass card blurs whatever is behind it, and the browser redoes that blur on every frame
 * while the page scrolls: the costliest thing the app draws. Most cards sit straight on the
 * backdrop photo, though, so what they show is always the same photo, blurred. So the photo
 * is blurred once (`makeGlassImage`, by the Backdrop), and each of those cards gets a pane
 * (`watchGlassPanes`) showing its slice of that image, pinned to the window like the photo
 * itself. styles.css then turns the card's own blur off. Anything that floats over other
 * content (the nav, dialogs, menus, toasts) keeps the real blur, and so does a card while it,
 * or anything around it, moves (a page rising in, a hover lift), since the pinned slice
 * would come loose for that moment.
 */

/** The cards that can take a pane: every card, never the strong glass of dialogs and toasts. */
const CARDS = '.panel, .glass:not(.glass-strong)';
/** What else blurs in glass mode (styles.css), besides cards. */
const BLURS_TOO = '.glass, .btn-primary, .chrome';
const PANE_CLASS = 'glass-pane';
const HAS_PANE = 'has-glass-pane';
const PANE_HOST = 'glass-pane-host';
const MOVING = 'data-glass-moving';

/**
 * The blur the image is made at. A blurred photo has no fine detail left, so it is made
 * small, where the blur is about this many pixels, and scaled up on screen: the same look,
 * quick to make and light to hold.
 */
const WORK_BLUR = 6;

/**
 * Chrome and the browsers built on it (Edge, Vivaldi, Brave, Opera), where the pinned slice
 * was checked. Elsewhere cards keep the real blur, as before.
 */
export function pinnedGlassWorks(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } })
    .userAgentData?.brands;
  return !!brands?.some((b) => b.brand === 'Chromium');
}

let canvasBlurs: boolean | null = null;

/** Whether this browser's canvas can blur (older Safari ignores `filter` on a canvas). */
function canvasCanBlur(): boolean {
  if (canvasBlurs !== null) return canvasBlurs;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !('filter' in ctx)) return (canvasBlurs = false);
    ctx.filter = 'blur(2px)';
    ctx.fillStyle = '#fff';
    ctx.fillRect(4, 0, 1, 1);
    canvasBlurs = ctx.getImageData(1, 0, 1, 1).data[3]! > 0;
  } catch {
    canvasBlurs = false;
  }
  return canvasBlurs;
}

/** A blurred photo: its object URL and the photo's own size. */
export interface GlassImage {
  url: string;
  width: number;
  height: number;
}

/**
 * Where a photo of `photo`'s size lies when drawn `center / cover` over a backdrop of
 * `width` × `height`, as the Backdrop draws it: CSS values for --glass-image-size, -x, -y.
 */
export function coverPlacement(
  photo: { width: number; height: number },
  width: number,
  height: number,
): { size: string; x: string; y: string } {
  const cover = Math.max(width / photo.width, height / photo.height);
  const w = photo.width * cover;
  const h = photo.height * cover;
  return { size: `${w}px ${h}px`, x: `${(width - w) / 2}px`, y: `${(height - h) / 2}px` };
}

/**
 * The photo blurred as glass shows it, for a backdrop of `width` × `height` (the photo is
 * drawn to cover it, so its scale there sets how far to blur). `blur` is in CSS pixels. Null
 * when the browser can't make it; the cards keep their own blur. The caller revokes the URL.
 */
export async function makeGlassImage(
  src: string,
  blur: number,
  width: number,
  height: number,
): Promise<GlassImage | null> {
  if (blur <= 0 || !canvasCanBlur()) return null;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return null;
  // The photo covers the backdrop, so one of its pixels is `cover` CSS pixels on screen.
  const cover = Math.max(width / iw, height / ih);
  const photoBlur = blur / cover;
  const scale = Math.min(1, WORK_BLUR / photoBlur);
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const workBlur = photoBlur * scale;
  // Past the photo's edges a stretched copy, so the blur pulls in photo there, not nothing.
  const pad = Math.ceil(workBlur * 3);
  const padded = document.createElement('canvas');
  padded.width = w + 2 * pad;
  padded.height = h + 2 * pad;
  const p = padded.getContext('2d');
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const o = out.getContext('2d');
  if (!p || !o) return null;
  p.imageSmoothingQuality = 'high';
  p.drawImage(img, 0, 0, padded.width, padded.height);
  p.drawImage(img, pad, pad, w, h);
  o.filter = `blur(${workBlur}px)`;
  o.drawImage(padded, -pad, -pad);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  return blob ? { url: URL.createObjectURL(blob), width: iw, height: ih } : null;
}

/** Transform-like properties: a card or anything around it changing one comes loose. */
const MOVES = ['transform', 'translate', 'scale', 'rotate'];
const movesByAnimation = new Map<string, boolean>();

/** Whether a CSS animation on `el` named `name` changes a transform. */
function animationMoves(el: Element, name: string): boolean {
  const known = movesByAnimation.get(name);
  if (known !== undefined) return known;
  const anim = el.getAnimations().find((a) => (a as CSSAnimation).animationName === name) as
    CSSAnimation | undefined;
  if (!anim?.effect) return false;
  const moves = (anim.effect as KeyframeEffect)
    .getKeyframes()
    .some((k) => MOVES.some((m) => m in k && k[m] !== 'none'));
  movesByAnimation.set(name, moves);
  return moves;
}

/**
 * Whether `el` clips what is inside it. #root clips sideways overflow only (CLAUDE.md), which
 * never cuts a card, so it doesn't count.
 */
function clips(el: Element, s: CSSStyleDeclaration = getComputedStyle(el)): boolean {
  return el.id !== 'root' && (s.overflowX !== 'visible' || s.overflowY !== 'visible');
}

/** A transform that leaves things where they are (an animation held at its `none` end). */
const STILL = new Set(['none', 'matrix(1, 0, 0, 1, 0, 0)']);

/**
 * Whether `el` is moving now: a transform animation or transition running, or a lift held.
 * Around a clip (the Achievements fold opening), any animation counts: the clip is moving.
 * An animation held at its end without moving anything is not moving; it is a transform
 * for good, which keepsSlice turns down.
 */
function stillMoving(el: Element, isCard: boolean): boolean {
  const clipping = !isCard && clips(el);
  const running = el.getAnimations().some((a) => {
    if (a.playState !== 'running') return false;
    if (clipping) return true;
    if ('animationName' in a) return animationMoves(el, (a as CSSAnimation).animationName);
    if ('transitionProperty' in a) return MOVES.includes((a as CSSTransition).transitionProperty);
    return false;
  });
  if (running) return true;
  const s = getComputedStyle(el);
  return (
    !STILL.has(s.transform) || s.translate !== 'none' || s.scale !== 'none' || s.rotate !== 'none'
  );
}

/** What something around a card does to its pinned slice. */
type Around = 'keeps' | 'breaks' | 'clips';

/**
 * Whether the pinned slice inside `el` (the card, or something around it) stays where the
 * card is: nothing that moves it, clips it or draws it differently from the card. Something
 * moving only for now (rising in, a hover lift) is fine; it is marked as moving, and the
 * card uses the real blur until it settles. A clip that doesn't scroll is fine for a card
 * it shows whole (canTakePane checks); a scroller never is.
 */
function keepsSlice(el: HTMLElement, isCard: boolean): Around {
  const s = getComputedStyle(el);
  if (s.position === 'fixed' || s.position === 'absolute') return 'breaks';
  let around: Around = 'keeps';
  if (!isCard) {
    if (clips(el, s)) {
      const scrolls = (o: string) => o === 'auto' || o === 'scroll';
      if (scrolls(s.overflowX) || scrolls(s.overflowY)) return 'breaks';
      around = 'clips';
    }
    if (s.filter !== 'none' || s.backdropFilter !== 'none') return 'breaks';
    if (s.maskImage !== 'none' || s.clipPath !== 'none' || s.mixBlendMode !== 'normal') {
      return 'breaks';
    }
    if (s.opacity !== '1' && el.getAnimations().length === 0) return 'breaks';
  }
  if (/paint|layout|strict|content/.test(s.contain)) return 'breaks';
  if (/transform|translate|scale|rotate|filter|perspective/.test(s.willChange)) return 'breaks';
  if (s.perspective !== 'none') return 'breaks';
  const transformed =
    s.transform !== 'none' || s.translate !== 'none' || s.scale !== 'none' || s.rotate !== 'none';
  if (transformed) {
    if (!el.getAnimations().some((a) => a.playState === 'running')) return 'breaks';
    el.setAttribute(MOVING, '');
  }
  if (around === 'clips' && el.getAnimations().some((a) => a.playState === 'running')) {
    el.setAttribute(MOVING, '');
  }
  return around;
}

/** Whether `card` lies wholly inside what `el` shows (its padding box). */
function wholeInside(card: HTMLElement, el: HTMLElement): boolean {
  const c = card.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const left = r.left + el.clientLeft;
  const top = r.top + el.clientTop;
  return (
    c.left >= left - 0.5 &&
    c.top >= top - 0.5 &&
    c.right <= left + el.clientWidth + 0.5 &&
    c.bottom <= top + el.clientHeight + 0.5
  );
}

/** Whether a card can show a pinned slice of the image. `seen` keeps answers for one sweep. */
function canTakePane(card: HTMLElement, cards: string, seen: Map<HTMLElement, Around>): boolean {
  if (card.parentElement?.closest(cards)) return false; // a card inside a card
  if (card.closest('dialog, [popover]')) return false;
  const display = getComputedStyle(card).display;
  if (display === 'none' || display === 'contents') return false;
  // Something inside that blurs too (an accent button) sees only the card's own fill while
  // the card blurs; over a pane it would blur the photo through the card and come out
  // different. Such a card keeps its own blur.
  for (const el of card.querySelectorAll(`${cards}, ${BLURS_TOO}`)) {
    if (el.getClientRects().length > 0) return false;
  }
  if (keepsSlice(card, true) === 'breaks') return false;
  for (let el = card.parentElement; el && el !== document.body; el = el.parentElement) {
    let around = seen.get(el);
    if (around === undefined) seen.set(el, (around = keepsSlice(el, false)));
    if (around === 'breaks') return false;
    if (around === 'clips' && !wholeInside(card, el)) return false;
  }
  return true;
}

/**
 * The card's corners and border, for the pane: it covers the card's whole box, border and
 * all, as the card's own blur did, and repeats the card's fill, border and inner line over
 * the slice.
 */
function frame(s: CSSStyleDeclaration): { radius: string; inset: string } {
  return {
    radius: [
      s.borderTopLeftRadius,
      s.borderTopRightRadius,
      s.borderBottomRightRadius,
      s.borderBottomLeftRadius,
    ]
      .map((r) => `${parseFloat(r) || 0}px`)
      .join(' '),
    // Out from the padding box (where `inset: 0` puts the pane) to the border's outer edge.
    inset: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth]
      .map((w) => `${-(parseFloat(w) || 0)}px`)
      .join(' '),
  };
}

function setVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

/**
 * Lines the pane's strip up with its card. The strip is pinned to the window, as tall as the
 * window and as wide as the card: a page scrolls up and down, never sideways, so that covers
 * every place the card can be, and the browser keeps far less of the image than for a strip
 * the whole window wide.
 */
function placePane(card: HTMLElement): void {
  const pane = card.querySelector<HTMLElement>(`:scope > .${PANE_CLASS}`);
  if (!pane) return;
  const r = card.getBoundingClientRect();
  setVar(pane, '--pane-left', `${r.left}px`);
  setVar(pane, '--pane-width', `${r.width}px`);
}

function addPane(card: HTMLElement, sizes: ResizeObserver): void {
  let pane = card.querySelector<HTMLElement>(`:scope > .${PANE_CLASS}`);
  if (!pane) {
    pane = document.createElement('span');
    pane.className = PANE_CLASS;
    pane.setAttribute('aria-hidden', 'true');
    card.prepend(pane);
    sizes.observe(card);
  }
  const { radius, inset } = frame(getComputedStyle(card));
  setVar(pane, '--pane-radius', radius);
  setVar(pane, '--pane-inset', inset);
  placePane(card);
  // The pane sits inside the card, so the card must be positioned (sticky ones already are).
  if (getComputedStyle(card).position === 'static') card.classList.add(PANE_HOST);
  card.classList.add(HAS_PANE);
}

function removePane(card: HTMLElement, sizes: ResizeObserver): void {
  card.classList.remove(HAS_PANE, PANE_HOST);
  card.querySelector(`:scope > .${PANE_CLASS}`)?.remove();
  sizes.unobserve(card);
}

/**
 * Gives every card in `container` that sits straight on the backdrop a pane, and keeps it
 * up as cards come and go. `more` adds the page's own cards that are glass too. Panes show
 * only while <html> has `data-glass-image` (styles.css). Returns a function that stops
 * watching and takes the panes away.
 */
export function watchGlassPanes(container: HTMLElement, more?: string): () => void {
  const cards = more ? `${CARDS}, ${more}` : CARDS;
  let queued = 0;
  const root = document.documentElement;

  // A card that changes size, or the page around it, may have moved sideways: its strip goes
  // back under it before the frame is drawn.
  const placeAll = (within: Element = container) => {
    if (within.classList.contains(HAS_PANE)) placePane(within as HTMLElement);
    for (const card of within.querySelectorAll<HTMLElement>(`.${HAS_PANE}`)) placePane(card);
  };
  const sizes = new ResizeObserver((entries) => {
    if (entries.some((e) => e.target === container)) placeAll();
    else for (const e of entries) placePane(e.target as HTMLElement);
  });
  sizes.observe(container);

  const sweep = () => {
    queued = 0;
    // Nothing to do while the image isn't there: panes would only sit hidden.
    if (!('glassImage' in root.dataset)) return;
    // Marks whose movement ended without an end event (the element changed under it).
    for (const el of document.querySelectorAll(`[${MOVING}]`)) {
      if (!stillMoving(el, el.matches(cards))) el.removeAttribute(MOVING);
    }
    const seen = new Map<HTMLElement, Around>();
    for (const card of container.querySelectorAll<HTMLElement>(cards)) {
      if (canTakePane(card, cards, seen)) addPane(card, sizes);
      else if (card.classList.contains(HAS_PANE)) removePane(card, sizes);
    }
  };
  // Before the next frame is drawn, so a pane never shows a frame out of place.
  const queue = () => {
    if (!queued) queued = requestAnimationFrame(sweep);
  };
  const sweepNow = () => {
    if (queued) cancelAnimationFrame(queued);
    sweep();
  };

  // A pane is a child the page's own code doesn't know about. React leaves it be, but a
  // card that swaps its whole content (or a new card) needs one again.
  const content = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n instanceof HTMLElement && !n.classList.contains(PANE_CLASS)) return queue();
      }
      for (const n of r.removedNodes) {
        if (n instanceof HTMLElement && n.classList.contains(PANE_CLASS)) return queue();
      }
    }
  });
  content.observe(container, { childList: true, subtree: true });
  // A clip around cards that changes (the Achievements fold opening) can hide a card whose
  // pinned slice would still show.
  const reshaped = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target;
      if (el instanceof HTMLElement && el.querySelector(`.${HAS_PANE}`) && clips(el))
        return queue();
    }
  });
  reshaped.observe(container, {
    attributes: true,
    attributeFilter: ['class', 'style'],
    subtree: true,
  });
  const settings = new MutationObserver(queue);
  settings.observe(root, { attributes: true, attributeFilter: ['data-glass-image', 'data-panel'] });

  // Moving cards, and anything moving around cards, use the real blur until they settle.
  const holdsCards = (el: Element) =>
    container.contains(el) && (el.matches(cards) || el.querySelector(`.${HAS_PANE}`) !== null);
  const onStart = (e: AnimationEvent | TransitionEvent) => {
    const el = e.target;
    // A card's own decoration animating (the trophies' shimmer) doesn't move the card.
    if (!(el instanceof Element) || e.pseudoElement || !holdsCards(el)) return;
    const moves =
      e instanceof AnimationEvent
        ? animationMoves(el, e.animationName)
        : MOVES.includes(e.propertyName);
    if (moves || (clips(el) && !el.matches(cards))) el.setAttribute(MOVING, '');
  };
  const onEnd = (e: AnimationEvent | TransitionEvent) => {
    const el = e.target;
    // Something around the container can be marked too (canTakePane walks up to <body>).
    if (!(el instanceof Element) || e.pseudoElement) return;
    if (!(container.contains(el) || el.contains(container))) return;
    const isCard = el.matches(cards);
    const reclip = !isCard && clips(el) && el.querySelector(cards) !== null;
    if (!el.hasAttribute(MOVING) && !reclip) return;
    // The end event comes before the browser drops the finished animation; look after it.
    requestAnimationFrame(() => {
      if (stillMoving(el, isCard)) return;
      // Panes for where the cards are now, then the real blur off.
      if (reclip) sweepNow();
      else placeAll(el);
      el.removeAttribute(MOVING);
    });
  };
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('animationstart', onStart, opts);
  document.addEventListener('transitionstart', onStart, opts);
  for (const type of [
    'animationend',
    'animationcancel',
    'transitionend',
    'transitioncancel',
  ] as const) {
    document.addEventListener(type, onEnd as EventListener, opts);
  }
  // The page can move sideways in a resized window without changing size itself.
  const onResize = () => {
    placeAll();
    queue();
  };
  window.addEventListener('resize', onResize, { passive: true });
  queue();

  return () => {
    cancelAnimationFrame(queued);
    content.disconnect();
    reshaped.disconnect();
    settings.disconnect();
    document.removeEventListener('animationstart', onStart, opts);
    document.removeEventListener('transitionstart', onStart, opts);
    for (const type of [
      'animationend',
      'animationcancel',
      'transitionend',
      'transitioncancel',
    ] as const) {
      document.removeEventListener(type, onEnd as EventListener, opts);
    }
    window.removeEventListener('resize', onResize);
    for (const card of container.querySelectorAll<HTMLElement>(`.${HAS_PANE}`)) {
      removePane(card, sizes);
    }
    sizes.disconnect();
    for (const el of document.querySelectorAll(`[${MOVING}]`)) el.removeAttribute(MOVING);
  };
}
