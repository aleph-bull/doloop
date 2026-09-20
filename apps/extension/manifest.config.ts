import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Doloop',
  description: 'Start and stop study sessions, see your timer, and block distractions.',
  version: '0.0.1',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Doloop',
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['storage', 'alarms', 'idle', 'declarativeNetRequest', 'notifications'],
  host_permissions: ['http://localhost:8787/*'],
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
});
