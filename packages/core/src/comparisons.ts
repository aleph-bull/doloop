/** Who you are compared with on Social: everyone, your school, your friends, or no one. */
export type CompareScope = 'global' | 'school' | 'friends' | 'off';

export const COMPARE_SCOPES: readonly CompareScope[] = ['global', 'school', 'friends', 'off'];

/** The boards on Social: everyone's, your friends', your school's, and schools against each other. */
export type Board = 'global' | 'friends' | 'school' | 'schools';

/** The boards a choice keeps, in the leaderboard's order. */
export function boardsFor(scope: CompareScope): Board[] {
  if (scope === 'global') return ['global', 'friends', 'school', 'schools'];
  if (scope === 'off') return [];
  return [scope];
}
