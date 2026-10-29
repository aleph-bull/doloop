// PNG captures in ./out -> the site's webp files, with the crops the page expects.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const sharp = createRequire(new URL('../../../package.json', import.meta.url))('sharp');

const IN = process.env.SHOTS_OUT ?? fileURLToPath(new URL('./out', import.meta.url));
const SHOTS = fileURLToPath(new URL('../public/shots', import.meta.url));
mkdirSync(join(SHOTS, 'looks'), { recursive: true });

const jobs = [
  // name, source, { crop: [left, top, width, height] (device px), width, quality }
  ['today', 'today', { quality: 82 }],
  ['today-phone', 'today-phone', { quality: 82 }],
  ['feed-phone', 'feed-phone', { quality: 82 }],
  ['lineup-plan', 'lineup-plan', { quality: 82 }],
  ['lineup-track', 'lineup-track', { quality: 82 }],
  ['lineup-xp', 'lineup-xp', { quality: 82 }],
  ['xp-hero', 'xp-hero', { quality: 82 }],
  // The phone's own XP card, for the XP section on a phone (the computer's is long and thin).
  ['xp-hero-phone', 'lineup-xp', { crop: [24, 586, 1122, 594], quality: 82 }],
  // The shop and the rolls with room round their headings, from the whole-window shots (the
  // element shots crop right up to the headings, which the rounded frames then clip).
  ['shop', 'achievements', { crop: [310, 994, 2260, 806], quality: 82 }],
  ['rolls-panel', 'rolls', { crop: [310, 14, 2260, 1124], quality: 82 }],
  ['analytics', 'analytics', { width: 2400 }],
  ['social', 'feed', { width: 2400 }],
  ['board', 'leaderboard', { width: 2400 }],
  ['start-dialog', 'start-dialog', {}],
  ['focus-work', 'focus-work', {}],
  ['focus-break', 'focus-break', {}],
  ['focus-rec', 'focus-rec', {}],
  ['focus-phone', 'focus-phone', { width: 780 }],
  ['feed', 'feed-tall', { crop: [976, 208, 1020, 2700] }],
  ['groups', 'groups', { crop: [524, 392, 1984, 1064] }],
  ['jams', 'jams', { crop: [524, 204, 1984, 1260] }],
  ['cal-week', 'cal-week', { width: 2400 }],
  ['cal-plan', 'cal-plan', { width: 2400 }],
  ['cal-added', 'cal-added', { width: 2400 }],
  ['cal-phone', 'cal-phone', { width: 780 }],
];
for (const f of readdirSync(IN).filter((f) => f.startsWith('look-'))) {
  const name = f.replace(/^look-/, '').replace(/\.png$/, '');
  jobs.push([`looks/${name}`, f.replace(/\.png$/, ''), { width: 960, quality: 76 }]);
}

for (const [name, src, { crop, width, quality = 80 }] of jobs) {
  let img = sharp(join(IN, `${src}.png`));
  if (crop) img = img.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] });
  if (width) img = img.resize(width);
  const out = join(SHOTS, `${name}.webp`);
  const info = await img.webp({ quality, effort: 5 }).toFile(out);
  console.log(
    name.padEnd(22),
    `${info.width}x${info.height}`,
    `${Math.round(statSync(out).size / 1024)} KB`,
  );
}
