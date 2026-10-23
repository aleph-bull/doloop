// The changelog page: its text arrives sealed and is put in place before the search starts.
// Only the last three days show; older days stay in the content and in the sidebar, inert.
import content from './content/changelog.html?sealed';
import { mountDocs } from './docs.js';

mountDocs(content, { maxAgeDays: 3 });
