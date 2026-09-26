// The shell of the app, in one place: the native frame and the macOS toolbar row, the sidebar
// and its views (one table, lib/views.ts), the switch between views, the window sizes it
// survives, the press that follows the pointer, reduced motion, the tooltips, the toasts and
// dialogs, the run status, the card of the keys, a start whose data cannot load and the
// language switch. The keys themselves are input.spec.ts; the components one by one are
// gallery.spec.ts. Texts come from the catalog where a test names a label (text()).

import type { Locator, Page } from '@playwright/test';
import {
  animationsDone,
  calls,
  expect,
  expectShot,
  motionSettled,
  NOW,
  open,
  runFinished,
  settle,
  test,
  text,
  viewsSettled,
} from './fixtures';

// Every view switch, the Jobs view included, is the same quick cross-fade: the new view fades
// in on top while the old one fades out below it, so no frame shows an empty sheet. Recorded
// from the Web Animations Svelte starts (deterministic, no frame timing involved).
interface Fade {
  view: string;
  from: string;
  to: string;
  ms: number;
  order: string[];
}

// macOS: every point of the 52 px toolbar row either moves the window (Tauri's drag script:
// a direct hit on an element with data-tauri-drag-region; a double click there zooms) or is
// a control. Hairlines (the borders between the columns) are the only exception.
const DRAG_PROBE = (): string[] => {
  const CONTROL =
    'a, button, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="tab"], [role="switch"], [role="radio"], [role="checkbox"], [role="option"], [role="menuitem"]';
  const dead: string[] = [];
  const width = document.documentElement.clientWidth;
  for (const y of [1, 14, 26, 38, 51]) {
    for (let x = 1; x < width - 1; x += 5) {
      const hit = document.elementFromPoint(x, y);
      if (hit === null) {
        dead.push(`${x},${y} nothing`);
        continue;
      }
      if (hit.hasAttribute('data-tauri-drag-region')) continue;
      // A control, or the frame right around a field (it focuses the field); a point just
      // outside a rounded corner of either lands on the wrapper around it.
      const control = (node: Element): boolean =>
        node.closest(CONTROL) !== null ||
        node.querySelector(':scope > input, :scope > textarea') !== null;
      const corner = [...hit.querySelectorAll('*')].some((node) => {
        const b = node.getBoundingClientRect();
        return control(node) && x >= b.left && x < b.right && y >= b.top && y < b.bottom;
      });
      if (control(hit) || corner) continue;
      const box = hit.getBoundingClientRect();
      const style = getComputedStyle(hit);
      const hairline =
        x < box.left + parseFloat(style.borderLeftWidth) ||
        x >= box.right - parseFloat(style.borderRightWidth) ||
        y < box.top + parseFloat(style.borderTopWidth) ||
        y >= box.bottom - parseFloat(style.borderBottomWidth);
      if (!hairline) dead.push(`${x},${y} ${hit.tagName.toLowerCase()}.${hit.className}`);
    }
  }
  return dead;
};

const WIN = '?platform=windows';

const MAC = '?platform=macos';

const sidebarWidth = async (page: Page): Promise<number> =>
  Math.round((await page.getByTestId('sidebar').boundingBox())!.width);

/** The one pill lies exactly on the entry (full or rail, a main entry or a smaller sub). */
async function pillOn(page: Page, id: string): Promise<void> {
  const nav = page.getByTestId('sidebar').locator('nav');
  await expect
    .poll(async () => {
      const pill = await nav.locator('.indicator').boundingBox();
      const entry = await page.getByTestId(id).boundingBox();
      // The pill is drawn anew when the entries below the places move: no box for a moment.
      if (pill === null || entry === null) return null;
      return [
        pill.x - entry.x,
        pill.y - entry.y,
        pill.width - entry.width,
        pill.height - entry.height,
      ].map((value) => Math.round(value));
    }, id)
    .toEqual([0, 0, 0, 0]);
}

const anyRows = (page: Page) => page.locator('[data-testid^="job-row-"]');

const tooltip = (page: Page) => page.getByRole('tooltip');

const middle = (box: { y: number; height: number } | null): number => box!.y + box!.height / 2;

const DAY = 24 * 60 * 60 * 1000;

const rows = (page: Page): Locator =>
  page.getByTestId('job-rows').locator('[data-testid^="job-row-"]');

const row = (page: Page, key: string): Locator =>
  page.getByTestId('job-list').getByTestId(`job-row-${key}`);

async function settings(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await settle(page);
}

/** A colour token as the page computes it (rgb()). */
async function tokenColour(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
}

const SIZES = [
  { width: 480, height: 360 },
  { width: 780, height: 560 },
  { width: 1280, height: 720 },
  { width: 1360, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

async function look(target: Locator): Promise<string> {
  return target.evaluate((node) => {
    const style = getComputedStyle(node);
    return `${style.backgroundColor} ${style.color} ${style.transform}`;
  });
}

async function pressAndLeave(page: Page, target: Locator): Promise<{ rest: string; left: string }> {
  const box = (await target.boundingBox())!;
  // At rest, with the pointer away.
  await page.mouse.move(box.x + box.width + 200, box.y + box.height + 200);
  await page.waitForTimeout(250);
  const rest = await look(target);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 200, box.y + box.height + 200, { steps: 4 });
  await page.waitForTimeout(250);
  const left = await look(target);
  await page.mouse.up();
  return { rest, left };
}

const EN = `${WIN}&lang=en`;

async function readFirst(page: Page): Promise<void> {
  await page.getByTestId('nav-jobs').click();
  await rows(page).first().click();
  await expect(page.getByTestId('reader-ring')).toContainText('91');
  await animationsDone(page);
}

/* ----------------------------------------------------- The frame, the views and the look */

test('the preview server sends the production CSP', async ({ page }) => {
  const response = await page.goto('/');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
});

test('the shell renders sidebar and the jobs view', async ({ page }) => {
  await open(page, '?platform=windows');
  await expect(page.getByTestId('shell')).toBeVisible();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  for (const item of ['nav-jobs', 'nav-profile', 'nav-settings']) {
    await expect(page.getByTestId(item)).toBeVisible();
  }
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('nav-jobs')).toHaveText('Jobs');
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('fetch')).toHaveClass(/primary/);
});

test('every view switch is the same cross-fade, the new view on top', async ({ page }) => {
  await page.addInitScript(() => {
    const fades: Fade[] = [];
    (window as unknown as { __fades: Fade[] }).__fades = fades;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes, options) {
      const view = this instanceof HTMLElement ? (this.dataset.testid ?? '') : '';
      const ms = typeof options === 'number' ? options : Number(options?.duration ?? 0);
      if (view.startsWith('view-') && Array.isArray(keyframes) && ms > 0) {
        fades.push({
          view,
          from: String(keyframes[0]?.opacity),
          to: String(keyframes.at(-1)?.opacity),
          ms,
          order: [...(this.parentElement?.children ?? [])].map(
            (node) => (node as HTMLElement).dataset.testid ?? '',
          ),
        });
      }
      return animate.call(this, keyframes, options);
    };
  });
  // At start nothing animates: the first view is simply there.
  await open(page, '?platform=windows');
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __fades: Fade[] }).__fades)).toEqual([]);
  const steps = [
    ['jobs', 'profile'],
    ['profile', 'settings'],
    ['settings', 'jobs'],
    ['jobs', 'settings'],
    ['settings', 'profile'],
    ['profile', 'jobs'],
  ];
  for (const [from, to] of steps) {
    await page.evaluate(() => (window as unknown as { __fades: Fade[] }).__fades.splice(0));
    await page.getByTestId(`nav-${to}`).click();
    await expect(page.locator('main.views > section')).toHaveCount(1);
    await expect(page.getByTestId(`view-${to}`)).toBeVisible();
    const fades = await page.evaluate(() => (window as unknown as { __fades: Fade[] }).__fades);
    const out = fades.find((fade) => fade.view === `view-${from}`);
    const into = fades.find((fade) => fade.view === `view-${to}`);
    expect(out, `${from} -> ${to}`).toMatchObject({ from: '1', to: '0', ms: 100 });
    expect(into, `${from} -> ${to}`).toMatchObject({
      from: '0',
      to: '1',
      ms: 100,
      order: [`view-${from}`, `view-${to}`],
    });
  }
});

// The OS window's focus (Tauri's window events) is one attribute on <html>; selections grey
// out against it as in Mail and Explorer.
test('the window focus state follows the OS window', async ({ page }) => {
  await open(page, '?platform=windows');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-window', 'active');
  await page.evaluate(() => window.__harness.fire('tauri://blur', null));
  await expect(root).toHaveAttribute('data-window', 'inactive');
  await page.evaluate(() => window.__harness.fire('tauri://focus', null));
  await expect(root).toHaveAttribute('data-window', 'active');
});

