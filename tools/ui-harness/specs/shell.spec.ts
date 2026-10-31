// The shell of the app, in one place: the window's top bar and its buttons, the sidebar
// and its views (one table, lib/views.ts), the switch between views, the window sizes it
// survives, the press that follows the pointer, reduced motion, the tooltips, the toasts and
// dialogs, the run status and a start whose data cannot load. The keys themselves are
// input.spec.ts; the components are checked on the real screens. Texts come from the catalog
// where a test names a label (T, text()).

import type { Locator, Page } from '@playwright/test';
import {
  calls,
  expect,
  expectShot,
  motionSettled,
  open,
  runFinished,
  settle,
  nav,
  test,
  text,
  visibleCount,
} from './fixtures';
import {
  chip,
  failNext,
  list,
  openJob,
  openPlace,
  SEARCHED,
  reveal,
  settleMoves,
  stage,
  T,
  viaMenu,
} from './helpers';

// Every point of the top bar and its hairline either moves the window (Tauri's drag script: a
// direct hit on an element with data-tauri-drag-region; a double click there maximizes; on
// Windows the caption window of platform.rs answers for it first) or is a window button.
const DRAG_PROBE = (): string[] => {
  const CONTROL =
    'a, button, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="tab"], [role="switch"], [role="radio"], [role="checkbox"], [role="option"], [role="menuitem"]';
  const dead: string[] = [];
  const width = document.documentElement.clientWidth;
  const bar = document.querySelector('[data-testid="title-bar"]')!.getBoundingClientRect();
  const rows = [1, bar.height / 4, bar.height / 2, (bar.height * 3) / 4, bar.height - 2];
  for (const y of [...rows.map(Math.round), bar.height - 1]) {
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

const tooltip = (page: Page) => page.getByRole('tooltip');

/** Every entry of the sidebar in its order: the views, the places of the jobs under Jobs. */
const SIDEBAR_ENTRIES = [
  'nav-jobs',
  'place-inbox',
  'place-archive',
  'place-trash',
  'nav-profile',
  'nav-settings',
];

/** A key that moves, like a keyboard user's (after a click the next focus() would be a
 *  pointer's, which shows no tooltip). */
async function byKeys(page: Page): Promise<void> {
  await page.keyboard.press('Tab');
}

const row = (page: Page, key: string): Locator =>
  page.getByTestId('job-list').getByTestId(`job-row-${key}`);

async function settings(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await settle(page);
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

/** Presses the target, leaves it with the button held (to `away`, by default beside it; a
 *  point off the page is outside the window) and releases there: the look relaxes to the one
 *  at rest while still held and stays so after the release. */
async function pressAndLeave(
  page: Page,
  target: Locator,
  away?: { x: number; y: number },
): Promise<void> {
  const box = (await target.boundingBox())!;
  const off = away ?? { x: box.x + box.width + 200, y: box.y + box.height + 200 };
  // At rest, with the pointer away.
  await page.mouse.move(box.x + box.width + 200, box.y + box.height + 200);
  await page.waitForTimeout(250);
  const rest = await look(target);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(off.x, off.y, { steps: 4 });
  // Its hover and press relax (150 ms) back to the look at rest while the button is still
  // held; polled, so a busy machine that draws the frames late waits for them.
  await expect.poll(() => look(target)).toBe(rest);
  await page.mouse.up();
  await expect.poll(() => look(target)).toBe(rest);
}

/** A point outside the window: above its top left corner. */
const OUTSIDE = { x: -40, y: -40 };

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
  for (const item of SIDEBAR_ENTRIES) {
    await expect(page.getByTestId(item)).toBeVisible();
  }
  // The place that is shown is the current entry; Jobs above it says the view it lies in.
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('nav-jobs')).toHaveText(T.nav.jobs);
  await expect(page.getByTestId('view-jobs')).toBeVisible();
});

test('every view switch shows the new view alone, in the frame the click ends in', async ({
  page,
}) => {
  await open(page, '?platform=windows');
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  for (const to of ['profile', 'settings', 'jobs', 'settings', 'profile', 'jobs']) {
    await page.getByTestId(`nav-${to}`).click();
    // One view only, at once.
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main.views > section')].map(
        (node) => node.dataset.testid,
      ),
    );
    expect(shown).toEqual([`view-${to}`]);
  }
});

