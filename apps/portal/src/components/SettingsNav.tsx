import { createContext, useContext, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Glass, Panel } from '@komogon/ui';

/**
 * The settings page is long enough that scrolling it is not navigation. A sidebar shows
 * one group at a time, and search cuts across all of them.
 *
 * Each section declares the settings it holds as keywords. That list is what search reads:
 * a section knows what is inside it, which beats guessing from rendered text and means
 * "dark mode" finds Appearance even though those two words are never shown together.
 */
export interface SettingsSectionMeta {
  id: string;
  title: string;
  /** Plain words someone might type looking for a setting in here. */
  keywords: string[];
}

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    // You and your account, in one place.
    id: 'profile',
    title: 'Account',
    keywords: [
      'you',
      'name',
      'greeting',
      'hello',
      'what to call me',
      'display name',
      'timezone',
      'sign out',
      'email',
      // Data and privacy lives here too.
      'privacy',
      'data',
      'export data',
      'download',
      'csv',
      'json',
      'spreadsheet',
      'excel',
      'backup',
      'delete account',
      'delete data',
      'delete everything',
      'erase',
      'offline copy',
      'sold',
      'consent',
      'tracking',
    ],
  },
  {
    id: 'pages',
    title: 'Pages',
    keywords: [
      'pages',
      'nav',
      'navigation',
      'tabs',
      'hide',
      'disable',
      'turn off',
      'routines',
      'plans',
      'study plans',
      'grades',
      'calendar',
      // Layout of each page, starting with the dashboard.
      'layout',
      'navigation',
      'nav bar',
      'top bar',
      'sidebar',
      'side bar',
      'menu',
      'dashboard',
      'home',
      'quote',
      'quotes',
      'daily card',
      'research tips',
      'tips',
      'app tips',
      'hints',
    ],
  },
  {
    id: 'theme',
    title: 'Appearance',
    keywords: [
      'theme',
      'dark mode',
      'light mode',
      'accent',
      'colour',
      'color',
      'background',
      'wallpaper',
      'panel',
      'glass',
      'opacity',
      'motion',
      'animation',
      'reduced motion',
      'confetti',
    ],
  },
  {
    id: 'timer',
    title: 'Timer',
    keywords: [
      'pomodoro',
      'focus length',
      'break',
      'long break',
      'cycles',
      'auto start',
      'show timer',
    ],
  },
  {
    id: 'review',
    title: 'After each session',
    keywords: [
      'review',
      'quick',
      'full',
      'prepared',
      'distracted',
      'focus',
      'effort',
      'notes',
      'phrases',
    ],
  },
  {
    id: 'focus',
    title: 'Focus screen',
    keywords: [
      'focus',
      'pomodoro screen',
      'visualizer',
      'visualiser',
      'audio',
      'music',
      'never ask again',
      'share audio',
      'open on start',
      'opacity',
      'intensity',
      'colour',
      'color',
      'timelapse',
      'time lapse',
      'camera',
      'video',
      'webcam',
    ],
  },
  {
    id: 'sounds',
    title: 'Sounds',
    keywords: ['sound', 'volume', 'chime', 'alarm', 'mute', 'audio', 'notification'],
  },
  {
    id: 'pace',
    title: 'Pace and streaks',
    keywords: [
      'pace',
      'weekly goal',
      'goal',
      'comfortable hours',
      'maximum per day',
      'streak',
      'minimum minutes',
      'freeze',
      'rewards',
      'reward price',
      'minimum xp',
      'xp',
    ],
  },
  {
    id: 'grading',
    title: 'Grades',
    keywords: [
      'grade',
      'grading scale',
      'gpa',
      'letter grade',
      'percentage',
      'points',
      'uoft',
      'university of toronto',
      '4.0',
      'conversion',
      'goal gpa',
    ],
  },
  {
    id: 'rest-days',
    title: 'Rest days',
    keywords: ['rest day', 'day off', 'weekend', 'vacation', 'break days', 'holiday'],
  },
  {
    id: 'blocking',
    title: 'Site blocking',
    keywords: ['block', 'distracting sites', 'domains', 'extension', 'chrome'],
  },
  {
    id: 'calendar',
    title: 'Calendar',
    keywords: ['google calendar', 'sync', 'ics', 'feed', 'busy times', 'planned blocks', 'export'],
  },
  {
    id: 'history',
    title: 'Session history',
    keywords: [
      'history',
      'past sessions',
      'log',
      'delete time',
      'trim',
      'shorten',
      'forgot to stop',
      'left running',
      'edit session',
    ],
  },
];

export interface SettingsFilter {
  /** Section ids to render. */
  visible: Set<string>;
  /** True when a search is running, so sections render with their group name attached. */
  searching: boolean;
}

const FilterContext = createContext<SettingsFilter>({
  visible: new Set(SETTINGS_SECTIONS.map((s) => s.id)),
  searching: false,
});

export const SettingsFilterProvider = FilterContext.Provider;

export function useSettingsFilter(): SettingsFilter {
  return useContext(FilterContext);
}

/** Sections whose title or keywords contain every word of the query. */
export function matchSections(query: string): SettingsSectionMeta[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return SETTINGS_SECTIONS;
  return SETTINGS_SECTIONS.filter((section) => {
    const haystack = `${section.title} ${section.keywords.join(' ')}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

export interface SettingsNavProps {
  activeId: string;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  /** Ids that match the current search, for the count beside each group. */
  matched: Set<string>;
}

export function SettingsNav({ activeId, onSelect, query, onQuery, matched }: SettingsNavProps) {
  const searching = query.trim().length > 0;
  return (
    <Glass as="nav" className="settings-nav" aria-label="Settings sections">
      <div className="settings-search">
        <Search size={15} aria-hidden />
        <input
          type="search"
          className="input"
          placeholder="Search settings"
          aria-label="Search settings"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      <ul>
        {SETTINGS_SECTIONS.map((section) => {
          const dimmed = searching && !matched.has(section.id);
          return (
            <li key={section.id}>
              <button
                type="button"
                className="settings-nav-link"
                aria-current={!searching && section.id === activeId ? 'true' : undefined}
                aria-disabled={dimmed || undefined}
                onClick={() => {
                  onQuery('');
                  onSelect(section.id);
                }}
              >
                <span className={dimmed ? 'muted' : undefined}>{section.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Glass>
  );
}

/** Shown when a search matches nothing, so the page is never just blank. */
export function NoSettingsMatch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <Panel className="p-6 text-center flex flex-col gap-3">
      <p className="muted">
        Nothing in settings matches <strong>{query}</strong>.
      </p>
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClear}>
          Clear search
        </button>
      </div>
    </Panel>
  );
}

export function SectionShell({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="settings-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}