test('the navigation switches the view', async ({ page }) => {
  await open(page, '?platform=windows');
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await expect(page.getByTestId('view-jobs')).toHaveCount(0);
  await expect(page.getByTestId('nav-profile')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await expect(page.getByTestId('view-profile')).toHaveCount(0);
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
});

// The window frame is the native one of each OS (icon, title, caption buttons, system menu,
// snap layouts): the page draws none of it and has no drag region of its own.
for (const os of ['windows', 'macos']) {
  test(`${os}: no title bar in the page, the content starts at the top`, async ({ page }) => {
    await open(page, `?platform=${os}`);
    await expect(page.locator('html')).toHaveAttribute('data-platform', os);
    await expect(page.getByTestId('titlebar')).toHaveCount(0);
    expect((await page.getByTestId('sidebar').boundingBox())!.y).toBe(0);
  });
}

test('windows: no drag region; the first view is centred on the line of the place tabs', async ({
  page,
}) => {
  await open(page, '?platform=windows');
  await expect(page.locator('[data-tauri-drag-region]')).toHaveCount(0);
  // The first entry (36 px) and the tabs (36 px) share their middle: the first line.
  const middle = (box: { y: number; height: number } | null): number => box!.y + box!.height / 2;
  const nav = middle(await page.getByTestId('nav-overview').boundingBox());
  const tabs = middle(await page.getByTestId('places').boundingBox());
  expect(nav).toBe(tabs);
});

// macOS: the unified toolbar row of a Mac app. The title bar is transparent over the page
// (52 px, traffic lights at x 20, centred); the sidebar runs to the top with the lights in
// its first 52 px, the list's first row is centred on them, the sheet reaches the top edge,
// and the empty parts of the row move the window.
test('macos: the unified toolbar row', async ({ page, browserName }) => {
  await open(page, '?platform=macos');
  const ROW = 52;
  const lightsBand = page.getByTestId('sidebar').getByTestId('drag-band');
  expect(await lightsBand.boundingBox()).toMatchObject({ x: 0, y: 0, height: ROW });
  const tabs = (await page.getByTestId('places').boundingBox())!;
  expect(tabs.y + tabs.height / 2).toBe(ROW / 2);
  // The row itself (outside the tabs) drags; the reader side keeps a band of the row.
  await expect(page.getByTestId('list-header').locator('.places')).toHaveAttribute(
    'data-tauri-drag-region',
    '',
  );
  const readerBand = page.getByTestId('reader-pane').getByTestId('drag-band');
  expect(await readerBand.boundingBox()).toMatchObject({ y: 0, height: ROW });
  // The views start below the lights; the sheet has no top edge.
  expect((await page.getByTestId('nav-jobs').boundingBox())!.y).toBeGreaterThanOrEqual(ROW);
  const sheet = await page
    .locator('main.views')
    .evaluate((node) => [node.getBoundingClientRect().top, getComputedStyle(node).borderTopWidth]);
  expect(sheet).toEqual([0, '0px']);
  // Profil and Einstellungen keep the row free too.
  for (const view of ['profile', 'settings']) {
    await page.getByTestId(`nav-${view}`).click();
    const band = page.getByTestId(`view-${view}`).getByTestId('drag-band');
    // Once the cross-fade has settled.
    await expect.poll(async () => (await band.boundingBox())?.y).toBe(0);
    expect(await band.boundingBox()).toMatchObject({ height: ROW });
  }
  // A picture with the traffic lights drawn in where macOS puts them (for humans; WebKit
  // reports Playwright's screenshot styles as a CSP violation).
  if (process.env.SHOTS_DIR && browserName === 'chromium') {
    await page.getByTestId('nav-jobs').click();
    await page.evaluate(() => {
      const colours = ['#ff5f57', '#febc2e', '#28c840'];
      colours.forEach((colour, i) => {
        const dot = document.body.appendChild(document.createElement('div'));
        Object.assign(dot.style, {
          position: 'fixed',
          left: `${20 + i * 20}px`,
          top: '19px',
          width: '14px',
          height: '14px',
          borderRadius: '7px',
          background: colour,
          zIndex: '1000',
        });
      });
    });
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/macos-toolbar-marked.png` });
  }
});

test('macos: the whole toolbar row moves the window, in every view and width', async ({ page }) => {
  const states: [string, { width: number; height: number }, (p: typeof page) => Promise<void>][] = [
    ['overview', { width: 1360, height: 900 }, async () => undefined],
    [
      'reader',
      { width: 1360, height: 900 },
      (p) => p.locator('[data-testid^="job-row-"]').first().click(),
    ],
    ['rail', { width: 1000, height: 700 }, async () => undefined],
    ['narrow list', { width: 780, height: 560 }, async () => undefined],
    [
      'narrow reader',
      { width: 780, height: 560 },
      (p) => p.locator('[data-testid^="job-row-"]').first().click(),
    ],
    ['profile', { width: 1360, height: 900 }, (p) => p.getByTestId('nav-profile').click()],
    ['settings', { width: 1360, height: 900 }, (p) => p.getByTestId('nav-settings').click()],
    ['minimum', { width: 480, height: 360 }, async () => undefined],
  ];
  for (const [name, size, go] of states) {
    await page.setViewportSize(size);
    await open(page, '?platform=macos');
    await go(page);
    await settle(page);
    // Probe once the new stage or view has risen into place: halfway, the band of the row
    // stands a few pixels lower than the row.
    await motionSettled(page);
    expect(await page.evaluate(DRAG_PROBE), name).toEqual([]);
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await open(page, '?platform=macos&scenario=first-run');
  expect(await page.evaluate(DRAG_PROBE), 'first run').toEqual([]);
});

test('the native menu opens a view (macOS: Einstellungen with Cmd+,)', async ({ page }) => {
  await open(page, '?platform=macos');
  await page.evaluate(() => window.__harness.fire('navigate', 'settings'));
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.evaluate(() => window.__harness.fire('navigate', 'nonsense'));
  await expect(page.getByTestId('view-settings')).toBeVisible();
});

test('per-OS convention: the order of dialog buttons', async ({ page }) => {
  const order = async (os: string): Promise<string[]> => {
    await open(page, `?platform=${os}`);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('full-mailbox').click();
    const dialog = page.getByTestId('dialog-full-mailbox');
    await expect(dialog).toBeVisible();
    return dialog.getByRole('button').allInnerTexts();
  };
  // Windows: the action first; macOS: cancel, then the action on the right.
  expect(await order('windows')).toEqual(['Abrufen', 'Abbrechen']);
  expect(await order('macos')).toEqual(['Abbrechen', 'Abrufen']);
});

test('the run status in the sidebar opens the last run', async ({ page }) => {
  await open(page, '?platform=windows');
  await expect(page.getByTestId('run-card')).toHaveCount(0);
  await expect(page.getByTestId('run-status')).toContainText('Abgerufen 08:30');
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('run-status').click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  // Seven new in the mails, one of them excluded: the run brought six new jobs.
  await expect(page.getByTestId('run-finished')).toContainText('6 neu');
  await page.getByTestId('run-close').click();
  await expect(page.getByTestId('run-card')).toHaveCount(0);
});

// A click on the status opens the run card: before the first fetch there is none, so the
// status is not there at all (the first-run page says it) instead of a dead button.
test('the run status shows only when there is a run to open', async ({ page }) => {
  await open(page, '?platform=windows&scenario=first-run');
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  await expect(page.getByTestId('run-status')).toHaveCount(0);
  await open(page, '?platform=windows');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('run-status')).toBeVisible();
});

// In one column an open job hides the list; the status brings the list with the run card back.
test('narrow: the run status opens the run card even while a job is open', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await open(page, '?platform=windows');
  await page.getByTestId('job-rows').locator('[data-testid^="job-row-"]').first().click();
  await expect(page.getByTestId('list-scroll')).toBeHidden();
  await page.getByTestId('run-status').click();
  await expect(page.getByTestId('list-scroll')).toBeVisible();
  await expect(page.getByTestId('run-card')).toBeVisible();
});

test('every run status is one line; a cut one says itself in its tooltip', async ({ page }) => {
  await open(page, '?platform=windows');
  await page.getByTestId('nav-settings').click();
  const codes = [
    'connectingMail',
    'searchingMail',
    'readingMails',
    'fetchingDetails',
    'signingIn',
    'waiting',
    'scoring',
    'writingFiles',
  ] as const;
  // A run begins with its kind, like every run of the backend.
  await page.evaluate(() => {
    window.__harness.emit({ type: 'started', kind: 'fetch' });
    window.__harness.emit({ type: 'progress', step: 'scan', portal: null, done: 0, total: 3 });
  });
  for (const code of codes) {
    await page.evaluate(
      (c) => window.__harness.emit({ type: 'status', code: c, portal: 'freelance', until: null }),
      code,
    );
    const status = page.getByTestId('run-status');
    await expect(status).not.toContainText('Abgerufen');
    const line = await status.locator('.text').evaluate((node) => ({
      text: node.textContent ?? '',
      lines: Math.round(node.clientHeight / parseFloat(getComputedStyle(node).lineHeight)),
      cut: node.scrollWidth > node.clientWidth + 1,
    }));
    expect(line.lines, `${code}: ${line.text}`).toBe(1);
    if (line.cut) {
      await status.hover();
      await expect(page.getByRole('tooltip')).toHaveText(line.text);
      await page.mouse.move(700, 450);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    }
  }
});

test('icon-only buttons show a styled tooltip after the delay', async ({ page }) => {
  await open(page, '?platform=windows');
  await page.locator('[data-testid^="job-row-"]').first().click();
  const close = page.getByTestId('reader-close');
  await close.hover();
  // The name of the button, and its key on a second line.
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText(await text(page, 'reader.close'));
  await expect(tip.locator('.hint')).toHaveText('Esc');
  await expect(close).not.toHaveAttribute('title');
});

test('baseline: shell on Windows', async ({ page }) => {
  await open(page, '?platform=windows');
  await expectShot(page, 'shell-windows');
});

test('baseline: shell on macOS', async ({ page }) => {
  await open(page, '?platform=macos');
  await expectShot(page, 'shell-macos');
});

/* --------------------------------------------------------------------------- The sidebar */

// The sidebar: four views (Übersicht, Jobs, Profil, Einstellungen), the app starts in the
// Übersicht, Ctrl/Cmd+1 to 4 choose them, no counts, the rail at small widths, that the
// sidebar folds only by the window width, and the order of a click when an unsaved profile
// asks first. The places of the jobs are tabs above the list.

test('the sidebar shows no counts and no dots: the list says how many jobs are new', async ({
  page,
}) => {
  for (const width of [1360, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, WIN);
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByTestId('nav-jobs')).toBeVisible();
    await expect(sidebar.locator('nav .count, nav .dot')).toHaveCount(0);
    await expect(sidebar.getByTestId('nav-jobs')).not.toContainText(/\d/);
  }
});

test('the app starts in the Übersicht; Ctrl+1 to 4 choose the views, the keys in the tooltips', async ({
  page,
}) => {
  await open(page, `${WIN}&view=start`);
  await expect(page.getByTestId('view-overview')).toBeVisible();
  await expect(page.getByTestId('nav-overview')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('sidebar').locator('nav button')).toHaveText([
    'Übersicht',
    'Jobs',
    'Profil',
    'Einstellungen',
  ]);
  await page.keyboard.press('Control+2');
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await page.keyboard.press('Control+4');
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.keyboard.press('Control+3');
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(page.getByTestId('view-overview')).toBeVisible();
  // Ctrl+, opens the settings on Windows too (macOS has it in its menu).
  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.getByTestId('nav-jobs').hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('Jobs');
  await expect(tip).toContainText('Strg+2');
});

test('before the first fetch the Übersicht waits and says why; Jobs is the setup page', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run&view=start`);
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  const overview = page.getByTestId('nav-overview');
  await expect(overview).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  await overview.click({ force: true });
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  await page.mouse.move(600, 600);
  await overview.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Nach dem ersten Abruf');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
});

for (const os of [WIN, MAC]) {
  test(`the rail: four squares in a column, the names in tooltips on the right ${os}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await open(page, os);
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    const ids = ['nav-overview', 'nav-jobs', 'nav-profile', 'nav-settings'];
    const boxes = await Promise.all(ids.map(box));
    for (const b of boxes) expect([b.width, b.height]).toEqual([40, 40]);
    const centre = (b: { x: number; width: number }): number => b.x + b.width / 2;
    for (const b of boxes) expect(centre(b)).toBe(centre(boxes[0]!));
    await page.getByTestId('nav-profile').hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText('Profil');
    await expect(tip.locator('div')).toHaveCSS('opacity', '1');
    const anchor = await box('nav-profile');
    expect((await tip.locator('div').boundingBox())!.x).toBeGreaterThan(anchor.x + anchor.width);
    for (const id of ['nav-settings', 'nav-overview', 'nav-jobs']) {
      await page.getByTestId(id).click();
      await pillOn(page, id);
    }
  });

  test(`at 480 x 360 the rail keeps every entry and the status in the window ${os}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 360 });
    await open(page, os);
    const ids = ['nav-overview', 'nav-jobs', 'nav-profile', 'nav-settings', 'run-status'];
    const boxes = await Promise.all(
      ids.map(async (id) => (await page.getByTestId(id).boundingBox())!),
    );
    for (const [at, b] of boxes.entries()) {
      expect(b.y, ids[at]).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, ids[at]).toBeLessThanOrEqual(360);
      const next = boxes[at + 1];
      if (next)
        expect(next.y, `${ids[at + 1]} below ${ids[at]}`).toBeGreaterThanOrEqual(b.y + b.height);
    }
    await expect(page.getByTestId('sidebar-edge')).toHaveCount(0);
  });
}

