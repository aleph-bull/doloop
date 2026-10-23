// The docs page: search across every topic and question, the sidebar that follows the
// reader, and a few keys. Without the script everything is simply there.

const input = document.querySelector('#doc-search');
const count = document.querySelector('.doc-count');
const empty = document.querySelector('.doc-empty');
const sections = [...document.querySelectorAll('.doc-section')];
const items = [...document.querySelectorAll('[data-doc]')];
const navLinks = [...document.querySelectorAll('.doc-nav a[href^="#"]')];
const index = items.map((el) => ({ el, text: el.textContent.toLowerCase().replace(/\s+/g, ' ') }));

// Matches are marked with the CSS Custom Highlight API where the browser has it, so the
// text itself is never rewritten.
const canMark =
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

function mark(terms, visible) {
  if (!canMark) return;
  CSS.highlights.delete('doc-hit');
  if (!terms.length) return;
  const ranges = [];
  for (const { el } of visible) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const lower = node.data.toLowerCase();
      for (const t of terms) {
        let at = lower.indexOf(t);
        while (at !== -1) {
          const r = new Range();
          r.setStart(node, at);
          r.setEnd(node, at + t.length);
          ranges.push(r);
          at = lower.indexOf(t, at + t.length);
        }
      }
    }
  }
  CSS.highlights.set('doc-hit', new Highlight(...ranges));
}

function search(raw) {
  const q = raw.trim().toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t.length > 1 || q.length === 1);
  const visible = [];
  for (const item of index) {
    const hit = !terms.length || terms.every((t) => item.text.includes(t));
    item.el.hidden = !hit;
    if (hit) visible.push(item);
    // A question that matches opens; clearing the search folds them back.
    if (item.el.tagName === 'DETAILS') item.el.open = Boolean(terms.length && hit);
  }
  for (const s of sections) {
    const any = s.querySelector('[data-doc]:not([hidden])');
    s.hidden = !any;
  }
  for (const a of navLinks) {
    const target = document.querySelector(a.getAttribute('href'));
    a.parentElement.hidden = Boolean(target?.hidden);
  }
  // A sidebar group with nothing left in it goes too.
  for (const list of document.querySelectorAll('.doc-nav ul')) {
    const head = list.previousElementSibling;
    if (head?.tagName === 'H2') head.hidden = !list.querySelector('li:not([hidden])');
  }
  document.documentElement.classList.toggle('is-searching', terms.length > 0);
  if (count)
    count.textContent = terms.length
      ? `${visible.length} ${visible.length === 1 ? 'result' : 'results'}`
      : '';
  if (empty) empty.hidden = !terms.length || visible.length > 0;
  mark(terms, visible);
  const url = new URL(location.href);
  if (terms.length) url.searchParams.set('q', raw.trim());
  else url.searchParams.delete('q');
  history.replaceState(null, '', url);
}

if (input) {
  input.addEventListener('input', () => search(input.value));
  const start = new URL(location.href).searchParams.get('q');
  if (start) {
    input.value = start;
    search(start);
  }
  // "/" jumps to the search box from anywhere; Escape clears it.
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      input.focus();
      input.select();
    } else if (e.key === 'Escape' && document.activeElement === input) {
      input.value = '';
      search('');
    }
  });
  for (const b of document.querySelectorAll('[data-search]')) {
    b.addEventListener('click', () => {
      input.value = b.dataset.search;
      search(input.value);
      input.focus();
      document.querySelector('.doc-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

// The sidebar lights up the section being read.
if ('IntersectionObserver' in window && navLinks.length) {
  const byId = new Map(navLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  const seen = new Map();
  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const current = sections.find((s) => seen.get(s.id));
      for (const a of navLinks) a.classList.toggle('is-current', a === byId.get(current?.id));
    },
    { rootMargin: '-15% 0px -70% 0px' },
  );
  for (const s of sections) spy.observe(s);
}
