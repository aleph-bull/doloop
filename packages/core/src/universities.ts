/**
 * Ontario's universities, for the profile. The id is what the account stores; the name is
 * what a profile shows. A university goes on a profile only after a code sent to an
 * address on one of its email domains comes back, so the domains are the list that matters.
 */
export interface OntarioUniversity {
  id: string;
  name: string;
  /** A short form for tight spaces, where one is in common use. */
  short?: string;
  /** Email domains the university gives students and staff; subdomains count too. */
  domains: string[];
}

export const ONTARIO_UNIVERSITIES: readonly OntarioUniversity[] = [
  { id: 'algoma', name: 'Algoma University', domains: ['algomau.ca'] },
  { id: 'brock', name: 'Brock University', domains: ['brocku.ca'] },
  { id: 'carleton', name: 'Carleton University', domains: ['carleton.ca'] },
  { id: 'guelph', name: 'University of Guelph', domains: ['uoguelph.ca'] },
  { id: 'hearst', name: 'Université de Hearst', domains: ['uhearst.ca'] },
  { id: 'lakehead', name: 'Lakehead University', domains: ['lakeheadu.ca'] },
  { id: 'laurentian', name: 'Laurentian University', domains: ['laurentian.ca'] },
  {
    id: 'laurier',
    name: 'Wilfrid Laurier University',
    short: 'Laurier',
    domains: ['wlu.ca', 'mylaurier.ca'],
  },
  { id: 'mcmaster', name: 'McMaster University', domains: ['mcmaster.ca'] },
  { id: 'nipissing', name: 'Nipissing University', domains: ['nipissingu.ca'] },
  { id: 'ocad', name: 'OCAD University', domains: ['ocadu.ca'] },
  {
    id: 'ontario-tech',
    name: 'Ontario Tech University',
    domains: ['ontariotechu.ca', 'ontariotechu.net'],
  },
  { id: 'ottawa', name: 'University of Ottawa', domains: ['uottawa.ca'] },
  { id: 'queens', name: "Queen's University", domains: ['queensu.ca'] },
  {
    id: 'rmc',
    name: 'Royal Military College of Canada',
    short: 'RMC',
    domains: ['rmc.ca', 'rmc-cmr.ca'],
  },
  { id: 'tmu', name: 'Toronto Metropolitan University', short: 'TMU', domains: ['torontomu.ca'] },
  { id: 'toronto', name: 'University of Toronto', short: 'U of T', domains: ['utoronto.ca'] },
  { id: 'trent', name: 'Trent University', domains: ['trentu.ca'] },
  { id: 'uof', name: "Université de l'Ontario français", domains: ['uontario.ca'] },
  { id: 'waterloo', name: 'University of Waterloo', domains: ['uwaterloo.ca'] },
  { id: 'western', name: 'Western University', domains: ['uwo.ca'] },
  { id: 'windsor', name: 'University of Windsor', domains: ['uwindsor.ca'] },
  { id: 'york', name: 'York University', domains: ['yorku.ca'] },
];

export function universityById(id: string | null | undefined): OntarioUniversity | null {
  if (!id) return null;
  return ONTARIO_UNIVERSITIES.find((u) => u.id === id) ?? null;
}

export function isOntarioUniversityId(id: string): boolean {
  return ONTARIO_UNIVERSITIES.some((u) => u.id === id);
}

/**
 * The university an email address belongs to, by its domain ("mail.utoronto.ca" counts for
 * utoronto.ca), or null for any other address.
 */
export function universityForEmail(email: string): OntarioUniversity | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!domain) return null;
  return (
    ONTARIO_UNIVERSITIES.find((u) =>
      u.domains.some((d) => domain === d || domain.endsWith(`.${d}`)),
    ) ?? null
  );
}