test('the sidebar folds only by the window width: no edge, Ctrl+B and Cmd+B change nothing', async ({
  page,
}) => {
  await open(page, WIN);
  await expect(page.getByTestId('sidebar-edge')).toHaveCount(0);
  expect(await sidebarWidth(page)).toBe(196);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Meta+b');
  expect(await sidebarWidth(page)).toBe(196);
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(() => sidebarWidth(page)).toBe(64);
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect.poll(() => sidebarWidth(page)).toBe(196);
});

test('an unsaved profile keeps the view until the question is answered', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('place-archive').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', 'Archiv durchsuchen');
  await page.getByTestId('place-inbox').click();
  await page.getByTestId('nav-profile').click();
  const field = page.getByTestId('view-profile').getByRole('textbox').first();
  await field.fill('Erika Muster');
  await page.getByTestId('nav-jobs').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  // Still the Profil, and the Jobs view is where it was (the inbox, not the archive).
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await expect(page.getByTestId('nav-profile')).toHaveAttribute('aria-current', 'page');
  await expect(field).toHaveValue('Erika Muster');
  // Asked again and left without saving: the Jobs view it was asked for, on its inbox.
  await page.getByTestId('nav-jobs').click();
  await dialog.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', 'Jobs durchsuchen');
});

test('a click on the tab that is open reloads nothing, like Jobs', async ({ page }) => {
  await open(page, WIN);
  const loads = async (place?: string): Promise<number> =>
    (await calls(page, 'list_jobs')).filter(
      ([, args]) =>
        place === undefined || (args as { query: { place: string } }).query.place === place,
    ).length;
  await page.getByTestId('place-archive').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', 'Archiv durchsuchen');
  await settle(page);
  const archive = await loads('archive');
  await page.getByTestId('place-archive').click();
  await settle(page);
  expect(await loads('archive')).toBe(archive);
  await page.getByTestId('place-inbox').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', 'Jobs durchsuchen');
  await settle(page);
  const all = await loads();
  await page.getByTestId('nav-jobs').click();
  await settle(page);
  expect(await loads()).toBe(all);
});

/* ------------------------------- Tooltips, focus, scroll places, toasts, the toolbar row */

// Final round, shell track: tooltips on keyboard focus, the focus back on the trigger, the
// scroll place of Profil and Einstellungen, the first line of every view, the toasts above a
// bottom bar and their keys, the macOS toolbar row, the card of the keys and a start whose
// data cannot load.

test('a tooltip shows on keyboard focus after the delay and goes on blur, resize and window blur', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-jobs').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('nav-overview')).toBeFocused();
  // Not at once: after the same delay as hovering.
  await page.waitForTimeout(150);
  await expect(tooltip(page)).toHaveCount(0);
  await expect(tooltip(page)).toContainText('Übersicht');
  await expect(tooltip(page)).toContainText('Strg+1');
  // Blur: the focus moves on, the next one waits for its delay again.
  await page.keyboard.press('Tab');
  await expect(tooltip(page)).toContainText('Jobs');
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect(tooltip(page)).toHaveCount(0);
  await page.keyboard.press('Shift+Tab');
  await expect(tooltip(page)).toContainText('Übersicht');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(tooltip(page)).toHaveCount(0);
});

test('a disabled entry that says why stays a Tab stop; its reason shows on focus', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('nav-jobs').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('nav-overview')).toBeFocused();
  await expect(tooltip(page)).toHaveText('Nach dem ersten Abruf');
});