test('no view has more than one primary button', async ({ page }) => {
  // The project allows at most one primary button per view (the Jobs view's fetch); which one
  // it is, is not pinned here. A change of the Profil brings none: it saves by itself.
  await open(page, '?platform=windows');
  for (const view of ['jobs', 'profile', 'settings'] as const) {
    await page.getByTestId(`nav-${view}`).click();
    await expect(page.getByTestId(`view-${view}`)).toBeVisible();
    expect(await visibleCount(page, '.btn.primary'), view).toBeLessThanOrEqual(1);
  }
  await page.getByTestId('nav-profile').click();
  await page.getByTestId('profile-wish-rate').fill('1.300');
  await expect(page.getByTestId('profile-save')).toHaveCount(0);
  expect(await visibleCount(page, '.btn.primary'), 'profile with a change').toBeLessThanOrEqual(1);
  // A search that finds nothing keeps the head's fetch; a list that fails to load has its retry.
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId('search').fill('zzqxv');
  await expect(page.getByTestId('empty-search')).toBeVisible();
  expect(await visibleCount(page, '.btn.primary'), 'search without hits').toBeLessThanOrEqual(1);
  await open(page, '?platform=windows&scenario=list-error');
  await expect(page.getByTestId('list-error')).toBeVisible();
  expect(await visibleCount(page, '.btn.primary'), 'list that failed').toBeLessThanOrEqual(1);
  await open(page, '?platform=windows&scenario=no-profile');
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('new-profile-ways')).toBeVisible();
  expect(await visibleCount(page, '.btn.primary'), 'profile start').toBeLessThanOrEqual(1);
  for (const step of ['welcome', 'way', 'upload', 'reading', 'profile', 'alerts', 'done']) {
    await open(page, `?platform=windows&scenario=first-run&step=${step}`);
    expect(await visibleCount(page, '.btn.primary'), `setup ${step}`).toBeLessThanOrEqual(1);
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

// The window's top bar is the same on both OS, like the Claude app's: across the whole window,
// the sidebar's button, Zurück and Vor at the left and the job view's button at the right
// (Windows: the app's caption buttons at the right end; macOS: the room of the native traffic
// lights at the left). Its look is not pinned here.
const osOf = (query: string): 'windows' | 'macos' =>
  query.includes('macos') ? 'macos' : 'windows';

for (const os of ['windows', 'macos'] as const) {
  test(`${os}: the top bar spans the window; nothing but the bar moves the window`, async ({
    page,
  }) => {
    await open(page, `?platform=${os}`);
    await expect(page.locator('html')).toHaveAttribute('data-platform', os);
    const bar = page.getByTestId('title-bar');
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    const box = (await bar.boundingBox())!;
    expect([box.x, box.y, box.width]).toEqual([0, 0, width]);
    // The content stands below the bar, not under it.
    expect((await page.getByTestId('sidebar').boundingBox())!.y).toBeGreaterThanOrEqual(
      box.y + box.height,
    );
    // No icon and no name; the buttons start after the lights on macOS: Zurück, Vor, then the
    // sidebar's button.
    await expect(page.getByTestId('title-bar-app')).toHaveCount(0);
    const [first, second, third] = await Promise.all(
      ['history-back', 'history-forward', 'toggle-sidebar'].map(
        async (id) => (await page.getByTestId(id).boundingBox())!,
      ),
    );
    if (os === 'macos') {
      const lights = (await page.getByTestId('traffic-lights').boundingBox())!;
      expect(first!.x).toBeGreaterThanOrEqual(lights.x + lights.width);
    }
    expect(second!.x).toBeGreaterThan(first!.x);
    expect(third!.x).toBeGreaterThan(second!.x);
    // Nothing but the bar moves the window.
    const drags = page.locator('[data-tauri-drag-region]');
    for (const node of await drags.all()) {
      expect(await node.evaluate((el) => el.closest('[data-testid="title-bar"]') !== null)).toBe(
        true,
      );
    }
  });
}

// Windows: Minimieren, Maximieren and Schließen at the right, named in tooltips in the words of
// Windows, not in the tab order. A click goes through `window_button`; Maximieren then names
// itself Verkleinern.
test('windows: the caption buttons of the top bar', async ({ page }) => {
  await open(page, WIN);
  const buttons = page.getByTestId('window-buttons').getByRole('button');
  await expect(buttons).toHaveCount(3);
  for (const node of await buttons.all()) await expect(node).toHaveAttribute('tabindex', '-1');
  const names: [string, string][] = [
    ['window-minimize', 'window.minimize'],
    ['window-maximize', 'window.maximize'],
    ['window-close', 'window.close'],
  ];
  for (const [id, key] of names) {
    const button = page.getByTestId(id);
    await expect(button).toHaveAccessibleName(await text(page, key));
    await button.hover();
    await expect(tooltip(page)).toHaveText(await text(page, key));
    await expect(button).not.toHaveAttribute('title');
  }
  const minimize = page.getByTestId('window-minimize');
  // Maximieren maximizes and names itself Verkleinern; again, it restores.
  const maximize = page.getByTestId('window-maximize');
  await maximize.click();
  await expect(maximize).toHaveAccessibleName(await text(page, 'window.restore'));
  await maximize.click();
  await expect(maximize).toHaveAccessibleName(await text(page, 'window.maximize'));
  await minimize.click();
  const pressed = (await calls(page, 'window_button')).map(
    ([, args]) => (args as { button: string }).button,
  );
  expect(pressed).toEqual(['maximize', 'maximize', 'minimize']);
  await expect.poll(() => page.evaluate(() => window.__harness.minimized)).toBe(true);
  // A press on a button takes no focus (like a native caption button).
  expect(
    await page.evaluate(() => document.activeElement?.closest('[data-testid="title-bar"]')),
  ).toBeNull();
});

// In the app a window of the OS lies over the bar (platform.rs) and reports the pointer; the
// buttons answer it as if the pointer were over them, the tooltip included, and the maximized
// state comes from the window.
test('windows: the caption buttons show what the window over the bar reports', async ({ page }) => {
  await open(page, WIN);
  const close = page.getByTestId('window-close');
  await page.evaluate(() => window.__harness.fire('caption', { hover: 'close', pressed: null }));
  await expect(tooltip(page)).toHaveText(await text(page, 'window.close'));
  // Windows 11's own red under the pointer.
  await expect(close).toHaveCSS('background-color', 'rgb(196, 43, 28)');
  await page.evaluate(() => window.__harness.fire('caption', { hover: 'close', pressed: 'close' }));
  await expect(tooltip(page)).toHaveCount(0);
  await page.evaluate(() => window.__harness.fire('caption', { hover: null, pressed: null }));
  await expect(tooltip(page)).toHaveCount(0);
  await page.evaluate(() => window.__harness.fire('window-state', { maximized: true }));
  await expect(page.getByTestId('window-maximize')).toHaveAccessibleName(
    await text(page, 'window.restore'),
  );
  // Schließen asks like the close button of the OS: unsaved changes first.
  await page.evaluate(() => (window.__harness.unsaved = true));
  await close.click();
  expect(await page.evaluate(() => window.__harness.closed)).toBe(false);
});

// macOS: the native traffic lights sit at the left of the same bar; the page draws no window
// buttons and keeps their room free.
test('macos: no window buttons in the page, the room of the traffic lights', async ({
  page,
  browserName,
}) => {
  await open(page, MAC);
  await expect(page.getByTestId('window-buttons')).toHaveCount(0);
  await expect(page.getByTestId('title-bar').locator('[data-testid^="window-"]')).toHaveCount(0);
  const lights = page.getByTestId('traffic-lights');
  const room = (await lights.boundingBox())!;
  expect([room.x, room.y]).toEqual([0, 0]);
  await expect(lights).toHaveAttribute('data-tauri-drag-region', '');
  // A picture with the traffic lights drawn in where macOS puts them (for humans; WebKit
  // reports Playwright's screenshot styles as a CSP violation).
  if (process.env.SHOTS_DIR && browserName === 'chromium') {
    await page.evaluate(() => {
      const colours = ['#ff5f57', '#febc2e', '#28c840'];
      colours.forEach((colour, i) => {
        const dot = document.body.appendChild(document.createElement('div'));
        Object.assign(dot.style, {
          position: 'fixed',
          left: `${16 + i * 20}px`,
          top: '15px',
          width: '14px',
          height: '14px',
          borderRadius: '7px',
          background: colour,
          zIndex: '1000',
        });
      });
    });
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/macos-top-bar-marked.png` });
  }
});

for (const os of [WIN, MAC]) {
  test(`the whole top bar moves the window, in every view and width ${os}`, async ({ page }) => {
    const states: [string, { width: number; height: number }, (p: typeof page) => Promise<void>][] =
      [
        ['jobs', { width: 1360, height: 900 }, async () => undefined],
        [
          'reader',
          { width: 1360, height: 900 },
          (p) => p.locator('[data-testid^="job-row-"]').first().click(),
        ],
        ['rail', { width: 1000, height: 700 }, async () => undefined],
        ['profile', { width: 1360, height: 900 }, (p) => p.getByTestId('nav-profile').click()],
        ['settings', { width: 1360, height: 900 }, (p) => p.getByTestId('nav-settings').click()],
        ['minimum', { width: 480, height: 360 }, async () => undefined],
      ];
    for (const [name, size, go] of states) {
      await page.setViewportSize(size);
      await open(page, os);
      await go(page);
      await settle(page);
      await motionSettled(page);
      expect(await page.evaluate(DRAG_PROBE), name).toEqual([]);
    }
    await page.setViewportSize({ width: 1360, height: 900 });
    await open(page, `${os}&scenario=first-run`);
    expect(await page.evaluate(DRAG_PROBE), 'first run').toEqual([]);
  });
}

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
    await (await reveal(page, page.getByTestId('mailbox-remove'))).click();
    const dialog = page.getByTestId('dialog-remove-mailbox');
    await expect(dialog).toBeVisible();
    return dialog.getByRole('button').allInnerTexts();
  };
  // Windows: the action first; macOS: cancel, then the action on the right.
  expect(await order('windows')).toEqual([T.common.remove, T.common.cancel]);
  expect(await order('macos')).toEqual([T.common.cancel, T.common.remove]);
});

test('icon-only buttons show a styled tooltip after the delay', async ({ page }) => {
  await open(page, '?platform=windows');
  const toggle = page.getByTestId('toggle-sidebar');
  await toggle.hover();
  // The name of the button, drawn by the app (no native title).
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText(await text(page, 'nav.sidebarHide'));
  await expect(toggle).not.toHaveAttribute('title');
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

// The sidebar: three views (Jobs, Profil, Einstellungen) and under Jobs the places of the jobs
// (Aktuell, Archiv, Papierkorb), the app starts in Jobs, no counts, no status line, no tooltips
// on its entries, how it folds, and the order of a click when a value that holds the Profil's
// save asks first.

test('the sidebar shows no counts and no dots: the list says how many jobs are new', async ({
  page,
}) => {
  for (const width of [1360, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, WIN);
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByTestId('nav-jobs')).toBeVisible();
    await expect(sidebar.locator('nav .count, nav .dot')).toHaveCount(0);
    await expect(sidebar.locator('nav')).not.toContainText(/\d/);
  }
});

test('the app starts in Jobs; three views and the places, their names without tooltips, no status line', async ({
  page,
}) => {
  await open(page, `${WIN}&view=start`);
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'true');
  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar.locator('nav button')).toHaveText([
    T.nav.jobs,
    T.place.inbox,
    T.place.archive,
    T.place.trash,
    T.nav.profile,
    T.nav.settings,
  ]);
  await expect(page.getByTestId('view-overview')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(sidebar.locator('button:not(nav button)')).toHaveCount(0);
  await expect(page.getByTestId('run-status')).toHaveCount(0);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  // The name is on the entry: no tooltip repeats it, on hover or on focus.
  await page.getByTestId('nav-jobs').hover();
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByTestId('place-archive').hover();
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByTestId('nav-settings').focus();
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

for (const os of [WIN, MAC]) {
  test(`below 1100 px the sidebar folds away; its button floats it out, nothing on hover ${os}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await open(page, os);
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
    const floating = page.getByTestId('sidebar-floating');
    // The pointer on the window's left edge does nothing (user, 2026-09-29).
    await page.mouse.move(1, 400);
    await page.waitForTimeout(300);
    await expect(floating).toHaveCount(0);
    // Its button floats it out (and then offers to hide it); a choice there folds it again.
    const toggle = page.getByTestId('toggle-sidebar');
    await expect(toggle).toHaveAccessibleName(T.nav.sidebarShow);
    await toggle.click();
    await expect(floating).toBeVisible();
    await expect(toggle).toHaveAccessibleName(T.nav.sidebarHide);
    await floating.getByTestId('nav-profile').click();
    await expect(page.getByTestId('view-profile')).toBeVisible();
    await expect(floating).toHaveCount(0);
    // Esc folds it, and so does a press beside it, which still does what it presses.
    await toggle.click();
    await expect(floating).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(floating).toHaveCount(0);
    await toggle.click();
    await expect(floating).toBeVisible();
    const field = page.getByTestId('profile-wish-rate');
    const box = (await field.boundingBox())!;
    await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
    await expect(floating).toHaveCount(0);
    await expect(field).toBeFocused();
    // Its button folds it too (the press beside it is the button's own).
    await toggle.click();
    await expect(floating).toBeVisible();
    await toggle.click();
    await expect(floating).toHaveCount(0);
    // A place is a choice like a view: it opens and the sidebar folds.
    await toggle.click();
    await floating.getByTestId('place-archive').click();
    await expect(floating).toHaveCount(0);
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
  });

  test(`at 480 x 360 the floating sidebar keeps every entry in the window ${os}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 360 });
    await open(page, os);
    await page.getByTestId('toggle-sidebar').click();
    const ids = SIDEBAR_ENTRIES;
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
  });
}

test('its button folds and docks the sidebar; the bar follows; Ctrl+B and Cmd+B change nothing', async ({
  page,
}) => {
  await open(page, WIN);
  const sidebar = page.getByTestId('sidebar');
  await expect(page.getByTestId('sidebar-edge')).toHaveCount(0);
  await expect(sidebar).toBeVisible();
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Meta+b');
  await expect(sidebar).toBeVisible();
  const toggle = page.getByTestId('toggle-sidebar');
  await toggle.click();
  await page.mouse.move(700, 400);
  await expect(sidebar).toHaveCount(0);
  await toggle.click();
  await expect(sidebar).toBeVisible();
  // A narrow window folds it by itself; a wide one brings it back.
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(sidebar).toHaveCount(0);
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect(sidebar).toBeVisible();
});

test('a change of the Profil goes along on the way to the place that was chosen', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  await page.getByTestId('profile-wish-rate').fill('1.300');
  await page.getByTestId('place-archive').click();
  // Nothing asks: the change is saved and the way goes on.
  await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
  await expect(page.getByTestId('dialog-leave-profile')).toHaveCount(0);
  expect((await page.evaluate(() => window.__harness.form()))?.dayRateWish).toBe(1300);
});

test('a value that holds the save keeps the view until the question is answered', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const field = page.getByTestId('profile-wish-rate');
  const stored = await field.inputValue();
  await field.fill('0');
  await page.getByTestId('place-archive').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText(T.profile.leaveHeading);
  await expect(dialog.locator('.text')).toHaveText(
    T.profile.leaveWrong(T.profile.field.dayRateWish),
  );
  await dialog.getByTestId('dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
  // Still the Profil with the value, said at its field; no caret goes back to it.
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await expect(page.getByTestId('nav-profile')).toHaveAttribute('aria-current', 'page');
  await expect(field).toHaveValue('0');
  await expect(field).not.toBeFocused();
  await expect(page.getByText(T.profile.field.atLeast(1))).toBeVisible();
  // Asked again and left without saving: the Jobs view it was asked for last, on Aktuell (not on
  // the Archiv of the question that was cancelled).
  await page.getByTestId('nav-jobs').click();
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.inbox);
  // The value went, and nothing was saved.
  await page.getByTestId('nav-profile').click();
  await expect(field).toHaveValue(stored);
  expect(await calls(page, 'save_profile')).toHaveLength(0);
  // The place that was chosen waits for the answer too.
  await field.fill('0');
  await page.getByTestId('place-archive').click();
  await dialog.getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
});

test('what the question kept waiting goes with its Abbrechen', async ({ page }) => {
  // Zurück from the Profil to Einstellungen waits for the question, which is cancelled.
  await open(page, `${WIN}&view=settings`);
  await page.getByTestId('nav-profile').click();
  const field = page.getByTestId('profile-wish-rate');
  await field.fill('0');
  await page.getByTestId('history-back').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await dialog.getByTestId('dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
  // The value is mended and saved. Einstellungen chosen later is a step of its own, not that
  // step back: Zurück leads to the Profil, and nothing lies ahead.
  await field.fill('1.300');
  await field.blur();
  await expect.poll(async () => (await calls(page, 'save_profile')).length).toBe(1);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await expect(page.getByTestId('history-forward')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('history-back').click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
});

test('a click on the place that is open reloads nothing, like Jobs on Aktuell', async ({
  page,
}) => {
  await open(page, WIN);
  const loads = async (place?: string): Promise<number> =>
    (await calls(page, 'list_jobs')).filter(
      ([, args]) =>
        place === undefined || (args as { query: { place: string } }).query.place === place,
    ).length;
  await page.getByTestId('place-archive').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
  await settle(page);
  const archive = await loads('archive');
  await page.getByTestId('place-archive').click();
  await settle(page);
  expect(await loads('archive')).toBe(archive);
  await page.getByTestId('place-inbox').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.inbox);
  await settle(page);
  const all = await loads();
  await page.getByTestId('nav-jobs').click();
  await settle(page);
  expect(await loads()).toBe(all);
  // From another place Jobs leads to Aktuell.
  await page.getByTestId('place-trash').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.trash);
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.inbox);
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
});

/* ------------------------------------------- Tooltips, focus, scroll places, toasts */

// Tooltips on keyboard focus, the focus back on the trigger, the scroll place of Profil and
// Einstellungen, a toast over the Profil, a dialog over the top bar and a start whose data cannot
// load.

test('a tooltip shows on keyboard focus after the delay and goes on blur, resize and window blur', async ({
  page,
}) => {
  // While a run holds the mailbox, its buttons wait and say why.
  await open(page, `${WIN}&view=settings&scenario=running`);
  const words = T.error.text('busy', { activity: 'fetch' });
  await byKeys(page);
  const first = page.getByTestId('mailbox-change');
  await first.focus();
  // Not at once: after the same delay as hovering (checked right away, not after a fixed
  // wait, which a busy machine can stretch past the delay).
  await expect(tooltip(page)).toHaveCount(0);
  await expect(tooltip(page)).toHaveText(words);
  // Blur: the focus moves back to the switch of the row before, which has none.
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('toggle-enabled-freelance')).toBeFocused();
  await expect(tooltip(page)).toHaveCount(0);
  await first.focus();
  await expect(tooltip(page)).toHaveText(words);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect(tooltip(page)).toHaveCount(0);
  await page.getByTestId('mailbox-remove').focus();
  await expect(tooltip(page)).toHaveText(words);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(tooltip(page)).toHaveCount(0);
});

test('a disabled button that says why stays a Tab stop; its reason shows on focus', async ({
  page,
}) => {
  // While a run holds the mailbox, Ändern waits and says why.
  await open(page, `${WIN}&view=settings&scenario=running`);
  await byKeys(page);
  await page.getByTestId('mailbox-change').focus();
  await expect(page.getByTestId('mailbox-change')).toBeFocused();
  await expect(page.getByTestId('mailbox-change')).toHaveAttribute('aria-disabled', 'true');
  await expect(tooltip(page)).toHaveText(T.error.text('busy', { activity: 'fetch' }));
});

test('the focus goes back to the trigger after a menu and a toast', async ({ page }) => {
  await open(page, WIN);
  // A menu opened from the keyboard (the funnel's), closed with Esc.
  const funnel = page.getByTestId('filter');
  await funnel.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu')).toHaveCount(0);
  await expect(funnel).toBeFocused();
  const search = page.getByTestId('search');
  // A toast's undo reached from the search field gives the focus back to it.
  await viaMenu(page, 'archive', 'freelancermap-2801');
  const action = page.getByTestId('toast-action');
  await expect(action).toBeVisible();
  await search.focus();
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(search).toBeFocused();
});

test('a press on a toast takes no focus', async ({ page }) => {
  await open(page, WIN);
  await viaMenu(page, 'archive', 'freelancermap-2801');
  const action = page.getByTestId('toast-action');
  await expect(action).toBeVisible();
  await action.click();
  const inStack = await page.evaluate(
    () =>
      document.querySelector('[data-testid="toasts"]')?.contains(document.activeElement) ?? false,
  );
  expect(inStack).toBe(false);
});

test('Profil and Einstellungen keep their scroll place per view', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 400 });
  await open(page, `${WIN}&view=settings`);
  const view = (id: string) => page.getByTestId(`view-${id}`);
  // The page scrolls that far at this height.
  await expect(page.getByTestId('portal-hays')).toBeVisible();
  await view('settings').evaluate((node) => (node.scrollTop = 200));
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await view('profile').evaluate((node) => (node.scrollTop = 260));
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId('nav-settings').click();
  await expect.poll(() => view('settings').evaluate((node) => node.scrollTop)).toBe(200);
  await page.getByTestId('nav-profile').click();
  await expect.poll(() => view('profile').evaluate((node) => node.scrollTop)).toBe(260);
});

test('a toast of a finished fetch over Profil: its Zeigen saves a change and opens the fetch', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 700 });
  await open(page, `${WIN}&view=profile&tick=5`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  // A value on its way (the caret stands in its field: not saved yet).
  await page.getByTestId('profile-wish-rate').fill('1.300');
  await page.evaluate(() => window.__harness.appRun('fetch'));
  await runFinished(page);
  const show = page.getByTestId('toast').getByTestId('toast-action');
  await expect(show).toHaveText(T.toast.show);
  // Zeigen is no undo: a click opens the run in Jobs, the change goes along.
  await show.click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(chip(page, 'run')).toBeVisible();
  await expect(page.getByTestId('dialog-leave-profile')).toHaveCount(0);
  expect((await page.evaluate(() => window.__harness.form()))?.dayRateWish).toBe(1300);
});

test('a toast of a finished fetch over Profil: its Zeigen waits for the question about a wrong value', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 700 });
  await open(page, `${WIN}&view=profile&tick=5`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await page.getByTestId('profile-wish-rate').fill('0');
  await page.evaluate(() => window.__harness.appRun('fetch'));
  await runFinished(page);
  await page.getByTestId('toast').getByTestId('toast-action').click();
  // The value holds the save: Zeigen opens the run once the value is dropped.
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await dialog.getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(chip(page, 'run')).toBeVisible();
  expect(await calls(page, 'save_profile')).toHaveLength(0);
});

// A dialog dims the whole window, the top bar too (owner, 2026-10-28: the bar is part of the app).
for (const os of [WIN, MAC]) {
  test(`a dialog dims the top bar too ${os}`, async ({ page }) => {
    await open(page, `${os}&view=settings`);
    await (await reveal(page, page.getByTestId('reset'))).click();
    await expect(page.getByTestId('dialog-reset')).toBeVisible();
    await settle(page);
    const size = await page.evaluate(() => [innerWidth, innerHeight]);
    const scrim = (await page.getByTestId('dialog-scrim').boundingBox())!;
    expect([scrim.x, scrim.y, scrim.width, scrim.height]).toEqual([0, 0, ...size]);
  });
}

// The window still moves by the bar while a dialog is open: on Windows the caption window of
// platform.rs lies over the bar and answers for it; on macOS only the page can answer, by a
// direct hit on a drag region (Tauri's drag script).
test('macos: while a dialog is open the bar still moves the window', async ({ page }) => {
  await open(page, `${MAC}&view=settings`);
  await (await reveal(page, page.getByTestId('reset'))).click();
  await expect(page.getByTestId('dialog-reset')).toBeVisible();
  await settle(page);
  const hit = await page.evaluate(() =>
    document.elementFromPoint(600, 18)?.hasAttribute('data-tauri-drag-region'),
  );
  expect(hit).toBe(true);
});

test('a start whose data cannot load: try again, a backup, the data folder', async ({ page }) => {
  await open(page, `${WIN}&scenario=load-failed`);
  const failed = page.getByTestId('view-error');
  await expect(failed.getByRole('heading')).toHaveText(T.shell.loadFailed);
  // No way to the log (it is written quietly).
  await expect(page.getByTestId('open-log')).toHaveCount(0);
  await page.getByTestId('open-data').click();
  const targets = (await calls(page, 'open_target')).map(
    ([, args]) => (args as { target: { kind: string } }).target.kind,
  );
  expect(targets).toEqual(['dataDir']);
  await failed.getByRole('button', { name: await text(page, 'common.retry') }).click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
});
test('a start whose data cannot load offers the backups; a restore loads the app', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=load-failed`);
  await expect(page.getByTestId('restore-backup')).toHaveText(
    await text(page, 'shell.backupHeading'),
  );
  // A failure to list them stays a note under the ways.
  await failNext(page, 'list_backups');
  await page.getByTestId('restore-backup').click();
  await expect(page.getByTestId('backup-note')).toHaveText(T.error.text('db', {}));
  await page.getByTestId('restore-backup').click();
  const dialog = page.getByTestId('dialog-backup');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('backup-note')).toHaveCount(0);
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  expect(await calls(page, 'restore_backup')).toHaveLength(1);
});

