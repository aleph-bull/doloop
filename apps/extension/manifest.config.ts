import { defineManifest } from '@crxjs/vite-plugin';

const PORTAL_URL = process.env.VITE_PORTAL_URL ?? 'http://localhost:5173';
const API_URL = process.env.VITE_API_URL ?? 'http://localhost:8787';
const origin = (u: string) => `${new URL(u).origin}/*`;

export default defineManifest({
  manifest_version: 3,
  name: 'Komogon',
  description: 'Start and stop study sessions, see your timer, and block distractions.',
  version: '0.1.0',
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
  permissions: ['storage', 'alarms', 'declarativeNetRequest', 'notifications'],
  host_permissions: [origin(API_URL), origin(PORTAL_URL), 'https://*.supabase.co/*'],
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