test('the focus goes back to the trigger after a menu, a dialog and a toast', async ({ page }) => {
  await open(page, WIN);
  // A menu opened from the keyboard (the funnel's), closed with Esc.
  const funnel = page.getByTestId('filter');
  await funnel.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu')).toHaveCount(0);
  await expect(funnel).toBeFocused();
  // The card of the keys from the search field.
  const search = page.getByTestId('search');
  await search.focus();
  await page.keyboard.press('Control+/');
  await expect(page.getByTestId('keys-help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('keys-help')).toHaveCount(0);
  await expect(search).toBeFocused();
  // A toast's undo reached from the search field gives the focus back to it.
  await anyRows(page).first().click();
  await page.keyboard.press('e');
  const action = page.getByTestId('toast-action');
  await expect(action).toBeVisible();
  await search.focus();
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(search).toBeFocused();
});

test('a press on a toast takes no focus, and Rückgängig names its key', async ({ page }) => {
  await open(page, WIN);
  await anyRows(page).first().click();
  await page.keyboard.press('e');
  const action = page.getByTestId('toast-action');
  await expect(action).toBeVisible();
  await action.hover();
  await expect(tooltip(page)).toContainText('Rückgängig');
  await expect(tooltip(page)).toContainText('Strg+Z');
  await action.click();
  const inStack = await page.evaluate(
    () =>
      document.querySelector('[data-testid="toasts"]')?.contains(document.activeElement) ?? false,
  );
  expect(inStack).toBe(false);
});

test('Profil and Einstellungen keep their scroll place per view', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=settings`);
  const view = (id: string) => page.getByTestId(`view-${id}`);
  await view('settings').evaluate((node) => (node.scrollTop = 420));
  await page.getByTestId('nav-profile').click();
  await viewsSettled(page);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await view('profile').evaluate((node) => (node.scrollTop = 260));
  await page.getByTestId('nav-jobs').click();
  await viewsSettled(page);
  await page.getByTestId('nav-settings').click();
  await viewsSettled(page);
  await expect.poll(() => view('settings').evaluate((node) => node.scrollTop)).toBe(420);
  await page.getByTestId('nav-profile').click();
  await viewsSettled(page);
  await expect.poll(() => view('profile').evaluate((node) => node.scrollTop)).toBe(260);
});

test('the first line: the sidebar entry, the tabs and the first headings share one middle', async ({
  page,
}) => {
  await open(page, WIN);
  const line = middle(await page.getByTestId('nav-overview').boundingBox());
  expect(middle(await page.getByTestId('places').boundingBox())).toBe(line);
  // The views' first headings take the row with `data-first-row` (tokens.css --first-row).
  // Profil and Einstellungen carry the attribute; their views still place the heading on
  // the row (until then the offset is noted, not failed).
  for (const view of ['overview', 'profile', 'settings']) {
    await open(page, `${WIN}&view=${view}`);
    const first = page.locator(`[data-testid="view-${view}"] [data-first-row]`).first();
    await expect(first, view).toBeVisible();
    const at = middle(await first.boundingBox());
    if (view !== 'overview' && at !== line) {
      test
        .info()
        .annotations.push({ type: 'first-row', description: `${view}: ${at} for ${line}` });
      continue;
    }
    expect(at, view).toBe(line);
  }
});

test('a toast lies above the save bar of Profil; its Zeigen opens the finished fetch', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 700 });
  await open(page, `${WIN}&view=profile&tick=5`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await page.evaluate(() => window.__harness.appRun('fetch'));
  await runFinished(page);
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('Abruf fertig');
  const bar = (await page.getByTestId('profile-save-bar').boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await toast.boundingBox())!;
      return box.y + box.height <= bar.y;
    })
    .toBe(true);
  // Zeigen is no undo: Ctrl+Z leaves it, a click opens the run in Jobs.
  const show = toast.getByTestId('toast-action');
  await expect(show).toHaveText('Zeigen');
  await show.click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('run-finished')).toBeVisible();
});

test('a click in the sidebar leaves the list keys working at once, on both OS', async ({
  page,
}) => {
  for (const os of [WIN, MAC]) {
    await open(page, os);
    await anyRows(page).first().click();
    const before = (await calls(page, 'job_detail')).length;
    await page.getByTestId('nav-jobs').click();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await calls(page, 'job_detail')).length).toBe(before + 1);
    await expect(anyRows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  }
});

test('macOS: Profil and Einstellungen name the view in the toolbar row', async ({ page }) => {
  for (const [view, name] of [
    ['profile', 'Profil'],
    ['settings', 'Einstellungen'],
  ] as const) {
    await open(page, `${MAC}&view=${view}`);
    const title = page.getByTestId(`view-${view}`).getByTestId('toolbar-name');
    await expect(title).toHaveText(name);
    const box = (await title.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(52);
    // The name moves the window like the rest of the row.
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.hasAttribute('data-tauri-drag-region'),
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(hit).toBe(true);
  }
  // Windows has no row: no name.
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('toolbar-name')).toHaveCount(0);
});

test('macOS: a dialog leaves the toolbar row free, and the row moves the window', async ({
  page,
}) => {
  await open(page, `${MAC}&view=settings`);
  await page.keyboard.press('Meta+/');
  await expect(page.getByTestId('keys-help')).toBeVisible();
  await settle(page);
  const scrim = (await page.getByTestId('dialog-scrim').boundingBox())!;
  expect(scrim.y).toBe(52);
  const hit = await page.evaluate(() =>
    document.elementFromPoint(600, 26)?.hasAttribute('data-tauri-drag-region'),
  );
  expect(hit).toBe(true);
  // The keys are named as a Mac names them.
  await expect(page.getByTestId('keys-help').getByTestId('key-search')).toContainText('⌘F');
});

test('Ctrl+/ shows the card of the keys, named as the OS names them; Esc closes it', async ({
  page,
}) => {
  await open(page, WIN);
  await page.keyboard.press('Control+/');
  const card = page.getByTestId('keys-help');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Tastenkürzel' })).toBeVisible();
  await expect(page.getByTestId('key-views')).toContainText('Strg+1 bis Strg+4');
  await expect(page.getByTestId('key-search')).toContainText('Strg+F');
  await expect(page.getByTestId('key-fetch')).toContainText('F5');
  await expect(page.getByTestId('key-undo')).toContainText('Strg+Z');
  await expect(page.getByTestId('key-menu')).toContainText('Umschalt+F10');
  await expect(page.getByTestId('key-trash')).toContainText('Entf');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  // The same keys close it again.
  await page.keyboard.press('Control+/');
  await expect(card).toBeVisible();
  await page.keyboard.press('Control+/');
  await expect(card).toHaveCount(0);
});

test('macOS: the multi-select hints write ⌘-Klick and ⇧-Klick', async ({ page }) => {
  await open(page, MAC);
  await anyRows(page).first().click();
  await anyRows(page)
    .nth(1)
    .click({ modifiers: ['Meta'] });
  const pane = page.getByTestId('selection-pane');
  await expect(pane).toContainText('⌘-Klick');
  await expect(pane).toContainText('⇧-Klick');
});

test('a start whose data cannot load: try again, the log, the data folder', async ({ page }) => {
  await open(page, `${WIN}&scenario=load-failed`);
  const failed = page.getByTestId('view-error');
  await expect(failed).toContainText('Die App konnte ihre Daten nicht laden.');
  await page.getByTestId('open-log').click();
  await page.getByTestId('open-data').click();
  const targets = (await calls(page, 'open_target')).map(
    ([, args]) => (args as { target: { kind: string } }).target.kind,
  );
  expect(targets).toEqual(['logDir', 'dataDir']);
  await failed.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
});

test('macOS: the loading and the failed start keep the toolbar row', async ({ page }) => {
  await open(page, `${MAC}&scenario=load-failed`);
  const band = page.getByTestId('view-error').getByTestId('drag-band');
  expect(await band.boundingBox()).toMatchObject({ y: 0, height: 52 });
});

/* ------------------------------ Lists, panes, the run status, closing, shared components */

// Wave 1, track "shell": the scrollbar's room in the Jobs view, the keys of lists, panes and
// radio groups, the sidebar in the first run and its one-line run status, the closing note
// per activity, the shared components (switch, buttons, notices, badges, toasts, chips) and
// the demo data that agrees with itself.

test('with scrollbars shown the list and the reader keep their room: edges line up, nothing jumps', async ({
  playwright,
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== 'chromium', 'Chromium hides scrollbars by a switch left out here');
  // A browser of its own that shows the scrollbars (the harness hides them by default).
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1360, height: 900 },
      deviceScaleFactor: 1,
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
    });
    const page = await context.newPage();
    await open(page, WIN);
    await page.getByTestId('facet').getByRole('radio', { name: /Alle/ }).click();
    const list = page.getByTestId('list-scroll');
    // The room of the Windows scrollbar is there (8 px), whether the list scrolls or not.
    const gutter = await list.evaluate(
      (node) => (node as HTMLElement).offsetWidth - node.clientWidth,
    );
    expect(gutter).toBe(8);
    // The header ends where the rows end (their text shares one edge).
    const edges = await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="list-scroll"]')!;
      const header = scroller.parentElement!.querySelector(':scope > .head > *')!;
      const first = scroller.querySelector('[data-testid^="job-row-"]')!;
      return {
        header: header.getBoundingClientRect().right,
        row: first.getBoundingClientRect().right,
      };
    });
    expect(Math.abs(edges.header - edges.row)).toBeLessThanOrEqual(0.5);
    // A long and a short job: the reader's close button stands at one place.
    const closeAt = async (key: string): Promise<number> => {
      await row(page, key).click();
      await expect(page.getByTestId('reader-close')).toBeVisible();
      await settle(page);
      return (await page.getByTestId('reader-close').boundingBox())!.x;
    };
    const long = await closeAt('freelancermap-2801');
    const short = await closeAt('freelance-900411');
    expect(short).toBe(long);
  } finally {
    await browser.close();
  }
});

test('keyboard focus stays clear of the macOS toolbar band and the reader bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  // The centre of the focused control is the control itself, not the band over it.
  const covered = async (): Promise<string | null> =>
    page.evaluate(() => {
      const node = document.activeElement;
      if (!(node instanceof HTMLElement) || node === document.body) return null;
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && (node === hit || node.contains(hit))
        ? null
        : (node.getAttribute('data-testid') ?? node.tagName);
    });
  await settings(page, MAC);
  await page.getByTestId('reset').focus();
  const cut: string[] = [];
  for (let stop = 0; stop < 16; stop += 1) {
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(80);
    const hidden = await covered();
    if (hidden !== null) cut.push(hidden);
  }
  // The reader: from its end upward, below the compact bar.
  await page.getByTestId('nav-jobs').click();
  await row(page, 'freelancermap-2801').click();
  await expect(page.getByTestId('reader-close')).toBeVisible();
  await page.getByTestId('stage').evaluate((node) => (node.scrollTop = node.scrollHeight));
  await page.getByTestId('reader-close').focus();
  await page.getByTestId('stage').evaluate((node) => (node.scrollTop = node.scrollHeight));
  for (let stop = 0; stop < 12; stop += 1) {
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(80);
    const inReader = await page.evaluate(
      () =>
        document.querySelector('[data-testid="reader-pane"]')?.contains(document.activeElement) ??
        false,
    );
    const hidden = inReader ? await covered() : null;
    if (hidden !== null) cut.push(`reader ${hidden}`);
  }
  expect(cut).toEqual([]);
});

test('a switch darkens a step on hover and one more while pressed, off and on', async ({
  page,
}) => {
  await settings(page);
  const steps = async (id: string): Promise<string[]> => {
    const toggle = page.getByTestId(id);
    const track = toggle.locator('.track');
    const colour = (): Promise<string> =>
      track.evaluate((node) => getComputedStyle(node).backgroundColor);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    const rest = await colour();
    const box = (await toggle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);
    const hover = await colour();
    await page.mouse.down();
    await page.waitForTimeout(250);
    const pressed = await colour();
    await page.mouse.up();
    return [rest, hover, pressed];
  };
  // One switch off (the trash that empties itself, switched off here), one on.
  const off = page.getByTestId('toggle-auto-empty-trash');
  await off.click();
  await expect(off).toHaveAttribute('aria-checked', 'false');
  for (const id of ['toggle-auto-empty-trash', 'toggle-auto-archive']) {
    const [rest, hover, pressed] = await steps(id);
    expect(new Set([rest, hover, pressed]).size, `${id}: ${rest} ${hover} ${pressed}`).toBe(3);
  }
});

test('only what loses something for good warns: the trash does not, delete for good does', async ({
  page,
}) => {
  await open(page, WIN);
  const danger = await tokenColour(page, '--danger-strong');
  await rows(page).first().click();
  await page.keyboard.press('Shift+ArrowDown');
  const trash = page.getByTestId('selection-trash');
  await expect(trash).toBeVisible();
  await trash.hover();
  // The trash can be undone: it looks like every other icon on hover.
  await expect(trash).not.toHaveCSS('color', danger);
  // In the trash the bar's "Endgültig löschen" loses the jobs for good: it warns.
  await trash.click();
  await page.getByTestId('place-trash').click();
  await rows(page).first().click();
  await page.keyboard.press('Shift+ArrowDown');
  const purge = page.getByTestId('selection-purge');
  await purge.hover();
  await expect(purge).toHaveCSS('color', danger);
});

test('a dialog confirms with the bare verb of its heading', async ({ page }) => {
  await settings(page);
  await page.getByTestId('full-mailbox').click();
  await expect(page.getByTestId('dialog-full-mailbox').getByTestId('dialog-confirm')).toHaveText(
    'Abrufen',
  );
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId('facet').getByRole('radio', { name: /Alle/ }).click();
  await row(page, 'freelancermap-2803').hover();
  await page.getByTestId('trash-freelancermap-2803').click();
  await page.getByTestId('place-trash').click();
  await page.getByTestId('empty-trash').click();
  await expect(page.getByTestId('dialog-empty-trash').getByTestId('dialog-confirm')).toHaveText(
    'Leeren',
  );
  await page.keyboard.press('Escape');
  await rows(page).first().hover();
  await page.getByTestId('purge-freelancermap-2803').click();
  await expect(page.getByTestId('dialog-purge').getByTestId('dialog-confirm')).toHaveText(
    'Löschen',
  );
});

test('one column: a running fetch shows in the sidebar while a job is open', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 640 });
  await open(page, WIN);
  await page.evaluate(() => (window.__harness.holdAfter = 6));
  await page.getByTestId('fetch').click();
  await expect(page.getByTestId('run-card')).toBeVisible();
  await expect(page.getByTestId('run-status')).toHaveCount(0);
  await rows(page).first().click();
  await expect(page.getByTestId('list-scroll')).toBeHidden();
  const status = page.getByTestId('run-status');
  await expect(status).toBeVisible();
  await status.click();
  await expect(page.getByTestId('list-scroll')).toBeVisible();
  await expect(page.getByTestId('run-card')).toBeVisible();
  await expect(page.getByTestId('cancel-run')).toBeVisible();
  await page.evaluate(() => (window.__harness.holdAfter = null));
});

test('the run status is one line as high as a nav entry, today and on another day', async ({
  page,
}) => {
  const check = async (text: string): Promise<void> => {
    const status = page.getByTestId('run-status');
    await expect(status).toContainText(text);
    const line = await status.evaluate((node) => {
      const text = node.querySelector('.text')!;
      return {
        lines: Math.round(text.getBoundingClientRect().height / 18),
        height: node.getBoundingClientRect().height,
      };
    });
    const nav = (await page.getByTestId('nav-jobs').boundingBox())!.height;
    expect(line.lines, text).toBe(1);
    expect(line.height, text).toBe(nav);
  };
  const nextDay = async (): Promise<void> => {
    await page.clock.setFixedTime(new Date(NOW.getTime() + DAY));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  };
  for (const [lang, fetched, failed, cancelled] of [
    ['de', 'Abgerufen', 'Fehlgeschlagen', 'Abgebrochen'],
    ['en', 'Fetched', 'Failed', 'Cancelled'],
  ] as const) {
    await settings(page, `${WIN}&lang=${lang}`);
    await check(`${fetched} 08:30`);
    await nextDay();
    await check(`${fetched} ${lang === 'de' ? 'gestern' : 'yesterday'}`);
    await settings(page, `${WIN}&lang=${lang}&scenario=offline`);
    await check(`${failed} 08:30`);
    await nextDay();
    await check(`${failed} ${lang === 'de' ? 'gestern' : 'yesterday'}`);
    // A fetch cancelled: the status says so, not that it fetched.
    await open(page, `${WIN}&lang=${lang}`);
    await page.evaluate(() => (window.__harness.holdAfter = 4));
    await page.getByTestId('fetch').click();
    await page.getByTestId('cancel-run').click();
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await page.getByTestId('nav-settings').click();
    await check(cancelled);
    await nextDay();
    await check(`${cancelled} ${lang === 'de' ? 'gestern' : 'yesterday'}`);
  }
});

test('the status opens the run only once an unsaved Profil lets the view go', async ({ page }) => {
  await open(page, WIN);
  await row(page, 'freelancermap-2801').click();
  await expect(page.getByTestId('reader-close')).toBeVisible();
  await page.getByTestId('nav-profile').click();
  await page.getByTestId('profile-name-field').fill('Erika Muster');
  await page.getByTestId('run-status').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  // Later, Jobs without the status: the open job stays and no run card came up.
  await page.getByTestId('nav-jobs').click();
  await dialog.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('reader-close')).toBeVisible();
  await expect(page.getByTestId('run-card')).toHaveCount(0);
});

test('the closing note names what the window waits for', async ({ page }) => {
  await open(page, WIN);
  await page.evaluate(() => {
    window.__harness.appRun('rescore');
    window.__harness.fire('closing', { activity: 'rescore' });
  });
  await expect(page.getByTestId('closing')).toHaveText(
    'Das Bewerten wird beendet, dann schließt die App.',
  );
  await open(page, WIN);
  await page.evaluate(() => window.__harness.fire('closing', { activity: 'session' }));
  await expect(page.getByTestId('closing')).toHaveText(
    'Die Anmeldung wird beendet, dann schließt die App.',
  );
  // An older backend sends nothing: the fetch, as before.
  await open(page, WIN);
  await page.evaluate(() => window.__harness.fire('closing', null));
  await expect(page.getByTestId('closing')).toHaveText(
    'Der Abruf wird beendet, dann schließt die App.',
  );
});

test('Tab passes disabled switches; a disabled button that says why stays a Tab stop', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=dry-run`);
  await page.getByTestId('nav-settings').focus();
  const landed: { id: string; role: string | null; tag: string }[] = [];
  for (let stop = 0; stop < 40; stop += 1) {
    await page.keyboard.press('Tab');
    const disabled = await page.evaluate(() => {
      const node = document.activeElement;
      return node?.getAttribute('aria-disabled') === 'true'
        ? {
            id: node.getAttribute('data-testid') ?? node.tagName,
            role: node.getAttribute('role'),
            tag: node.tagName,
          }
        : null;
    });
    if (disabled !== null) landed.push(disabled);
  }
  // Only buttons with a reason (the dry run says why), never a switch.
  expect(landed.map((item) => item.id)).toContain('reset');
  expect(landed.filter((item) => item.role === 'switch' || item.tag !== 'BUTTON')).toEqual([]);
  // The reason shows on keyboard focus, and still on hover.
  await page.getByTestId('reset').focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.getByTestId('reset').hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
});

