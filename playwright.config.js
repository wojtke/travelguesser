import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4179', trace: 'retain-on-failure' },
  webServer: {
    command: 'node tests/browser-server.js',
    url: 'http://127.0.0.1:4179/api/health',
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      DATA_BACKEND: 'local',
      FIREBASE_API_KEY: '',
      FIREBASE_APP_ID: '',
      FIREBASE_AUTH_DOMAIN: '',
      GOOGLE_CLOUD_PROJECT: '',
    },
  },
});
