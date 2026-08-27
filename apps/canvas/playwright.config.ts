import { defineConfig } from '@playwright/test';

const baseURL = process.env.DW_E2E_BASE_URL ?? 'http://127.0.0.1:4179';
const hostResolverRules = process.env.DW_E2E_HOST_RESOLVER_RULES;
export default defineConfig({
  testDir: './test/e2e',
  // Keep the approved baseline independent of the host OS; Chromium, viewport,
  // DPR and font are fixed below, so a Darwin/Linux suffix would be noise.
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  timeout: 45_000,
  fullyParallel: false,
  use: {
    browserName: 'chromium',
    baseURL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'zh-CN',
    timezoneId: 'UTC',
    ignoreHTTPSErrors: true,
    launchOptions: hostResolverRules ? { args: [`--host-resolver-rules=${hostResolverRules}`] } : undefined,
  },
  projects: [
    { name: 'fixture-ui', testMatch: /fixture-ui\.spec\.ts/ },
    { name: 'real-service', testMatch: /(real-service|html-real-service|media-real-service)\.spec\.ts/ },
    { name: 'office-real', testMatch: /office-real\.spec\.ts/ },
  ],
  webServer: process.env.DW_E2E_BASE_URL ? undefined : { command: 'pnpm --filter @dream-weave/canvas-app dev --host 127.0.0.1 --port 4179', url: baseURL, reuseExistingServer: !process.env.CI },
});