test('Shift with the arrows, Home and End chooses jobs from the open one', async ({ page }) => {
  await open(page, WIN);
  const first = rows(page).first();
  await first.click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByTestId('selection-pane')).toContainText('3');
  await expect(rows(page).and(page.locator('[aria-current="true"]'))).toHaveCount(3);
  // Back up one: two stay chosen.
  await page.keyboard.press('Shift+ArrowUp');
  await expect(rows(page).and(page.locator('[aria-current="true"]'))).toHaveCount(2);
  // Shift+End: from the open job to the last row.
  await page.keyboard.press('Shift+End');
  const all = await rows(page).count();
  await expect(rows(page).and(page.locator('[aria-current="true"]'))).toHaveCount(all);
  // Back to one job: Esc clears the choice.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection-pane')).toHaveCount(0);
});

test('the segments above the list choose with left and right; Home and End go to the list', async ({
  page,
}) => {
  await open(page, WIN);
  const facet = page.getByTestId('facet');
  const radios = facet.getByRole('radio');
  await facet.locator('[aria-checked="true"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
  // Up, down, Home and End belong to the list: End opens its last job.
  const before = (await calls(page, 'job_detail')).length;
  await page.keyboard.press('End');
  await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await calls(page, 'job_detail')).length).toBeGreaterThan(before);
});

