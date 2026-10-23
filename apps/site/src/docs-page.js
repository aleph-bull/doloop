// The docs page: its text arrives sealed and is put in place before the search starts.
import content from './content/docs.html?sealed';
import { mountDocs } from './docs.js';

mountDocs(content);
