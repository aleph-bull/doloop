import directory from '../data/schools/directory.json';

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
  country?: string;
  crestUrl?: string;
  crestSource?: string;
  crestCredit?: string;
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
  {
    id: 'mcmaster',
    name: 'McMaster University',
    short: 'McMaster',
    domains: ['mcmaster.ca'],
    crestUrl: '/schools/mcmaster.gif',
    crestSource: 'https://www.mcmaster.ca/coat/',
    crestCredit: 'McMaster University, official school mark',
  },
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
  {
    id: 'toronto',
    name: 'University of Toronto',
    short: 'U of T',
    domains: ['utoronto.ca'],
    crestUrl: '/schools/toronto.png',
    crestSource: 'https://trademarks.utoronto.ca/branding-information/',
    crestCredit: 'University of Toronto, official school mark',
  },
  { id: 'trent', name: 'Trent University', domains: ['trentu.ca'] },
  { id: 'uof', name: "Université de l'Ontario français", domains: ['uontario.ca'] },
  { id: 'waterloo', name: 'University of Waterloo', domains: ['uwaterloo.ca'] },
  { id: 'western', name: 'Western University', domains: ['uwo.ca'] },
  { id: 'windsor', name: 'University of Windsor', domains: ['uwindsor.ca'] },
  { id: 'york', name: 'York University', domains: ['yorku.ca'] },
];

/** Legacy Ontario ids are retained, including student mail domain overrides. */
function buildRegistry() {
  const schools = new Map<string, OntarioUniversity>();
  for (const [name, country, rawDomains] of directory as Array<[string, string, string[]]>) {
    const id = `school:${rawDomains[0]}`;
    const previous = schools.get(id);
    if (previous) previous.domains = [...new Set([...previous.domains, ...rawDomains])];
    else schools.set(id, { id, name, country, domains: [...rawDomains] });
  }
  for (const university of ONTARIO_UNIVERSITIES) {
    for (const [id, school] of schools) {
      if (school.domains.some((d) => university.domains.includes(d))) schools.delete(id);
    }
    schools.set(university.id, { ...university, country: 'CA' });
  }
  const domains = new Map<string, OntarioUniversity | null>();
  for (const school of schools.values())
    for (const domain of school.domains) {
      const previous = domains.get(domain);
      domains.set(domain, previous === undefined || previous?.id === school.id ? school : null);
    }
  // Curated email domains take precedence over duplicate campus records in the source.
  for (const school of ONTARIO_UNIVERSITIES)
    for (const domain of school.domains) domains.set(domain, schools.get(school.id)!);
  return { schools, domains, list: [...schools.values()] };
}
let cachedRegistry: ReturnType<typeof buildRegistry> | undefined;
const registry = () => (cachedRegistry ??= buildRegistry());
export function schoolDirectory(): readonly OntarioUniversity[] {
  return registry().list;
}

export function universityById(id: string | null | undefined): OntarioUniversity | null {
  if (!id) return null;
  return registry().schools.get(id) ?? null;
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
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (registry().domains.has(candidate)) return registry().domains.get(candidate) ?? null;
  }
  return null;
}