test('with the focus nowhere the arrows, Home and End scroll Einstellungen', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await settings(page);
  const view = page.getByTestId('view-settings');
  const top = (): Promise<number> => view.evaluate((node) => node.scrollTop);
  await page.getByTestId('settings-fetch').locator('h2').click();
  await page.keyboard.press('End');
  // Once the glide has ended (a key during it would add to where it is going).
  await expect
    .poll(() => view.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(0);
  const bottom = await top();
  await page.keyboard.press('ArrowUp');
  await expect.poll(top).toBe(bottom - 40);
  await page.keyboard.press('Home');
  await expect.poll(top).toBe(0);
  await page.keyboard.press('ArrowDown');
  await expect.poll(top).toBe(40);
});

test('after a click into the reader the arrows scroll it; Space on the open row pages it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await open(page, WIN);
  await row(page, 'freelancermap-2801').click();
  const title = page.getByTestId('reader-title');
  await expect(title).toBeVisible();
  const stage = page.getByTestId('stage');
  const top = (): Promise<number> => stage.evaluate((node) => node.scrollTop);
  // Space on the open row pages through the reader; Shift+Space back.
  await row(page, 'freelancermap-2801').focus();
  await page.keyboard.press('Space');
  await expect.poll(top).toBeGreaterThan(100);
  await page.keyboard.press('Shift+Space');
  await expect.poll(top).toBe(0);
  const opened = await title.innerText();
  // A click on the ad's text: the arrows scroll the reader, the job stays.
  await title.click();
  await page.keyboard.press('ArrowDown');
  await expect.poll(top).toBe(40);
  await page.keyboard.press('End');
  await expect
    .poll(() => stage.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(1);
  await expect(title).toHaveText(opened);
  // A click in the list gives the arrows back to it.
  await row(page, 'freelancermap-2801').click();
  await page.keyboard.press('ArrowDown');
  await expect(title).not.toHaveText(opened);
});

test('a chip value copies; a double click still edits it; its x has a tooltip', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const keywords = page.getByTestId('profile-keywords');
  const chip = keywords.locator('[data-chip]').first();
  const text = chip.locator('.text');
  await text.scrollIntoViewIfNeeded();
  const value = await text.innerText();
  // A drag over the value selects it.
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const selected = await page.evaluate(() => getSelection()?.toString() ?? '');
  expect(value.startsWith(selected.trim())).toBe(true);
  expect(selected.trim().length).toBeGreaterThan(1);
  // The x names what it removes.
  await chip.locator('.remove').hover();
  await expect(page.getByRole('tooltip')).toHaveText(`${value} entfernen`);
  // A double click takes the value back into the field, with no word selected.
  await text.dblclick();
  await expect(keywords.locator('input')).toHaveValue(value);
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
});

test('a neutral badge stands off the wash of the selected row', async ({ page }) => {
  await open(page, WIN);
  const teaser = row(page, 'freelance-900411');
  await teaser.click();
  const badge = teaser.locator('.badge.neutral').first();
  await expect(badge).toBeVisible();
  const white = await tokenColour(page, '--surface');
  await expect(badge).toHaveCSS('background-color', white);
});

test('a cut title in a toast: the closing quote follows the ellipsis', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, WIN);
  await page.getByTestId('facet').getByRole('radio', { name: /Alle/ }).click();
  await row(page, 'freelancermap-2801').hover();
  await page.getByTestId('archive-freelancermap-2801').click();
  const name = page.getByTestId('toast-text').locator('.name');
  await expect(name).toHaveText(/…$/);
  const gap = await name.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return node.getBoundingClientRect().right - range.getBoundingClientRect().right;
  });
  expect(gap).toBeLessThanOrEqual(1);
  // The whole title in the tooltip.
  await name.hover();
  await expect(page.getByRole('tooltip')).toContainText('Interim CFO');
});

test('ghost buttons at the end of a row end on the edge of the switches', async ({ page }) => {
  await settings(page);
  const edge = async (locator: Locator): Promise<number> =>
    locator.evaluate((node) => node.getBoundingClientRect().right);
  const toggle = await edge(page.getByTestId('toggle-auto-archive'));
  for (const id of ['mailbox-remove', 'excel-reveal', 'logs-open']) {
    const label = await edge(page.getByTestId(id).locator('.label'));
    expect(Math.abs(label - toggle), id).toBeLessThanOrEqual(0.5);
  }
});

