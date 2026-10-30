import { createContext, useContext, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Glass, Panel } from '@komogon/ui';

/**
 * The settings page is long enough that scrolling it is not navigation. A sidebar shows
 * one group at a time, and search cuts across all of them.
 *
 * Each section declares the settings it holds as keywords. That list is what search reads:
 * a section knows what is inside it, which beats guessing from rendered text and means
 * "dark mode" finds Appearance even though those two words are never shown together.
 * The keywords are never shown; they are tags for search only, grouped by the setting they
 * lead to. A new setting brings its own: its label and the words someone would type for it.
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
      'account',
      // Display name.
      'name',
      'display name',
      'change name',
      'rename',
      'first name',
      'nickname',
      'greeting',
      'hello',
      'what to call me',
      // Username.
      'username',
      'user name',
      'change username',
      'handle',
      '@',
      // Picture.
      'profile',
      'picture',
      'profile picture',
      'pfp',
      'avatar',
      'photo',
      'image',
      // School.
      'school',
      'university',
      'college',
      'uni',
      'verify',
      'verified',
      'student email',
      // About you.
      'bio',
      'about you',
      'about me',
      'description',
      'timezone',
      'time zone',
      'sign out',
      'log out',
      'logout',
      'signed in',
      'email',
      // What other people see of you on Social.
      'social',
      'sharing',
      'share',
      'private',
      'public',
      'visibility',
      'who sees',
      'posts',
      'everyone',
      'friends only',
      'study totals',
      'profile stats',
      'stats',
      'leaderboard',
      'rankings',
      'jams',
      'friend requests',
      'studying now',
      'show friends when studying',
      'live',
      'online',
      'status',
      'school activity',
      'schoolmates',
      // Data and privacy lives here too.
      'privacy',
      'data',
      'export data',
      'download',
      'download a copy',
      'csv',
      'json',
      'spreadsheet',
      'excel',
      'backup',
      'on this device',
      'delete account',
      'delete data',
      'delete everything',
      'erase',
      'offline copy',
      'sold',
      'ads',
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
      'remove page',
      'routines',
      'plans',
      'study plans',
      'grades',
      'calendar',
      'social',
      'profile',
      'feed',
      'friends',
      'leaderboard',
      // Social's Comparisons.
      'compare',
      'comparing',
      'comparisons',
      'compare with others',
      'rankings',
      'global',
      'my school',
      'anxiety',
      // Layout of each page, starting with the dashboard.
      'layout',
      'dashboard',
      'home',
      'focus only',
      'simplify',
      'simple dashboard',
      'planning',
      'progress',
      'quote',
      'quotes',
      'motivation',
      'daily card',
      'research tips',
      'tips',
      'tips about the app',
      'app tips',
      'hints',
    ],
  },
  {
    id: 'theme',
    title: 'Appearance',
    keywords: [
      'look',
      'style',
      // Themes.
      'theme',
      'themes',
      'presets',
      'custom theme',
      'minimalist',
      // Mode.
      'mode',
      'dark mode',
      'light mode',
      'night mode',
      'system',
      // Accent.
      'accent',
      'accent colour',
      'accent color',
      'colour',
      'color',
      'highlight',
      // Background.
      'background',
      'wallpaper',
      'background picture',
      'background image',
      'upload background',
      'custom background',
      'my own picture',
      'background blur',
      'brightness',
      'dim',
      'texture',
      'grain',
      'dots',
      'grid',
      'extension background',
      'new tab',
      // Panels.
      'panel',
      'panels',
      'cards',
      'glass',
      'matte',
      'opaque',
      'panel colour',
      'opacity',
      'transparent',
      'transparency',
      'see through',
      // The glass sliders under Advanced.
      'blur',
      'frost',
      'frosted',
      'weight',
      'colourful',
      'saturation',
      'advanced',
      // Fonts.
      'font',
      'fonts',
      'typeface',
      'text font',
      'heading font',
      'timer font',
      'upload font',
      // Where the pages sit on a computer.
      'navigation',
      'nav bar',
      'top bar',
      'sidebar',
      'side bar',
      'menu',
      'motion',
      'animation',
      'reduced motion',
      'reduce motion',
    ],
  },
  {
    id: 'timer',
    title: 'Timer',
    keywords: [
      'pomodoro',
      // Lengths.
      'work length',
      'work minutes',
      'focus length',
      'session length',
      'break',
      'short break',
      'long break',
      'break length',
      'cycles',
      'cycles before long',
      'rounds',
      // Auto-start.
      'auto start',
      'autostart',
      'auto start breaks',
      'auto start work',
      // Jack mode.
      'jack mode',
      'dice',
      'slot machine',
      'gambling',
      // Showing the timer.
      'show timer',
      'hide timer',
      'countdown',
      'clock',
      // After each session.
      'after each session',
      'end of session',
      'summary',
      'review',
      'quick',
      'full',
      'prepared',
      'distracted',
      'focus',
      'effort',
      'notes',
      'post',
      'go to social',
      'social',
      'phrases',
      'confetti',
      'celebration',
      'badges',
      'badge toasts',
      'popups',
    ],
  },
  {
    id: 'focus',
    title: 'Focus screen',
    keywords: [
      'focus',
      'pomodoro screen',
      'full screen',
      'open on start',
      'open when a session starts',
      'new tab',
      // The visualizer.
      'visualizer',
      'visualiser',
      'audio',
      'music',
      'spotify',
      'youtube',
      'listening',
      'never ask again',
      'share audio',
      'bars',
      'glow',
      'cloud',
      'mist',
      'ribbons',
      'waveform',
      'wave',
      'circles',
      'rays',
      'beat drop',
      'bass',
      'calm when silent',
      'glowing shapes',
      'opacity',
      'intensity',
      'colour',
      'color',
      'gradient',
    ],
  },
  {
    id: 'timelapse',
    title: 'Timelapse',
    keywords: [
      'timelapse',
      'time lapse',
      'record',
      'recording',
      'always record',
      'ask to record',
      'camera',
      'webcam',
      'video',
      'phone',
      'computer',
      'preset',
      'screen',
      'screen record',
      'record my screen',
      'share screen',
      // Layout.
      'layout',
      'arrange',
      'move',
      'resize',
      'aspect ratio',
      'shape',
      'portrait',
      'landscape',
      'vertical',
      'horizontal',
      'upright',
      'sideways',
      'orientation',
      'square',
      'story',
      'reel',
      'reels',
      'stories',
      // The pieces on the video.
      'current time',
      'time of day',
      'time elapsed',
      'focus time',
      'start time',
      'end time',
      'clock',
      'task name',
      'title',
      'your text',
      'caption',
      'progress bar',
      'watermark',
      'logo',
      'pill',
      'font',
      'text colour',
      // Making the video.
      'frames per second',
      'fps',
      'resolution',
      'quality',
      'file size',
      'speed',
      'length',
      'breaks',
      'record breaks',
      'smooth',
      'smooth motion',
      'flicker',
      'deflicker',
      'even out the light',
    ],
  },
  {
    id: 'sounds',
    title: 'Sounds',
    keywords: [
      'sound',
      'volume',
      'chime',
      'alarm',
      'bell',
      'ding',
      'ringtone',
      'mute',
      'quiet',
      'silent',
      'audio',
      'notification',
      'notification sound',
      'when work starts',
      'when a break starts',
      'when the session ends',
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    keywords: [
      'notifications',
      'notify',
      'push',
      'push notifications',
      'desktop notifications',
      'phone notifications',
      'browser',
      'chrome',
      'alerts',
      'pop up',
      'bell',
      'nudges',
      'kudos',
      'likes',
      'comments',
      'mentions',
      'replies',
      'social',
    ],
  },
  {
    id: 'pace',
    title: 'Pace and streaks',
    keywords: [
      'pace',
      // Goals.
      'weekly goal',
      'goal',
      'target',
      'hours per week',
      'daily goal',
      'comfortable hours',
      'comfortable minutes per day',
      'maximum per day',
      'daily limit',
      // Streaks.
      'streak',
      'streak day',
      'daily streak',
      'weekly streak',
      'days per week',
      'days a week',
      'minimum minutes',
      'day start',
      'new day starts',
      'midnight',
      'late night',
      'night owl',
      'freeze',
      // Rewards.
      'rewards',
      'reward price',
      'minimum reward price',
      'minimum xp',
      'xp',
      'shop',
      // Rest days.
      'rest day',
      'rest days',
      'day off',
      'days off',
      'weekend',
      'vacation',
      'vacations',
      'time off',
      'break days',
      'holiday',
      'trip',
    ],
  },
  {
    id: 'grading',
    title: 'Grades',
    keywords: [
      'grade',
      'grades',
      'marks',
      'grading scale',
      'scale',
      'gpa',
      'cgpa',
      'letter grade',
      'percentage',
      'points',
      'grade points',
      'uoft',
      'university of toronto',
      '4.0',
      'conversion',
      'goal gpa',
      'target gpa',
    ],
  },
  {
    id: 'blocking',
    title: 'Site blocking',
    keywords: [
      'block',
      'blocker',
      'blocklist',
      'block websites',
      'distracting sites',
      'distractions',
      'websites',
      'domains',
      'youtube',
      'instagram',
      'tiktok',
      'reddit',
      'extension',
      'chrome',
    ],
  },
  {
    id: 'calendar',
    title: 'Calendar',
    keywords: [
      // Calendars added by link.
      'calendar link',
      'add calendar',
      'subscribe',
      'ics',
      'ical',
      'webcal',
      'url',
      'icloud',
      'apple calendar',
      'school calendar',
      'moodle',
      'canvas',
      'quercus',
      'timetable',
      'courses',
      'import',
      'midterm',
      'exams',
      'deadline',
      'deadlines into tasks',
      // Google and Outlook.
      'google calendar',
      'outlook',
      'microsoft',
      'sync',
      'busy times',
      'free slots',
      'planned blocks',
      'study calendar',
      // Your plan in another calendar app.
      'feed',
      'feed url',
      'export',
      'download ics',
      'another calendar app',
    ],
  },
  {
    id: 'history',
    title: 'Session history',
    keywords: [
      'history',
      'sessions',
      'session history',
      'past sessions',
      'log',
      'delete session',
      'delete time',
      'trim',
      'shorten',
      'wrong time',
      'fix time',
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

/**
 * Words that say what someone wants to do, not what they're looking for, so "change my
 * name" searches for "name". Used only when other words are left.
 */
