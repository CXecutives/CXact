// UI harness: the harness build (Tauri replaced by stub.ts) served by `vite preview` with the
// production CSP of the app, tested in Chromium (WebView2 on Windows) and WebKit (WKWebView
// on macOS). `npm run harness` runs Chromium (what the app is edited against); `npm run harness:again`
// reruns what failed last; WebKit runs with HARNESS_ENGINES=chromium,webkit (CI and before a release)
// or `--project=webkit`. The timing project follows the engines in HARNESS_ENGINES. Screenshot baselines ("baseline:" tests) run on request only:
// set BASELINES=1 (PowerShell `$env:BASELINES=1`), add `--update-snapshots` to refresh them.

import { defineConfig, devices } from '@playwright/test';
import { WINDOW } from './specs/scale';

const viewport = WINDOW;

// One port per checkout, so parallel worktrees never test each other's build. HARNESS_PORT
// overrides it; vite.config.ts reads the same variable for `vite preview`.
function checkoutPort(): number {
  let hash = 0;
  for (const char of process.cwd()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 5200 + (hash % 700);
}
const port = Number(process.env.HARNESS_PORT) || checkoutPort();
process.env.HARNESS_PORT = String(port);
// The engines a run covers: Chromium by default, WebKit when HARNESS_ENGINES names it.
const engines = process.env.HARNESS_ENGINES?.split(',') ?? ['chromium'];
// WebKit is defined when an engine list or a `--project=webkit` asks for it.
const withWebkit = engines.includes('webkit') || process.argv.some((arg) => arg.includes('webkit'));
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
    // WebKit only by name (`--project=webkit`, or HARNESS_ENGINES naming it): it doubles a run.
    ...(withWebkit
      ? [
          {
            name: 'webkit',
            use: { ...devices['Desktop Safari'], viewport, deviceScaleFactor: 1 },
          },
        ]
      : []),
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
      dependencies: engines,
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