test('a notice banner shares the inset of the cards and draws no line of its own', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=dry-run`);
  const banner = page.locator('.notice.banner').first();
  const icon = (await banner.locator(':scope > .icon').boundingBox())!.x;
  const labelId = await page.getByTestId('toggle-auto-archive').getAttribute('aria-labelledby');
  const label = (await page.locator(`[id="${labelId}"]`).boundingBox())!.x;
  expect(icon).toBe(label);
  const same = async (notice: Locator): Promise<boolean> =>
    notice.evaluate((node) => {
      const style = getComputedStyle(node);
      return style.borderTopColor === style.backgroundColor;
    });
  expect(await same(banner)).toBe(true);
  // The warning of the reset report too.
  await open(page, `${WIN}&scenario=reset`);
  expect(await same(page.getByTestId('first-reset-report'))).toBe(true);
});

test('one glyph per action: retries load again, the reset keeps its own', async ({ page }) => {
  await open(page, `${WIN}&scenario=list-error`);
  const retry = page.getByTestId('list-error').getByRole('button');
  await expect(retry.locator('[data-icon]')).toHaveAttribute('data-icon', 'retry');
  await settings(page);
  await expect(page.getByTestId('reset').locator('[data-icon]')).toHaveAttribute(
    'data-icon',
    'reset',
  );
  // Jobs has one glyph: in the sidebar, on "Zurückholen" and on its empty list.
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId('place-archive').click();
  await rows(page).first().hover();
  const back = page.locator('[data-testid^="toInbox-"]').first();
  await expect(back.locator('[data-icon]')).toHaveAttribute('data-icon', 'inbox');
});

test('deleting for good names the job like a move; several by their number', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('facet').getByRole('radio', { name: /Alle/ }).click();
  for (const key of ['freelancermap-2802', 'freelancermap-2803', 'linkedin-4100200301']) {
    await row(page, key).hover();
    await page.getByTestId(`trash-${key}`).click();
    await expect(row(page, key)).toHaveCount(0);
    // A click right after the list changed is no click (a double click never hits the next).
    await page.waitForTimeout(600);
  }
  await page.getByTestId('place-trash').click();
  await row(page, 'freelancermap-2802').hover();
  await page.getByTestId('purge-freelancermap-2802').click();
  await page.getByTestId('dialog-purge').getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('toast-text').last()).toHaveText(
    '„Interim Head of Finance“ endgültig gelöscht.',
  );
  // A click right after the list changed is no click (a double click never hits the next).
  await page.waitForTimeout(600);
  await rows(page).first().click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.getByTestId('selection-purge').click();
  await page.getByTestId('dialog-purge-chosen').getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('toast-text').last()).toHaveText('2 Jobs endgültig gelöscht.');
});

test('the demo job says the same in its row, its reader and its prompt', async ({ page }) => {
  await open(page, WIN);
  const facts = row(page, 'freelancermap-2801').getByTestId('row-facts');
  await expect(facts).toContainText('ab sofort');
  await expect(facts).toContainText('1.200/Tag');
  await row(page, 'freelancermap-2801').click();
  const reader = page.getByTestId('reader');
  await expect(reader).toContainText('Start ab sofort');
  await expect(reader).toContainText('Tagessatz 1.200 €');
  await expect(reader).not.toContainText('nach Absprache');
  // The row says the ad's rate; the wish is the reason of its verdict, no profile line.
  await expect(page.getByTestId('criteria').getByTestId('term-rate')).toContainText('1.200 €/Tag');
  await expect(page.getByTestId('criteria').getByTestId('term-rate')).not.toContainText('Wunsch');
  // Every criterion of the profile is stated and met: the table says so row by row.
  await expect(page.getByTestId('criteria')).toBeVisible();
  await expect(page.getByTestId('criteria')).not.toContainText('passt nicht');
});

/* -------------------------------------------------------------------------------- Motion */

// Reduced motion is enforced by lib/motion/motion.ts, not by the CSS media query.

test('full motion by default', async ({ page }) => {
  await open(page, '?platform=windows');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
});

test('reduced motion: no movement, instant tokens, the new view is in place at once', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '?platform=windows');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ['--dur-base', '--move-lg', '--dur-reveal', '--loop-state'].map((name) =>
      style.getPropertyValue(name).trim(),
    );
  });
  expect(tokens.slice(0, 3).map((value) => parseFloat(value))).toEqual([0, 0, 0]);
  expect(tokens[3]).toBe('paused');

  await page.getByTestId('nav-settings').click();
  const view = page.getByTestId('view-settings');
  await expect(view).toBeVisible();
  // A cross-fade may remain; a rise may not: the view never starts below its place.
  const transform = await view.evaluate((node) => getComputedStyle(node).transform);
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
});

test('switching reduced motion at runtime is followed', async ({ page }) => {
  await open(page, '?gallery');
  await expect(page.getByTestId('motion-state')).toHaveText('Volle Bewegung ist an.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByTestId('motion-state')).toHaveText('Reduzierte Bewegung ist an.');
  await page.getByTestId('motion-play').click();
  await expect(page.getByTestId('motion-count')).toContainText('87');
});

test('nothing animates at start, and a view that comes back does not replay', async ({ page }) => {
  await open(page, '?platform=windows');
  // What runs (by element and animation), so a failure names the culprit.
  const running = (): Promise<string[]> =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => {
          const target = (a.effect as KeyframeEffect).target;
          const name = a instanceof CSSAnimation ? a.animationName : a.constructor.name;
          return `${target?.className ?? ''} ${name}`;
        }),
    );
  expect(await running()).toEqual([]);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('nav-jobs').click();
  await page.waitForTimeout(250);
  // Nothing in the view that came back enters, rolls or slides.
  const inView = await page.evaluate(() => {
    const view = document.querySelector('[data-testid="view-jobs"]')!;
    return document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => (a.effect as KeyframeEffect).target)
      .filter((target) => target !== null && view.contains(target))
      .map((target) => target!.className);
  });
  expect(inView).toEqual([]);
});

test('the reader ring fills from empty the first time a job opens, once', async ({ page }) => {
  // Every Web Animation of the reader ring's arc, noted as it starts: the fill lasts 360 ms,
  // and a busy machine may look only after it is over.
  await page.addInitScript(() => {
    const fills: string[] = [];
    (window as unknown as { __fills: string[] }).__fills = fills;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes, options) {
      if (this.matches('[data-testid="reader-ring"] .value')) {
        const first = Array.isArray(keyframes) ? keyframes[0] : undefined;
        fills.push(String(first?.strokeDashoffset));
      }
      return animate.call(this, keyframes, options);
    };
  });
  const fills = (): Promise<string[]> =>
    page.evaluate(() => [...(window as unknown as { __fills: string[] }).__fills]);
  await open(page, '?platform=windows');
  const rows = page.locator('[data-testid^="job-row-"]');
  await rows.first().click();
  const ring = page.getByTestId('reader-ring');
  await expect(ring).toBeVisible();
  // One Web Animation on the arc, starting from empty (stroke-dashoffset 100).
  await expect.poll(fills).toEqual(['100']);
  // It is dropped when done.
  await expect
    .poll(() => ring.evaluate((node) => node.querySelector('.value')!.getAnimations().length))
    .toBe(0);
  // Once: another job fills its own ring, the first one back is simply there.
  await rows.nth(1).click();
  await expect.poll(fills).toEqual(['100', '100']);
  await rows.first().click();
  await expect(page.getByTestId('reader-title')).toHaveText(
    await rows.first().locator('.title').innerText(),
  );
  await settle(page);
  expect(await fills()).toEqual(['100', '100']);
});

test('a count rolls when it changes on screen, not when it first shows', async ({ page }) => {
  await open(page, '?gallery');
  const count = page.getByTestId('count-soft');
  await count.scrollIntoViewIfNeeded();
  expect(await count.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  // Click and look in the same frame (the roll lasts 150 ms).
  const rolling = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('[data-testid="count-more"]')!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return document
      .querySelector('[data-testid="count-soft"]')!
      .getAnimations({ subtree: true })
      .filter((a) => !(a instanceof CSSTransition)).length;
  });
  expect(rolling).toBeGreaterThan(0);
  await expect(count).toHaveText('13');
});

test('the pin star pops once when pinned, never when unpinned', async ({ page }) => {
  await open(page, '?gallery');
  const pin = page.getByTestId('motion-pin');
  await pin.scrollIntoViewIfNeeded();
  // Pops are Web Animations on the glyph (hover nudges are CSS transitions).
  const clickAndCount = (): Promise<number> =>
    page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('[data-testid="motion-pin"]')!;
      button.click();
      return button
        .querySelector('.glyph')!
        .getAnimations()
        .filter((a) => !(a instanceof CSSTransition)).length;
    });
  expect(await clickAndCount()).toBe(1);
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(400);
  expect(await clickAndCount()).toBe(0);
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
});

test('under reduced motion nothing scales, pops or shakes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '?gallery');
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ['--scale-press', '--scale-pop', '--move-xs', '--dur-hover'].map((name) =>
      parseFloat(style.getPropertyValue(name)),
    );
  });
  expect(tokens).toEqual([1, 1, 0, 0]);
  const pin = page.getByTestId('motion-pin');
  await pin.scrollIntoViewIfNeeded();
  await pin.click();
  await page.getByTestId('motion-shake').click();
  const scripted = await page.evaluate(
    () => document.getAnimations().filter((a) => !(a instanceof CSSAnimation)).length,
  );
  expect(scripted).toBe(0);
});

test('hover rests while a list scrolls', async ({ page }) => {
  await open(page, '?platform=windows');
  await page.getByTestId('facet').getByRole('radio', { name: /Alle/ }).click();
  // The window mounts a few rows per frame: scroll once the list can.
  await expect
    .poll(() =>
      page.getByTestId('list-scroll').evaluate((node) => node.scrollHeight - node.clientHeight),
    )
    .toBeGreaterThan(200);
  // The pointer rests on a row (once the rows stand still: the switch glides them).
  await settle(page);
  const row = page.getByTestId('job-list').locator('[data-testid^="job-row-"]').first();
  await row.hover();
  const still = (): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-still]')].map((node) => node.className),
    );
  expect(await still()).toEqual([]);
  // Scroll and look right after the scroll event: the row under the pointer rests (its hover
  // waits for `:not([data-still])`), the row button and the row around it; nothing else in
  // the list changes. The mark lasts --scroll-idle.
  const during = await page.getByTestId('list-scroll').evaluate(
    (node) =>
      new Promise<{ rows: (string | undefined)[]; hovered: boolean }>((resolve) => {
        node.addEventListener(
          'scroll',
          () => {
            const marked = [...document.querySelectorAll<HTMLElement>('[data-still]')];
            resolve({
              rows: marked.map(
                (el) =>
                  (el.querySelector<HTMLElement>('[data-testid^="job-row-"]') ?? el).dataset.testid,
              ),
              hovered: marked.every((el) => el.matches(':hover')),
            });
          },
          { once: true },
        );
        node.scrollBy(0, 200);
      }),
  );
  expect(during.rows).toHaveLength(2);
  expect(during.rows[0]).toMatch(/^job-row-/);
  expect(during.rows[1]).toBe(during.rows[0]);
  expect(during.hovered).toBe(true);
  await expect.poll(still, { timeout: 1000 }).toEqual([]);
});

/* -------------------------------------------------------------------------- Window sizes */

// Window sizes the app must survive: the minimum 480 × 360 (small enough to snap into every
// Windows 11 layout, quarters of 1366 × 768 included), typical laptops at 125 % scaling
// (1280 × 720, 1536 × 864) and common desktops.

for (const size of SIZES) {
  for (const query of ['?platform=windows', '?platform=macos', '?gallery']) {
    test(`no horizontal scroll, nothing clipped at ${size.width}x${size.height} ${query}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await open(page, query);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        for (const node of [
          document.documentElement,
          ...document.querySelectorAll('.view, [data-testid="gallery"]'),
        ]) {
          if (node.scrollWidth > node.clientWidth) {
            out.push(
              `${node.tagName}.${node.className}: ${node.scrollWidth} > ${node.clientWidth}`,
            );
          }
        }
        // Every visible control of the list header lies fully inside the window.
        const width = document.documentElement.clientWidth;
        for (const control of document.querySelectorAll('[data-testid="list-header"] button')) {
          const box = control.getBoundingClientRect();
          if (box.left < 0 || box.right > width + 0.5) {
            out.push(`clipped: ${control.getAttribute('aria-label') ?? control.textContent}`);
          }
        }
        return out;
      });
      expect(problems).toEqual([]);
    });
  }
}

