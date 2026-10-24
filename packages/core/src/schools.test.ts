import { describe, expect, it } from 'vitest';
import {
  ONTARIO_UNIVERSITIES,
  schoolDirectory,
  universityById,
  universityForEmail,
} from './universities';
import { withDefaults } from './defaults';

describe('school directory', () => {
  it('keeps existing school ids and student domains while supporting the global snapshot', () => {
    expect(schoolDirectory().length).toBeGreaterThan(10_000);
    for (const school of ONTARIO_UNIVERSITIES) {
      expect(universityById(school.id)?.name).toBe(school.name);
      for (const domain of school.domains)
        expect(universityForEmail(`student@${domain}`)?.id).toBe(school.id);
    }
    expect(universityForEmail('student@mail.utoronto.ca')?.id).toBe('toronto');
    expect(universityForEmail('student@mylaurier.ca')?.id).toBe('laurier');
    expect(universityForEmail('student@mit.edu')?.name).toBe(
      'Massachusetts Institute of Technology',
    );
    expect(universityForEmail('student@ox.ac.uk')?.name).toContain('Oxford');
    expect(universityForEmail('student@ubc.ca')?.name).toContain('British Columbia');
  });
  it('uses domain boundaries and never grants school identity from a personal provider or bare suffix', () => {
    for (const domain of [
      'evilutoronto.ca',
      'utoronto.ca.evil.test',
      'gmail.com',
      'outlook.com',
      'edu',
      'ac.uk',
      'school-unknown.test',
    ]) {
      expect(universityForEmail(`student@${domain}`)).toBeNull();
    }
    expect(universityForEmail('STUDENT@MAIL.UTORONTO.CA')?.id).toBe('toronto');
    expect(withDefaults({}).social.schoolActivity).toBe(false);
  });
});
