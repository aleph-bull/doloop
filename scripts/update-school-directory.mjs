/** Refresh the pinned MIT-licensed Hipo directory. No email addresses leave the app. */
import { mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../packages/core/data/schools/', import.meta.url);
const headers = { 'user-agent': 'Komodon-school-directory' };
const get = async (url) => {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
};
const commit = await (
  await get('https://api.github.com/repos/Hipo/university-domains-list/commits/master')
).json();
const base = `https://raw.githubusercontent.com/Hipo/university-domains-list/${commit.sha}/`;
const records = await (await get(base + 'world_universities_and_domains.json')).json();
const blocked = new Set([
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'live.com',
  'googlemail.com',
  'icloud.com',
  'edu',
  'ac.uk',
  'edu.au',
  'on.ca',
]);
const rows = records
  .map((r) => [
    r.name,
    r.alpha_two_code,
    [
      ...new Set(
        r.domains
          .map((d) => d.trim().toLowerCase())
          .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !blocked.has(d)),
      ),
    ],
  ])
  .filter((r) => r[2].length)
  .sort((a, b) => a[2][0].localeCompare(b[2][0]) || a[0].localeCompare(b[0]));
await mkdir(root, { recursive: true });
await writeFile(new URL('directory.json', root), JSON.stringify(rows) + '\n');
await writeFile(new URL('LICENSE.txt', root), await (await get(base + 'LICENSE.txt')).text());
await writeFile(
  new URL('source.json', root),
  JSON.stringify(
    {
      repository: 'https://github.com/Hipo/university-domains-list',
      commit: commit.sha,
      retrieved: new Date().toISOString(),
      records: rows.length,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Stored ${rows.length} school records at ${commit.sha}`);
