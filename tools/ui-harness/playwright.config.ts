// UI harness: the harness build (Tauri replaced by stub.ts) served by `vite preview` with the
// production CSP of the app, tested in Chromium (WebView2 on Windows) and WebKit (WKWebView
// on macOS). `npm run harness`. Screenshot baselines ("baseline:" tests) run on request only:
// set BASELINES=1 (PowerShell `$env:BASELINES=1`), add `--update-snapshots` to refresh them.

import { defineConfig, devices } from '@playwright/test';

const viewport = { width: 1360, height: 900 };

// One port per checkout, so parallel worktrees never test each other's build. HARNESS_PORT
// overrides it; vite.config.ts reads the same variable for `vite preview`.
function checkoutPort(): number {
  let hash = 0;
  for (const char of process.cwd()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 5200 + (hash % 700);
}
const port = Number(process.env.HARNESS_PORT) || checkoutPort();
process.env.HARNESS_PORT = String(port);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './specs',
  outputDir: '../../test-results',
  snapshotPathTemplate: '{testDir}/../baselines/{projectName}/{arg}{ext}',
  fullyParallel: true,
  // In the config, not on the command line: a command-line filter skips the projects the timing
  // project depends on, which then ran every test.
  grepInvert: process.env.BASELINES === '1' ? undefined : /baseline:/,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: origin,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport, deviceScaleFactor: 1 },
      testIgnore: /timing\.spec\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport, deviceScaleFactor: 1 },
    },
    // Timing checks (long tasks, timing.spec.ts) run in Chromium once everything else is
    // done and alone: a browser beside them on the same CPU would lengthen their tasks.
    // WebKit runs them in its project for what they check besides the timing. CI runs one
    // engine per job (HARNESS_ENGINES names it), so the timing waits for that one only.
    // Without a trace: it records a snapshot of the page's DOM on every action, on the page's
    // main thread, which added 10 to 16 ms to the tasks it measures.
    {
      name: 'timing',
      use: { ...devices['Desktop Chrome'], viewport, deviceScaleFactor: 1, trace: 'off' },
      testMatch: /timing\.spec\.ts/,
      dependencies: process.env.HARNESS_ENGINES?.split(',') ?? ['chromium', 'webkit'],
    },
  ],
  webServer: {
    command: 'npx vite build ui --mode harness && npx vite preview ui --mode harness',
    cwd: '../..',
    url: origin,
    // Always build and serve fresh: a stale server would test an old build.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