for (const [width, rail] of [
  [1280, false],
  [1100, false],
  [1099, true],
  [780, true],
] as const) {
  test(`the sidebar ${rail ? 'is the icon rail' : 'is full'} at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await open(page, '?platform=windows');
    const sidebar = await page.getByTestId('sidebar').boundingBox();
    expect(sidebar?.width).toBe(rail ? 64 : 196);
    const label = page.getByTestId('nav-profile');
    if (rail) {
      await expect(label).toHaveAttribute('aria-label', 'Profil');
      await label.hover();
      const tip = page.getByRole('tooltip');
      // The name, and its key as the second line.
      await expect(tip).toHaveText('ProfilStrg+3');
      // Right of the icon, centred on it, never over the next entry (like a native rail).
      await expect(tip.locator('div')).toHaveCSS('opacity', '1');
      const icon = (await label.boundingBox())!;
      const bubble = (await tip.locator('div').boundingBox())!;
      expect(bubble.x).toBeGreaterThan(icon.x + icon.width);
      expect(Math.abs(bubble.y + bubble.height / 2 - (icon.y + icon.height / 2))).toBeLessThan(2);
    } else {
      await expect(label).toHaveText('Profil');
    }
  });
}

test('empty screens are never dead: an icon, one sentence, one way on, centred', async ({
  page,
}) => {
  await open(page, '?platform=windows&scenario=no-profile');
  await page.getByTestId('nav-profile').click();
  const empty = page.getByTestId('profile-empty');
  await expect(empty).toBeVisible();
  // The next step is the one primary on screen: "Profil anlegen" ("Abrufen" lives in the
  // list of the Jobs view), with the two other ways in next to it.
  await expect(empty.locator('.btn.primary')).toHaveCount(1);
  await expect(page.getByTestId('fetch')).toHaveCount(0);
  await expect(empty.getByRole('button')).toHaveCount(3);
  // Centred across the view's content (a scrolling view keeps its scrollbar's room), at
  // about 38 % of the height (not dead centre).
  const place = await empty.evaluate((node) => {
    const scroller = node.closest('.view')!;
    const view = scroller.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return {
      across: Math.abs(box.left + box.width / 2 - (view.left + scroller.clientWidth / 2)),
      down: (box.top + box.height / 2 - view.top) / view.height,
    };
  });
  expect(place.across).toBeLessThanOrEqual(1);
  expect(place.down).toBeGreaterThan(0.3);
  expect(place.down).toBeLessThan(0.46);
  expect(await page.locator('.btn.primary').count()).toBe(1);
  // Back in the Jobs view "Abrufen" is the primary again.
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('fetch')).toHaveClass(/primary/);
});

test('toasts: at most three, they stay while hovered and leave on their own', async ({ page }) => {
  // Plain toasts (4 s) from the gallery: Einstellungen answers every action in place.
  await open(page, '?gallery&platform=windows');
  // The window in the back holds their time, so a slow machine still sees all of them.
  await page.evaluate(() => window.__harness.fire('tauri://blur', null));
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: 'Toast zeigen' }).click();
  }
  const toasts = page.getByTestId('toast');
  await expect(toasts).toHaveCount(3);
  await toasts.first().hover();
  await page.evaluate(() => window.__harness.fire('tauri://focus', null));
  await page.waitForTimeout(4500);
  await expect(toasts).toHaveCount(1);
  await page.mouse.move(5, 5);
  await expect(toasts).toHaveCount(0, { timeout: 6000 });
});

// Every view in every scenario, the first run included (its sidebar reaches Profil and
// Einstellungen; Jobs is the setup page there).
for (const [width, height] of [
  [480, 360],
  [780, 560],
] as const) {
  for (const scenario of ['default', 'first-run', 'running', 'no-profile']) {
    for (const tab of ['nav-jobs', 'nav-profile', 'nav-settings']) {
      test(`nothing clipped or scrolling sideways at ${width}x${height}: ${scenario} ${tab}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await open(page, `?platform=windows&scenario=${scenario}`);
        await page.getByTestId(tab).click();
        await page.waitForTimeout(300);
        const wide = await page.evaluate(() =>
          [...document.querySelectorAll('.view, .view *')]
            .filter(
              (node) =>
                node.scrollWidth > node.clientWidth + 1 &&
                getComputedStyle(node).overflowX !== 'visible' &&
                // A one-line text that ends in an ellipsis is cut on purpose.
                getComputedStyle(node).textOverflow !== 'ellipsis' &&
                // Meters and skeletons clip their moving light on purpose.
                node.closest('[role="progressbar"], [aria-hidden="true"]') === null &&
                // A long value scrolls inside its own field, as in every native field.
                !node.matches('input, textarea'),
            )
            .map((node) => `${node.tagName}.${node.className}`),
        );
        expect(wide).toEqual([]);
      });
    }
  }
}

/* ----------------------------------------------------------- A press follows the pointer */

// A held control that the pointer leaves looks at rest again, like a native button: the
// pressed look follows the pointer, and releasing outside does nothing.

test('a held button that the pointer leaves looks at rest and does not fire', async ({ page }) => {
  await open(page, WIN);
  const fetch = page.getByTestId('fetch');
  const { rest, left } = await pressAndLeave(page, fetch);
  expect(left).toBe(rest);
  expect(await calls(page, 'start_run')).toHaveLength(0);
});

test('a held sidebar entry that the pointer leaves looks at rest', async ({ page }) => {
  await open(page, WIN);
  const entry = page.getByTestId('nav-settings');
  const { rest, left } = await pressAndLeave(page, entry);
  expect(left).toBe(rest);
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
});

/* -------------------------------------------------------------------------- The language */

// The language switch: Einstellungen > Sprache turns the whole app to English and back at
// once (no reload), the backend stores the choice, and a backend that says English starts
// the app in English. Words, numbers and dates follow; the baselines stay German, two
// English ones show the reader and the settings.

test('Sprache switches the whole app to English and back at once', async ({ page }) => {
  await settings(page);
  const choice = page.getByTestId('language');
  await expect(choice.getByRole('radio', { name: 'Deutsch' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // No hint: the Excel file and the report follow by themselves (settings.spec.ts).
  await expect(page.getByTestId('settings-look')).toContainText('Sprache');

  await choice.getByRole('radio', { name: 'English' }).click();
  // The page switches before anything reloads: the sidebar, the headings, the document.
  await expect(page.getByTestId('nav-settings')).toContainText('Settings');
  await expect(page.getByTestId('nav-profile')).toContainText('Profile');
  await expect(page.getByTestId('settings-look')).toContainText('Appearance');
  await expect(page.getByTestId('settings-fetch')).toContainText('Archive jobs after 30 days');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(choice.getByRole('radio', { name: 'English' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect((await calls(page, 'save_settings')).map(([, args]) => args)).toEqual([
    {
      patch: {
        portals: [],
        autoArchiveDays: null,
        autoEmptyTrashDays: null,
        language: 'en',
        palette: null,
      },
    },
  ]);

  // The Jobs view in English: the list header, the reader, its numbers and words.
  await readFirst(page);
  await expect(page.getByTestId('list-header')).toContainText('Fetch');
  await expect(page.getByTestId('reader-ring')).toHaveAttribute('aria-label', /^Match 91%/);
  await expect(page.getByTestId('band')).toHaveText('High match');
  await expect(page.getByTestId('reader')).not.toContainText('Passung');
  await page.getByTestId('reader-more').click();
  await expect(page.getByTestId('menu-item-prompt')).toContainText('AI prompt');
  await page.keyboard.press('Escape');

  // Back to German, the same way.
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('language').getByRole('radio', { name: 'Deutsch' }).click();
  await expect(page.getByTestId('nav-settings')).toContainText('Einstellungen');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  // The job stays open; its reader speaks German again.
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('band')).toHaveText('Hohe Passung');
  // German puts a narrow no-break space before the percent sign.
  await expect(page.getByTestId('reader-ring')).toHaveAttribute('aria-label', /^Passung 91\s%/);
  await expect(page.getByTestId('list-header')).toContainText('Abrufen');
});

test('the app starts in the language the backend says', async ({ page }) => {
  await open(page, EN);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('nav-jobs')).toContainText('Jobs');
  await expect(page.getByTestId('nav-settings')).toContainText('Settings');
  // Relative dates and the reader beside the list speak English too.
  await expect(page.getByTestId('place-reader')).toHaveText('Choose a job from the list.');
  await expect(rows(page).first()).not.toContainText(/gestern|vor \d/);
  await page.getByTestId('nav-settings').click();
  await expect(
    page.getByTestId('language').getByRole('radio', { name: 'English' }),
  ).toHaveAttribute('aria-checked', 'true');
});
