import { defineManifest } from '@crxjs/vite-plugin';

const PORTAL_URL = process.env.VITE_PORTAL_URL ?? 'http://localhost:5173';
const API_URL = process.env.VITE_API_URL ?? 'http://localhost:8787';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const origin = (u: string) => `${new URL(u).origin}/*`;

export default defineManifest({
  manifest_version: 3,
  name: 'Komogon',
  description: 'Start and stop study sessions, see your timer, and block distractions.',
  version: '0.2.0',
  homepage_url: 'https://komogon.app',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Komogon',
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      // Receives the signed-in session from the portal so the remote can talk to the API.
      matches: [origin(PORTAL_URL)],
      js: ['src/content/bridge.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['storage', 'alarms', 'declarativeNetRequest'],
  // Supabase's address only for a build that signs in with it (komogon.app doesn't).
  host_permissions: [
    ...new Set([
      origin(API_URL),
      origin(PORTAL_URL),
      ...(SUPABASE_URL ? [origin(SUPABASE_URL)] : []),
    ]),
  ],
  // Blocking needs no access to the sites: a blocked site gets Chrome's own page. Sending it
  // to the focus page instead is a redirect, which Chrome allows only on sites the extension
  // may read, so the popup asks for exactly the blocked sites, once (2026-11-04).
  optional_host_permissions: ['*://*/*'],
  web_accessible_resources: [
    {
      resources: ['src/blocked/index.html'],
      matches: ['<all_urls>'],
    },
  ],
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
});