test('the failed start keeps the top bar', async ({ page }) => {
  for (const os of [WIN, MAC]) {
    await open(page, `${os}&scenario=load-failed`);
    await expect(page.getByTestId('view-error')).toBeVisible();
    await expect(page.getByTestId('title-bar')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-platform', osOf(os));
    // No job view there: its button is not there either.
    await expect(page.getByTestId('toggle-reader')).toHaveCount(0);
  }
});

test('the job view button stands only where it does something', async ({ page }) => {
  const toggle = page.getByTestId('toggle-reader');
  await open(page, `${WIN}&scenario=load-failed`);
  await expect(page.getByTestId('view-error')).toBeVisible();
  await expect(toggle).toHaveCount(0);
  await open(page, WIN);
  for (const view of ['profile', 'settings']) {
    await page.getByTestId(`nav-${view}`).click();
    await expect(page.getByTestId(`view-${view}`)).toBeVisible();
    await expect(toggle).toHaveCount(0);
  }
  // In Jobs it names what it does.
  await page.getByTestId('nav-jobs').click();
  await expect(toggle).toBeEnabled();
  await toggle.hover();
  await expect(tooltip(page)).toHaveText(await text(page, 'nav.readerHide'));
  // A search without hits keeps the job view beside the list, and so its button.
  await page.getByTestId('search').fill('zzqxv');
  await expect(page.locator('[data-testid^="job-row-"]')).toHaveCount(0);
  await expect(page.getByTestId('reader-pane')).toBeVisible();
  await expect(toggle).toBeVisible();
  await page.getByTestId('search').fill('');
  await expect(toggle).toBeVisible();
  // A place without jobs has no job view beside it, and no button for it.
  await open(page, `${WIN}&scenario=concept`);
  await openPlace(page, 'trash');
  await expect(page.getByTestId('reader-pane')).toHaveCount(0);
  await expect(toggle).toHaveCount(0);
  await openPlace(page, 'inbox');
  await expect(toggle).toBeVisible();
  // One column: only while a job stands in place of the list.
  await page.setViewportSize({ width: 683, height: 700 });
  await expect(toggle).toHaveCount(0);
  await page.locator('[data-testid^="job-row-"]').first().click();
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveCount(0);
  await expect(page.locator('[data-testid^="job-row-"]').first()).toBeVisible();
});

// The bar continues the columns below it: at every point it wears the ground under it (the
// sidebar's, the view's), and the seams of the sidebar and of the list run up through it.
// Over the job view it wears the job view's page (--page).
const GROUND = (): string[] => {
  const wrong: string[] = [];
  const probe = document.body.appendChild(document.createElement('div'));
  probe.style.backgroundColor = 'var(--page)';
  const page = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const bar = document.querySelector('[data-testid="title-bar"]')!.getBoundingClientRect();
  const colour = (node: Element | null): string => {
    for (let at = node; at !== null; at = at.parentElement) {
      const paint = getComputedStyle(at).backgroundColor;
      if (paint !== 'rgba(0, 0, 0, 0)' && paint !== 'transparent') return paint;
    }
    return 'none';
  };
  const ground = document.querySelector('[data-testid="title-bar-ground"]')!;
  const parts = [ground, ...ground.querySelectorAll('*')];
  const above = (x: number): string => {
    let paint = getComputedStyle(
      document.querySelector('[data-testid="title-bar"]')!,
    ).backgroundColor;
    for (const part of parts) {
      const box = part.getBoundingClientRect();
      const style = getComputedStyle(part);
      const inner = box.left + parseFloat(style.borderLeftWidth);
      if (x >= inner && x < box.right) paint = style.backgroundColor;
      else if (x >= box.left && x < inner) paint = `seam ${style.borderLeftColor}`;
    }
    return paint;
  };
  const width = document.documentElement.clientWidth;
  for (let x = 2; x < width - 200; x += 7) {
    const below = document.elementFromPoint(x, bar.bottom + 3);
    // The handles' strips lie over a border.
    if (below?.closest('[role="separator"]')) continue;
    const view = below?.closest('[data-testid^="view-"]') ?? null;
    const under = below?.closest('[data-testid="reader-pane"]') ? page : colour(view ?? below);
    const over = above(x);
    if (over.startsWith('seam')) continue;
    if (over !== under) wrong.push(`${x}: bar ${over}, view ${under}`);
  }
  return wrong;
};

for (const [name, size, go] of [
  ['jobs', { width: 1360, height: 860 }, async () => undefined],
  ['jobs folded', { width: 1099, height: 860 }, async () => undefined],
  [
    'one column, a job',
    { width: 683, height: 700 },
    (p: Page) => p.locator('[data-testid^="job-row-"]').first().click(),
  ],
  ['profile', { width: 1360, height: 860 }, (p: Page) => p.getByTestId('nav-profile').click()],
  ['settings', { width: 1360, height: 860 }, (p: Page) => p.getByTestId('nav-settings').click()],
] as const) {
  test(`the top bar continues the columns below it: ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page, WIN);
    await go(page);
    await settle(page);
    await motionSettled(page);
    expect(await page.evaluate(GROUND)).toEqual([]);
  });
}

test('the top bar continues the setup below it', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  await settle(page);
  const [bar, view] = await Promise.all([
    page.getByTestId('title-bar-ground').evaluate((n) => getComputedStyle(n).backgroundColor),
    page.getByTestId('view-first-run').evaluate((n) => getComputedStyle(n).backgroundColor),
  ]);
  expect(bar).toBe(view);
});

// The sidebar's button docks and folds it without animating a width: the sidebar fades in,
// the view and the bar's part over it slide by a transform; a window that folds it by its
// width just shows the new frame.
test('the sidebar docks and folds by a slide, never by its width', async ({ page }) => {
  await open(page, WIN);
  await settle(page);
  const moves = (): Promise<string[]> =>
    page.evaluate(() =>
      document.getAnimations().flatMap((motion) => {
        const effect = motion.effect as KeyframeEffect | null;
        const target = effect?.target as HTMLElement | null;
        const keys = Object.keys(effect?.getKeyframes()[0] ?? {}).filter(
          (key) => !['offset', 'easing', 'composite', 'computedOffset'].includes(key),
        );
        return keys.map((key) => `${target?.dataset.testid ?? target?.tagName}:${key}`);
      }),
    );
  const toggle = page.getByTestId('toggle-sidebar');
  await toggle.click();
  const folded = await moves();
  expect(folded).toContain('title-bar-ground:transform');
  expect(folded).toContain('MAIN:transform');
  const LAYOUT = /:(width|minWidth|maxWidth|flexBasis|left|marginLeft)$/;
  expect(folded.filter((move) => LAYOUT.test(move))).toEqual([]);
  await motionSettled(page);
  await toggle.click();
  const docked = await moves();
  expect(docked).toContain('MAIN:transform');
  expect(docked).toContain('sidebar:opacity');
  expect(docked.filter((move) => LAYOUT.test(move))).toEqual([]);
  await motionSettled(page);
  // The window folds it by its width: no slide.
  await page.setViewportSize({ width: 1000, height: 860 });
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  expect(await moves()).not.toContain('MAIN:transform');
});

/* ------------------------------ Lists, panes, the run status, closing, shared components */

// The keys of the sidebar and the panes, the closing note and the behaviour of the shared
// components (dialogs, toasts, chips).

test('keyboard focus is never covered in Einstellungen and the job view', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  // The centre of the focused control is the control itself, not something over it.
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
  // Einstellungen from the last source it searches, upward.
  await settings(page, MAC);
  await page.getByTestId(`toggle-enabled-${SEARCHED.at(-1)!}`).focus();
  const cut: string[] = [];
  for (let stop = 0; stop < 16; stop += 1) {
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(80);
    const hidden = await covered();
    if (hidden !== null) cut.push(hidden);
  }
  // The job view: from its end upward.
  await page.getByTestId('nav-jobs').click();
  await row(page, 'freelancermap-2801').click();
  await expect(page.getByTestId('reader-prompt')).toBeVisible();
  await page.getByTestId('stage').evaluate((node) => (node.scrollTop = node.scrollHeight));
  await page.getByTestId('reader-prompt').focus();
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

test('a dialog confirms with the bare verb of its heading', async ({ page }) => {
  await settings(page);
  await (await reveal(page, page.getByTestId('mailbox-remove'))).click();
  await expect(page.getByTestId('dialog-remove-mailbox').getByTestId('dialog-confirm')).toHaveText(
    T.common.remove,
  );
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-jobs').click();
  await settle(page);
  await viaMenu(page, 'trash', 'freelancermap-2803');
  await page.getByTestId('place-trash').click();
  await viaMenu(page, 'purge', 'freelancermap-2803');
  await expect(page.getByTestId('dialog-purge').getByTestId('dialog-confirm')).toHaveText(
    T.reader.purgeConfirm,
  );
});

test('the closing note is one sentence, whatever the window waits for', async ({ page }) => {
  await open(page, WIN);
  await page.evaluate(() => {
    window.__harness.appRun('rescore');
    window.__harness.fire('closing', { activity: 'rescore' });
  });
  await expect(page.getByTestId('closing')).toHaveText(T.shell.closing);
  // An older backend sends nothing: the same sentence.
  await open(page, WIN);
  await page.evaluate(() => window.__harness.fire('closing', null));
  await expect(page.getByTestId('closing')).toHaveText(T.shell.closing);
});

/** The user closes the window (X, Alt+F4, Cmd+Q/W), as main.rs sees it. */
const requestClose = (page: Page): Promise<void> =>
  page.evaluate(() => window.__harness.requestClose());
const windowClosed = (page: Page): Promise<boolean> => page.evaluate(() => window.__harness.closed);
/** The page's answers to the question about the fetch. */
async function closeAnswers(page: Page): Promise<unknown[]> {
  return (await calls(page, 'answer_close')).map(([, args]) => args);
}

/** A fetch that stays running until the test lets it go (`holdAfter = null`). */
async function heldFetch(page: Page): Promise<void> {
  await page.evaluate(() => (window.__harness.holdAfter = 2));
  await page.getByTestId('fetch').click();
  await expect(page.getByTestId('run-line')).toBeVisible();
  // The backend has the run (the page shows its line a task before `start_run` answers).
  await expect.poll(() => page.evaluate(() => window.__harness.runs())).toBe(true);
}

test('closing during a fetch asks first: Weitersuchen keeps both, Schließen stops it and closes', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=40`);
  // Nothing runs: the window closes without a question.
  await requestClose(page);
  expect(await windowClosed(page)).toBe(true);
  await page.evaluate(() => (window.__harness.closed = false));

  await heldFetch(page);
  await requestClose(page);
  const dialog = page.getByTestId('dialog-close-running');
  // The question as its heading, no sentence; its second button keeps the search.
  await expect(dialog.getByRole('heading')).toHaveText(T.shell.closeHeading);
  await expect(dialog.locator('.text')).toHaveCount(0);
  await expect(dialog.getByTestId('dialog-confirm')).toHaveText(T.shell.closeAction);
  await expect(dialog.getByTestId('dialog-cancel')).toHaveText(T.shell.keep);
  // Weitersuchen: the window and the fetch stay.
  await dialog.getByTestId('dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
  expect(await windowClosed(page)).toBe(false);
  await expect(page.getByTestId('run-line')).toBeVisible();
  expect(await closeAnswers(page)).toEqual([{ close: false }]);
  // The next close asks again; Schließen stops the fetch, says so meanwhile and closes.
  await requestClose(page);
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('closing')).toHaveText(T.shell.closing);
  await expect.poll(() => windowClosed(page)).toBe(true);
  expect(await closeAnswers(page)).toEqual([{ close: false }, { close: true }]);
  expect(await calls(page, 'close_window')).toHaveLength(0);
});