const FILLER = new Set([
  'a',
  'an',
  'the',
  'my',
  'me',
  'i',
  'your',
  'to',
  'of',
  'for',
  'in',
  'on',
  'off',
  'and',
  'or',
  'how',
  'do',
  'can',
  'where',
  'what',
  'is',
  'it',
  'change',
  'edit',
  'set',
  'setting',
  'settings',
  'update',
  'make',
  'want',
  'turn',
  'switch',
  'enable',
  'disable',
  'hide',
  'show',
]);

/** Sections whose title or keywords contain every word of the query that says what it's for. */
export function matchSections(query: string): SettingsSectionMeta[] {
  const typed = query.toLowerCase().replace(/[?!,]/g, ' ').split(/\s+/).filter(Boolean);
  if (typed.length === 0) return SETTINGS_SECTIONS;
  const meant = typed.filter((w) => !FILLER.has(w));
  // A plural finds the singular: "fonts" finds "font".
  const words = (meant.length > 0 ? meant : typed).map((w) =>
    w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w,
  );
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
      <label className="settings-search">
        <Search size={15} aria-hidden />
        <input
          type="search"
          className="input"
          placeholder="Search settings"
          aria-label="Search settings"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              onQuery('');
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="settings-search-clear"
            aria-label="Clear the search"
            onClick={() => onQuery('')}
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </label>
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
    <Panel className="p-5 text-center flex flex-col gap-3">
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
