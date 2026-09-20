/** FNV-1a 32-bit hash. Deterministic, dependency-free, good enough for seeding picks. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic index in [0, n) for a seed string. */
export function pickIndex(seed: string, n: number): number {
  if (n <= 0) return 0;
  return fnv1a(seed) % n;
}