test('the close question stands alone: another question that is open is cancelled first', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=40`);
  // Deleting for good asks (its dialog is open) when a search the app started is under way and
  // the window is asked to close.
  await viaMenu(page, 'trash', 'freelancermap-2803');
  await settleMoves(page);
  await openPlace(page, 'trash');
  await viaMenu(page, 'purge', 'freelancermap-2803');
  const purge = page.getByTestId('dialog-purge');
  await expect(purge).toBeVisible();
  await page.evaluate(() => {
    window.__harness.holdAfter = 2;
    window.__harness.appRun('fetch');
  });
  await expect.poll(() => page.evaluate(() => window.__harness.runs())).toBe(true);
  await requestClose(page);
  const dialog = page.getByTestId('dialog-close-running');
  await expect(dialog).toBeVisible();
  await expect(purge).toHaveCount(0);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
  await dialog.getByTestId('dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
});

test('the close question never traps the window and goes when the fetch ends', async ({ page }) => {
  await open(page, `${WIN}&tick=40`);
  await heldFetch(page);
  await requestClose(page);
  const dialog = page.getByTestId('dialog-close-running');
  await expect(dialog).toBeVisible();
  // The fetch ends meanwhile: nothing to ask any more, the next close goes through.
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
  await expect(dialog).toHaveCount(0);
  expect(await closeAnswers(page)).toEqual([{ close: false }]);
  expect(await windowClosed(page)).toBe(false);
  await requestClose(page);
  expect(await windowClosed(page)).toBe(true);

  // A second close while it asks (a page that cannot answer): the window closes anyway.
  await open(page, `${WIN}&tick=40`);
  await heldFetch(page);
  await requestClose(page);
  await expect(dialog).toBeVisible();
  await requestClose(page);
  await expect(page.getByTestId('closing')).toHaveText(T.shell.closing);
  await expect.poll(() => windowClosed(page)).toBe(true);
});

test('Tab passes disabled switches; a disabled button that says why stays a Tab stop', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=dry-run`);
  const landed: { id: string; role: string | null; tag: string }[] = [];
  // Through the page.
  {
    await page.getByTestId('nav-settings').focus();
    for (let stop = 0; stop < 60; stop += 1) {
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
  }
  // Only buttons with a reason (the dry run says why), never a switch.
  expect(landed.map((item) => item.id)).toContain('mailbox-change');
  expect(landed.map((item) => item.id)).toContain('reset');
  expect(landed.filter((item) => item.role === 'switch' || item.tag !== 'BUTTON')).toEqual([]);
  // The reason shows on keyboard focus, and still on hover.
  await page.getByTestId('reset').focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.getByTestId('reset').hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
});

