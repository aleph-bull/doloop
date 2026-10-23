// Turns text sealed at build time (see vite.config.js) back into the page's HTML.
const KEY = new TextEncoder().encode('komodon-study');

export function unseal(sealed) {
  const raw = atob(sealed);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++)
    bytes[i] = raw.charCodeAt(i) ^ KEY[(i * 7) % KEY.length] ^ (i & 0xff);
  return new TextDecoder().decode(bytes);
}
