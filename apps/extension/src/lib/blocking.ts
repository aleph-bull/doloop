/** The sites a blocked domain covers, as Chrome's permission patterns: itself and every subdomain. */
export function blockOrigins(domain: string): string[] {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

/** The blocked domains the extension can't yet send to the focus page. */
export async function domainsWithoutPage(domains: string[]): Promise<string[]> {
  const allowed = await Promise.all(
    domains.map((d) => chrome.permissions.contains({ origins: blockOrigins(d) })),
  );
  return domains.filter((_, i) => !allowed[i]);
}