test('the places are Tab stops of the sidebar; Enter chooses one', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-jobs').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('place-inbox')).toBeFocused();
  await page.keyboard.press('Tab');
  const archive = page.getByTestId('place-archive');
  await expect(archive).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(archive).toHaveAttribute('aria-current', 'page');
  await expect(archive).toBeFocused();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
});

test('with the focus nowhere the arrows, Home and End scroll Einstellungen', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 400 });
  await settings(page);
  const view = page.getByTestId('view-settings');
  const top = (): Promise<number> => view.evaluate((node) => node.scrollTop);
  // A click on a text that takes no focus (a source's name).
  await page.getByTestId('portal-hays').getByText(T.portal.hays).click();
  await page.keyboard.press('End');
  // Once the glide has ended (a key during it would add to where it is going).
  await expect
    .poll(() => view.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(0);
  const bottom = await top();
  await page.keyboard.press('ArrowUp');
  await expect.poll(top).toBeLessThan(bottom);
  await page.keyboard.press('Home');
  await expect.poll(top).toBe(0);
  await page.keyboard.press('ArrowDown');
  await expect.poll(top).toBeGreaterThan(0);
});

test('after a click into the reader the arrows scroll it', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await open(page, WIN);
  await row(page, 'freelancermap-2801').click();
  const title = page.getByTestId('reader-title');
  await expect(title).toBeVisible();
  const stage = page.getByTestId('stage');
  const top = (): Promise<number> => stage.evaluate((node) => node.scrollTop);
  const opened = await title.innerText();
  // A click on the ad's text: the arrows scroll the reader, the job stays.
  await title.click();
  // (WebKit may bring the clicked title into view first: the step counts from there.)
  const start = await top();
  await page.keyboard.press('ArrowDown');
  await expect.poll(top).toBeGreaterThan(start);
  await page.keyboard.press('End');
  await expect
    .poll(() => stage.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(1);
  await expect(title).toHaveText(opened);
});

