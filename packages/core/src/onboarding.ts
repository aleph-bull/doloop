/**
 * The first-time setup: what the questions ask and how the answers are kept. The answers
 * are for whoever runs Komodon (Admin › Onboarding answers); nothing in the app reads them
 * back except the setup itself. A question someone skipped is stored as `null`, so a skip
 * can be told apart from a question never reached (absent).
 */

/** The two looks offered first. Placeholders until the theme presets land. */
export const ONBOARDING_LOOKS = [
  { id: 'dawn-skies', label: 'Dawn skies' },
  { id: 'minimalist', label: 'Minimalist' },
] as const;
export type OnboardingLookId = (typeof ONBOARDING_LOOKS)[number]['id'];

export const ONBOARDING_USES = [
  { id: 'study', label: 'Study' },
  { id: 'books', label: 'Read books' },
  { id: 'journal', label: 'Journal' },
  { id: 'project', label: 'Personal project' },
  { id: 'on-task', label: 'Stay on task' },
  { id: 'other', label: 'Other' },
] as const;
export type OnboardingUse = (typeof ONBOARDING_USES)[number]['id'];

export const ONBOARDING_APPS = [
  { id: 'todoist', label: 'Todoist' },
  { id: 'latent', label: 'Latent' },
  { id: 'notion', label: 'Notion' },
  { id: 'other', label: 'Other' },
  { id: 'none', label: 'None' },
] as const;
export type OnboardingApp = (typeof ONBOARDING_APPS)[number]['id'];

/** Where the calendar came from, picked at the start of the calendar walk-through. */
export const ONBOARDING_CALENDARS = [
  { id: 'google', label: 'Google Calendar' },
  { id: 'outlook', label: 'Outlook' },
  { id: 'icloud', label: 'iPhone' },
  { id: 'school', label: 'Canvas, Moodle or Quercus' },
] as const;
export type OnboardingCalendar = (typeof ONBOARDING_CALENDARS)[number]['id'];

/** Not at a university: the button beside the list. */
export const NOT_IN_UNIVERSITY = 'none';

export type OnboardingSection = 'questions' | 'tour' | 'timelapse';
export type SectionEnd = 'done' | 'skipped';

export interface OnboardingAnswers {
  /** The names step was done: a username picked, a name maybe. The names themselves live on the account. */
  name?: true;
  look?: { id: OnboardingLookId; dark: boolean } | null;
  /** An id from `ONTARIO_UNIVERSITIES`, or `NOT_IN_UNIVERSITY`. Not verified. */
  university?: string | null;
  uses?: OnboardingUse[] | null;
  apps?: OnboardingApp[] | null;
  /** 'added' once a calendar came in, 'no' for "Not now". */
  calendar?: 'added' | 'no' | null;
  /** The calendar picked in the walk-through, added or not. */
  calendarFrom?: OnboardingCalendar | null;
  /** How each section ended. */
  sections?: Partial<Record<OnboardingSection, SectionEnd>>;
  /** The last question: add tasks now, or "I'm all good". */
  addTasks?: boolean;
}

/** The label for an id from one of the lists above, or the id itself. */
export function onboardingLabel(
  list: ReadonlyArray<{ id: string; label: string }>,
  id: string,
): string {
  return list.find((o) => o.id === id)?.label ?? id;
}