test('a chip value copies, a double click only selects a word; its x says Entfernen', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const keywords = await reveal(page, page.getByTestId('profile-tools'));
  const chip = keywords.locator('[data-chip]').first();
  const text = chip.locator('.text');
  await text.scrollIntoViewIfNeeded();
  const value = await text.innerText();
  const count = await keywords.locator('[data-chip]').count();
  // A drag over the value selects it.
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const selected = await page.evaluate(() => getSelection()?.toString() ?? '');
  expect(value.startsWith(selected.trim())).toBe(true);
  expect(selected.trim().length).toBeGreaterThan(1);
  // The x names what it removes for a screen reader, its tooltip the action; it is hit 24 px
  // wide around its 16 px.
  const remove = chip.locator('.remove');
  await expect(remove).toHaveAccessibleName(T.chips.remove(value));
  const x = (await remove.boundingBox())!;
  await page.mouse.move(x.x + x.width + 3, x.y + x.height / 2);
  await expect(page.getByRole('tooltip')).toHaveText(T.common.remove);
  // A double click selects a word of the value and leaves the chip where it is.
  await text.dblclick();
  await expect(keywords.locator('input')).toHaveValue('');
  await expect(keywords.locator('[data-chip]')).toHaveCount(count);
  expect(value).toContain((await page.evaluate(() => getSelection()?.toString() ?? '')).trim());
});

test('the dry-run note shows in Einstellungen', async ({ page }) => {
  await settings(page, `${WIN}&scenario=dry-run`);
  await expect(page.getByTestId('dry-run-note')).toHaveText(T.settings.dryRun);
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
  await open(page, WIN);
  const motion = (): Promise<string | undefined> =>
    page.evaluate(() => document.documentElement.dataset.motion);
  expect(await motion()).toBe('full');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(motion).toBe('reduce');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(motion).toBe('full');
});

test('under reduced motion nothing scales or pops', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, `${WIN}&view=profile`);
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ['--move-sm', '--dur-hover'].map((name) => parseFloat(style.getPropertyValue(name)));
  });
  expect(tokens).toEqual([0, 0]);
  // Clicked without the pointer over it (no tooltip comes).
  await page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-testid="contract-temporary"]')!.click(),
  );
  const scripted = await page.evaluate(
    // What comes meanwhile (Mindestgehalt unfolds) moves and scales nothing.
    () =>
      document
        .getAnimations()
        .filter((a) => !(a instanceof CSSAnimation))
        .filter((a) => Number((a.effect as KeyframeEffect).getTiming().duration) > 0)
        .filter((a) =>
          (a.effect as KeyframeEffect).getKeyframes().some((frame) => 'transform' in frame),
        ).length,
  );
  expect(scripted).toBe(0);
});

test('hover rests while a list scrolls', async ({ page }) => {
  await open(page, '?platform=windows&scenario=many');
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
  // waits for `:not([data-still])`), the row button, the row around it and its place in the
  // list; nothing else in
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
  // The row's place in the list (its hairlines), the row around the button and the button.
  expect(during.rows).toHaveLength(3);
  expect(during.rows[0]).toMatch(/^job-row-/);
  expect(new Set(during.rows).size).toBe(1);
  expect(during.hovered).toBe(true);
  await expect.poll(still, { timeout: 1000 }).toEqual([]);
});

/* -------------------------------------------------------------------------- Window sizes */

// Window sizes the app must survive: the minimum 480 × 360 (small enough to snap into every
// Windows 11 layout, quarters of 1366 × 768 included), typical laptops at 125 % scaling
// (1280 × 720, 1536 × 864) and common desktops.

for (const size of SIZES) {
  for (const query of ['?platform=windows', '?platform=macos']) {
    test(`no horizontal scroll, nothing clipped at ${size.width}x${size.height} ${query}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await open(page, query);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        for (const node of [document.documentElement, ...document.querySelectorAll('.view')]) {
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

for (const [width, fold] of [
  [1280, false],
  [1100, false],
  [1099, true],
  [780, true],
] as const) {
  test(`the sidebar ${fold ? 'folds away' : 'stands beside the view'} at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await open(page, '?platform=windows');
    if (fold) {
      await expect(page.getByTestId('sidebar')).toHaveCount(0);
      await expect(page.getByTestId('toggle-sidebar')).toBeVisible();
      return;
    }
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('nav-profile')).toHaveText(await text(page, 'nav.profile'));
  });
}

test('toasts leave on their own once the window is in front again', async ({ page }) => {
  // Seconds of it are the CV's evaluation and the toasts' own life: a busy machine needs more
  // than the usual 30 s.
  test.slow();
  await open(page, `${WIN}&view=settings`);
  // The window in the back holds their time, so a slow machine still sees all of them.
  await page.evaluate(() => window.__harness.fire('tauri://blur', null));
  const toasts = page.getByTestId('toast');
  // Two plain toasts: a rescore in Einstellungen, the CV.
  await page.evaluate(() => window.__harness.appRun('rescore'));
  await expect(toasts).toHaveCount(1);
  await page.getByTestId('nav-profile').click();
  await page.getByTestId('profile-from-cv').click();
  await expect(toasts).toHaveCount(2);
  // Their time runs once the window is in front again (the pointer on a toast stops it:
  // toasts.spec.ts).
  await page.evaluate(() => window.__harness.fire('tauri://focus', null));
  await expect(toasts).toHaveCount(0, { timeout: 7000 });
});

// Every view in every scenario, and every step of the setup (a mode without the sidebar).
for (const [width, height] of [
  [480, 360],
  [780, 560],
] as const) {
  for (const step of ['welcome', 'way', 'upload', 'reading', 'profile', 'alerts', 'done']) {
    test(`nothing clipped or scrolling sideways at ${width}x${height}: setup ${step}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await open(page, `?platform=windows&scenario=first-run&step=${step}`);
      await page.waitForTimeout(300);
      const wide = await page.evaluate(() =>
        [...document.querySelectorAll('.view, .view *')]
          .filter(
            (node) =>
              node.scrollWidth > node.clientWidth + 1 &&
              getComputedStyle(node).overflowX !== 'visible' &&
              getComputedStyle(node).textOverflow !== 'ellipsis' &&
              node.closest('[role="progressbar"], [aria-hidden="true"]') === null &&
              !node.matches('input, textarea'),
          )
          .map((node) => `${node.tagName}.${node.className}`),
      );
      expect(wide).toEqual([]);
      // Its primary and Zurück: at the window's bottom on the long profile step, else right
      // under the content, reached by scrolling.
      const bar = page.getByTestId('first-bar');
      if ((await bar.count()) === 0) return;
      if (step !== 'profile') await bar.scrollIntoViewIfNeeded();
      await expect(bar).toBeInViewport();
    });
  }
  for (const scenario of ['default', 'running', 'no-profile']) {
    for (const tab of ['nav-jobs', 'nav-profile', 'nav-settings'] as const) {
      test(`nothing clipped or scrolling sideways at ${width}x${height}: ${scenario} ${tab}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await open(page, `?platform=windows&scenario=${scenario}`);
        await nav(page, tab);
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
  await pressAndLeave(page, fetch);
  expect(await calls(page, 'start_run')).toHaveLength(0);
});

test('a button held out of the window and released there stays at rest and does nothing', async ({
  page,
}) => {
  await open(page, WIN);
  await pressAndLeave(page, page.getByTestId('fetch'), OUTSIDE);
  await pressAndLeave(page, page.getByTestId('nav-settings'), OUTSIDE);
  await pressAndLeave(page, page.getByTestId('place-archive'), OUTSIDE);
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
  // The window's own buttons alike (in the app the window over the bar reports the same).
  for (const button of ['minimize', 'maximize', 'close'] as const) {
    await pressAndLeave(page, page.getByTestId(`window-${button}`), OUTSIDE);
  }
  expect(await calls(page, 'start_run')).toHaveLength(0);
  expect(await calls(page, 'window_button')).toHaveLength(0);
});

test('a held sidebar entry that the pointer leaves looks at rest', async ({ page }) => {
  await open(page, WIN);
  await pressAndLeave(page, page.getByTestId('nav-settings'));
  await pressAndLeave(page, page.getByTestId('place-archive'));
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
});

/* ------------------------------------------------------------------ Zurück and Vor */

test('Zurück to a job that was archived since shows it where it lies, its row marked', async ({
  page,
}) => {
  await open(page, WIN);
  await openJob(page, 'linkedin-4100200301');
  await page.getByTestId('reader-archive').click();
  await expect(row(page, 'linkedin-4100200301')).toHaveCount(0);
  await page.getByTestId('history-back').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
  await expect(row(page, 'linkedin-4100200301')).toBeVisible();
  await expect(list(page).locator('[data-open][data-key="linkedin:4100200301"]')).toHaveCount(1);
  // It lies in the list's place, so its tools work.
  await expect(page.getByTestId('reader-unarchive')).not.toHaveAttribute('aria-disabled', 'true');
  // Vor goes on to the job that opened after it, back in Aktuell.
  await page.getByTestId('history-forward').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.inbox);
  await expect(list(page).locator('[data-open]')).toHaveCount(1);
});

test('Zurück skips a step whose job was deleted for good', async ({ page }) => {
  await open(page, WIN);
  await openPlace(page, 'trash');
  await openJob(page, 'linkedin-4100200307');
  await page.getByTestId('reader-purge').click();
  await page.getByTestId('dialog-purge').getByTestId('dialog-confirm').click();
  await expect(row(page, 'linkedin-4100200307')).toHaveCount(0);
  // The delete closed the job (a step), the next one opened by itself (another): two steps
  // back, the second to the job that is gone.
  await page.getByTestId('history-back').click();
  await expect(page.getByTestId('place-reader')).toBeVisible();
  const asked = (await calls(page, 'job_detail')).length;
  await page.getByTestId('history-back').click();
  await expect.poll(async () => (await calls(page, 'job_detail')).length).toBeGreaterThan(asked);
  await settle(page);
  // The step before it shows: the Papierkorb with no job open, not a failed load.
  await expect(page.getByTestId('place-reader')).toBeVisible();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.trash);
  await expect(stage(page).getByTestId('reader-title')).toHaveCount(0);
  await expect(page.getByTestId('reader-error')).toHaveCount(0);
  await expect(page.getByText(T.reader.loadFailed)).toHaveCount(0);
});

test('Zurück and Vor take both clicks of a double click, a step each', async ({ page }) => {
  await open(page, WIN);
  await openJob(page, 'linkedin-4100200301');
  await openJob(page, 'freelancermap-2802');
  await openJob(page, 'linkedin-4100200303');
  const title = (key: string): Promise<string> => row(page, key).locator('.title').innerText();
  await page.getByTestId('history-back').dblclick();
  await expect(stage(page).getByTestId('reader-title')).toHaveText(
    await title('linkedin-4100200301'),
  );
  await page.getByTestId('history-forward').dblclick();
  await expect(stage(page).getByTestId('reader-title')).toHaveText(
    await title('linkedin-4100200303'),
  );
});

test('a start with a job kept open has no step to go back to', async ({ page }) => {
  await open(page, `${WIN}&open=freelancermap:2802`);
  await expect(stage(page).getByTestId('reader-title')).toBeVisible();
  const title = await stage(page).getByTestId('reader-title').innerText();
  await expect(page.getByTestId('history-back')).toHaveAttribute('aria-disabled', 'true');
  await openJob(page, 'linkedin-4100200301');
  await expect(page.getByTestId('history-back')).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('history-back').click();
  await expect(stage(page).getByTestId('reader-title')).toHaveText(title);
  await expect(page.getByTestId('history-back')).toHaveAttribute('aria-disabled', 'true');
});
