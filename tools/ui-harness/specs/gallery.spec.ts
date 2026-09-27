import { expect, expectShot, open, settle, test } from './fixtures';

const SECTIONS = [
  'colours',
  'type',
  'spacing',
  'radii',
  'shadows',
  'gradients',
  'motion',
  'icons',
  'buttons',
  'navigation',
  'tiles',
  'empty',
  'activity',
  'cards',
  'badges',
  'loading',
  'split',
  'inputs',
  'rings',
  'stats',
  'notices',
  'dialogs',
  'reasons',
  'rows',
];

test('the gallery renders every board and component section', async ({ page }) => {
  await open(page, '?gallery');
  await expect(page.getByTestId('gallery')).toBeVisible();
  for (const section of SECTIONS) {
    await expect(page.getByTestId(`gallery-${section}`)).toBeVisible();
  }
  // Contrast is computed from the live tokens: body text passes AA on white.
  await expect(page.getByTestId('swatch-text')).toContainText('AA');
});

test('score rings show their value, an excluded one in grey without a ban mark; unscorable a dash', async ({
  page,
}) => {
  await open(page, '?gallery');
  const high = page.getByTestId('ring-high-lg');
  await high.scrollIntoViewIfNeeded();
  await expect(high).toHaveText('91');
  await expect(high).toHaveAttribute(
    'aria-label',
    new RegExp(`^Hohe Übereinstimmung, 91${String.fromCharCode(0x202f)}%$`),
  );
  await expect(page.getByTestId('ring-excluded-lg')).toContainText('72');
  // No ban mark on the ring: the reason line beside it carries it.
  await expect(page.getByTestId('ring-excluded-lg').locator('svg')).toHaveCount(1);
  await expect(page.getByTestId('ring-unscorable-lg')).toHaveText('–');
});

test('every ring without a score is the same hollow ring with a dash, at every size', async ({
  page,
}) => {
  await open(page, '?gallery');
  for (const state of ['pending', 'none', 'unscorable']) {
    for (const size of ['lg', 'md', 'sm']) {
      const ring = page.getByTestId(`ring-${state}-${size}`);
      await expect(ring).toHaveText('–');
      await expect(ring.locator('circle')).toHaveCount(1);
      await expect(ring).toHaveAttribute('aria-label', 'Noch nicht bewertet');
    }
  }
});

test('a reason is its icon and its words; the icon alone names it, why in its tooltip', async ({
  page,
}) => {
  await open(page, '?gallery');
  const section = page.getByTestId('gallery-reasons');
  await section.scrollIntoViewIfNeeded();
  // Plain text: nothing to press, nothing that washes.
  await expect(section.locator('button.reason')).toHaveCount(0);
  const icon = section.locator('.reason.icon-only').first();
  await expect(icon).toHaveAttribute('role', 'img');
  await page.waitForTimeout(250);
  await icon.hover();
  await expect(page.getByRole('tooltip')).toContainText('Konzerncontrolling');
});

test('to check has one colour: the chip and the reason alike', async ({ page }) => {
  await open(page, '?gallery');
  const section = page.getByTestId('gallery-reasons');
  await section.scrollIntoViewIfNeeded();
  const chip = await section
    .locator('.chip.unknown .chip-icon')
    .evaluate((node) => getComputedStyle(node).color);
  const reason = await section
    .locator('.reason.check .icon')
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  expect(chip).toBe(reason);
});

test('under reduced motion the rings jump to their value', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '?gallery');
  const mid = page.getByTestId('ring-mid-lg');
  await mid.scrollIntoViewIfNeeded();
  await settle(page);
  await expect(mid).toHaveText('64', { timeout: 200 });
});

test('controls: toggle, segmented, password reveal, search clear, disclosure', async ({ page }) => {
  await open(page, '?gallery');
  const section = page.getByTestId('gallery-inputs');
  const toggle = section.getByRole('switch').first();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  const facet = page.getByTestId('segmented-facet');
  await facet.getByRole('radio', { name: /Alle/ }).click();
  await expect(facet.getByRole('radio', { name: /Alle/ })).toHaveAttribute('aria-checked', 'true');

  const password = page.locator('#gallery-password');
  await expect(password).toHaveAttribute('type', 'password');
  await section.getByRole('button', { name: 'Passwort zeigen' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveAttribute('spellcheck', 'false');

  const search = section.getByRole('textbox', { name: 'Jobs durchsuchen' }).first();
  await expect(search).toHaveValue('Controlling');
  await section.getByRole('button', { name: 'Suche leeren' }).click();
  await expect(search).toHaveValue('');

  const disclosure = page.getByTestId('disclosure').getByRole('button');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
});

test('dialog: Esc cancels, a press that ends on the scrim keeps it open', async ({ page }) => {
  await open(page, '?gallery');
  await page.getByTestId('open-danger').click();
  const dialog = page.getByTestId('dialog-danger');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.getByTestId('open-danger').click();
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(5, 100);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  // Below the toolbar row (macOS keeps it for moving the window while a dialog is open).
  await page.mouse.click(5, 100);
  await expect(dialog).toHaveCount(0);
});

test('job rows select on click and reorder without losing a row', async ({ page }) => {
  await open(page, '?gallery');
  const list = page.getByTestId('job-list');
  await list.scrollIntoViewIfNeeded();
  const rows = list.locator('[data-testid^="job-row-"]');
  await expect(rows).toHaveCount(6);
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  const first = await rows.first().getAttribute('data-testid');
  await page.getByTestId('rows-shuffle').click();
  await expect(rows).toHaveCount(6);
  await expect(rows.last()).toHaveAttribute('data-testid', first!);
});

test('a quiet button that loses something for good is red at rest and on hover', async ({
  page,
}) => {
  await open(page, '?gallery');
  const reset = page.getByTestId('button-warns');
  await reset.scrollIntoViewIfNeeded();
  const colour = (): Promise<string> => reset.evaluate((node) => getComputedStyle(node).color);
  const danger = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger-strong)';
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  await expect.poll(colour).toBe(danger);
  await reset.hover();
  await expect.poll(colour).toBe(danger);
});

test('the hairline under a row spans it, or insets where the list reaches past its column', async ({
  page,
}) => {
  await open(page, '?gallery');
  const list = page.getByTestId('job-list');
  await list.scrollIntoViewIfNeeded();
  const rule = (): Promise<{ left: string; right: string; height: string }> =>
    list
      .locator('.row')
      .first()
      .evaluate((row) => {
        const style = getComputedStyle(row, '::after');
        return { left: style.left, right: style.right, height: style.height };
      });
  expect(await rule()).toEqual({ left: '0px', right: '0px', height: '1px' });
  await list.evaluate((node) => node.style.setProperty('--row-rule-inset', 'var(--pane-padding)'));
  expect(await rule()).toEqual({ left: '16px', right: '16px', height: '1px' });
});

test('job rows: no tools, provisional ring, no dot on excluded', async ({ page }) => {
  await open(page, '?gallery&platform=windows');
  const list = page.getByTestId('job-list');
  await list.scrollIntoViewIfNeeded();
  const job = (id: string) =>
    list.locator('.job', { has: page.locator(`[data-testid="job-row-${id}"]`) });
  // A row has no tools, also under the pointer (its menu is a right click).
  await page.getByTestId('job-row-freelancermap-1001').hover();
  await expect(job('freelancermap-1001').locator('.tools')).toHaveCount(0);
  // No stage badges.
  await expect(job('linkedin-1002')).not.toContainText('Beworben');
  await expect(job('freelancermap-1001')).not.toContainText('Gemerkt');
  // A score from a teaser is provisional (named so, drawn like any score); an excluded unread
  // row has no dot.
  await expect(job('freelance-1003').locator('.ring')).toHaveClass(/provisional/);
  await expect(job('freelance-1003').locator('.ring .track')).toHaveCSS('stroke-dasharray', 'none');
  await expect(job('freelancermap-1006').locator('.dot')).toHaveCount(0);
});

test('a row: the date ends the title line and stays under the pointer', async ({ page }) => {
  await open(page, '?gallery&platform=windows');
  const list = page.getByTestId('job-list');
  await list.scrollIntoViewIfNeeded();
  const job = list.locator('.job', { has: page.getByTestId('job-row-freelancermap-1001') });
  const box = async (selector: string) => (await job.locator(selector).first().boundingBox())!;
  const title = await box('.title');
  const date = await box('.date');
  expect(Math.abs(date.y + date.height / 2 - (title.y + title.height / 2))).toBeLessThan(2);
  // Company and place use the full width, up to the date's right edge.
  const meta = await box('.meta');
  expect(meta.x + meta.width).toBeGreaterThan(date.x + date.width - 1);
  await job.hover({ position: { x: 120, y: 30 } });
  await expect(job.locator('.date')).toHaveCSS('opacity', '1');
  await expect(job.locator('.tools')).toHaveCount(0);
});

test('a long row title stays one line, every row one height, the rest is a tooltip', async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  await page.getByTestId('job-list').scrollIntoViewIfNeeded();
  const long = page.getByTestId('job-row-freelancermap-1004');
  const short = page.getByTestId('job-row-freelancermap-1005');
  const title = long.locator('.title');
  const lines = await title.evaluate(
    (node) => node.clientHeight / parseFloat(getComputedStyle(node).lineHeight),
  );
  expect(Math.round(lines)).toBe(1);
  expect((await short.boundingBox())!.height).toBe(64);
  expect((await long.boundingBox())!.height).toBe(64);
  // Cut off on its one line: the full title shows in a tooltip.
  await title.hover();
  await expect(page.getByRole('tooltip')).toContainText('vierzehn Ländern');
});

test('the column handle: left drag resizes within its live limits, double click resets, it is kept', async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  const list = page.getByTestId('split-list');
  const splitter = page.getByTestId('splitter');
  const handle = splitter.locator('.hit');
  await handle.scrollIntoViewIfNeeded();
  const width = async (): Promise<number> => Math.round((await list.boundingBox())!.width);
  // The demo's limits follow its width like the list's follow the window: at least 320 px,
  // the reader keeps 440 px, the list at most 60 %; first 40 %, at least 520 px where the
  // reader keeps its room, at most 600 px.
  const room = await page.getByTestId('split-demo').evaluate((node) => node.clientWidth);
  const max = Math.max(320, Math.min(room - 440, Math.round(room * 0.6)));
  const first = Math.max(320, Math.min(max, Math.max(Math.round(room * 0.4), 520), 600));
  await expect(splitter).toHaveAttribute('aria-valuemin', '320');
  await expect(splitter).toHaveAttribute('aria-valuemax', String(max));
  await expect.poll(width).toBe(first);
  await expect(handle).toHaveCSS('cursor', 'col-resize');
  const drag = async (dx: number, button: 'left' | 'right' = 'left'): Promise<void> => {
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    await page.mouse.move(x + dx / 2, y, { steps: 3 });
    await page.mouse.move(x + dx, y, { steps: 3 });
    await page.mouse.up({ button });
  };
  await drag(-60);
  await expect.poll(width).toBe(first - 60);
  // Never past max or min; the right button does nothing.
  await drag(2000);
  await expect.poll(width).toBe(max);
  await drag(-40, 'right');
  await expect.poll(width).toBe(max);
  await drag(-2000);
  await expect.poll(width).toBe(320);
  await drag(50);
  await expect.poll(width).toBe(370);
  // Kept across a reload; a double click sets it back.
  await page.reload();
  await handle.scrollIntoViewIfNeeded();
  await expect.poll(width).toBe(370);
  await handle.dblclick();
  await expect.poll(width).toBe(first);
  await page.reload();
  await handle.scrollIntoViewIfNeeded();
  await expect.poll(width).toBe(first);
});

test('nav sub-entries: quieter, indented, the one pill covers the active one (also in the rail)', async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  const section = page.getByTestId('gallery-navigation');
  await section.scrollIntoViewIfNeeded();
  const full = page.getByTestId('gnav-full').locator('nav');
  const rail = page.getByTestId('gnav-rail').locator('nav');
  for (const nav of [full, rail]) {
    for (const id of ['gnav-trash', 'gnav-archive', 'gnav-0', 'gnav-2']) {
      await nav.getByTestId(id).click();
      await expect(nav.getByTestId(id)).toHaveAttribute('aria-current', 'page');
      // The pill has slid onto the entry (in the rail it shrinks onto a smaller sub-entry).
      await expect
        .poll(async () => {
          const pill = (await nav.locator('.indicator').boundingBox())!;
          const entry = (await nav.getByTestId(id).boundingBox())!;
          return [
            pill.x - entry.x,
            pill.y - entry.y,
            pill.width - entry.width,
            pill.height - entry.height,
          ].map((value) => Math.round(value));
        })
        .toEqual([0, 0, 0, 0]);
    }
  }
  // Collapsed, a sub-entry is a smaller icon with its name as the accessible name (and tooltip).
  await expect(rail.getByTestId('gnav-trash')).toHaveAttribute('aria-label', 'Papierkorb');
  expect((await rail.getByTestId('gnav-trash').boundingBox())!.width).toBe(32);
  // Expanded, it is indented under the parent's label and quieter (13 px).
  const [parent, sub] = await Promise.all(
    ['gnav-0', 'gnav-archive'].map((id) => full.getByTestId(id).locator('.glyph').boundingBox()),
  );
  expect(sub!.x - parent!.x).toBeGreaterThan(20);
  await expect(full.getByTestId('gnav-archive')).toHaveCSS('font-size', '13px');
});

test('the sidebar in the gallery: its places fold, its edge folds it to the rail', async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  const folded = page.getByTestId('gnav-folded');
  await folded.scrollIntoViewIfNeeded();
  // Hidden places: the arrow points right and brings them back.
  await expect(folded.getByTestId('gnav-archive')).toBeHidden();
  await folded.getByTestId('gnav-fold-folded').click();
  await expect(folded.getByTestId('gnav-archive')).toBeVisible();
  await expect(page.getByTestId('gnav-rail-folded').getByTestId('gnav-archive')).toBeHidden();
});

test("a menu button opens the app's menu of choices below it; a choice applies", async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  const button = page.getByTestId('menu-order');
  await button.scrollIntoViewIfNeeded();
  await expect(button).toHaveText('Nach Passung');
  await expect(button).toHaveAttribute('aria-haspopup', 'menu');
  await button.click();
  const menu = page.getByTestId('menu');
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitemradio')).toHaveText(['Nach Passung', 'Nach Datum']);
  await expect(page.getByTestId('menu-item-match')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('menu-item-date')).toHaveAttribute('aria-checked', 'false');
  // Right below the button, on its left edge.
  const box = (await button.boundingBox())!;
  const shown = (await menu.boundingBox())!;
  expect(Math.abs(shown.x - box.x)).toBeLessThanOrEqual(1);
  expect(shown.y).toBeGreaterThanOrEqual(box.y + box.height);
  await page.getByTestId('menu-item-date').click();
  await expect(menu).toHaveCount(0);
  await expect(button).toHaveText('Nach Datum');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  // Disabled: the tooltip says why, no menu opens.
  const off = page.getByTestId('menu-order-off');
  await off.click({ force: true });
  await expect(menu).toHaveCount(0);
  await page.mouse.move(0, 0);
  await off.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Ohne Profil nur nach Datum.');
});

test('a click selects one job of the list; Ctrl+click chooses no more', async ({ page }) => {
  await open(page, '?gallery&platform=windows');
  const list = page.getByTestId('job-list');
  await list.scrollIntoViewIfNeeded();
  await page.getByTestId('job-row-linkedin-1002').click({ modifiers: ['Control'] });
  await expect(list.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(page.getByTestId('job-row-linkedin-1002')).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('job-row-freelancermap-1004').click({ modifiers: ['Shift'] });
  await expect(list.locator('[aria-current="true"]')).toHaveCount(1);
});

test('moving jobs out: the row folds away, one toast merges them, one undo brings all back', async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  const list = page.getByTestId('job-list');
  await list.scrollIntoViewIfNeeded();
  const rows = list.locator('[data-testid^="job-row-"]');
  await expect(rows).toHaveCount(6);
  // The row folds away: its wrapper animates its height while the rows below follow.
  await page.getByTestId('job-row-freelancermap-1004').click({ button: 'right' });
  const folding = await page.evaluate(async () => {
    const wrapper = document
      .querySelector('[data-testid="job-row-freelancermap-1004"]')!
      .closest('.job')!.parentElement!;
    document.querySelector<HTMLElement>('[data-testid="menu-item-archive"]')!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return wrapper.getAnimations().length;
  });
  expect(folding).toBeGreaterThan(0);
  await expect(rows).toHaveCount(5);
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('„SAP FI Berater');
  // A second one within two seconds joins the same toast.
  await page.getByTestId('job-row-freelancermap-1005').click({ button: 'right' });
  await page.getByTestId('menu-item-archive').click();
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('2 Jobs archiviert.');
  await expect(rows).toHaveCount(4);
  // One undo brings both back, in their places.
  await toast.getByTestId('toast-action').click();
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(3)).toHaveAttribute('data-testid', 'job-row-freelancermap-1004');
  await expect(rows.nth(4)).toHaveAttribute('data-testid', 'job-row-freelancermap-1005');
});

test('a toast that names a job: the title keeps to one line in its quotes, two lines at most', async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  const list = page.getByTestId('job-list');
  await list.scrollIntoViewIfNeeded();
  const toast = page.getByTestId('toast');
  const shape = (): Promise<{ lines: number; cut: boolean; quoted: string; width: number }> =>
    toast.evaluate((node) => {
      const text = node.querySelector<HTMLElement>('[data-testid="toast-text"]')!;
      const name = text.querySelector<HTMLElement>('.name')!;
      const style = getComputedStyle(text);
      const inner = text.clientHeight - parseFloat(style.paddingTop) * 2;
      return {
        lines: Math.round(inner / parseFloat(style.lineHeight)),
        // Cut by the toast itself: the ellipsis is part of the text, the quote follows it.
        cut: (name.textContent ?? '').endsWith('…'),
        quoted: text.querySelector('.quoted')!.textContent ?? '',
        width: (node as HTMLElement).offsetWidth,
      };
    });
  // A title of usual length stands whole.
  await page.getByTestId('job-row-freelance-1003').click({ button: 'right' });
  await page.getByTestId('menu-item-archive').click();
  await expect(toast).toContainText('„Kaufmännische Leitung Projektgeschäft“ archiviert.');
  const usual = await shape();
  expect(usual.width).toBe(520);
  expect(usual.cut).toBe(false);
  expect(usual.lines).toBeLessThanOrEqual(2);
  await toast.getByRole('button', { name: 'Ausblenden' }).click();
  await expect(toast).toHaveCount(0);
  // A very long one ends in an ellipsis inside its quotes; the verb follows on line two.
  await page.getByTestId('job-row-freelancermap-1004').click({ button: 'right' });
  await page.getByTestId('menu-item-archive').click();
  await expect(toast).toContainText('archiviert.');
  const long = await shape();
  expect(long.cut).toBe(true);
  expect(long.quoted.startsWith('„SAP FI Berater')).toBe(true);
  expect(long.quoted.endsWith('“')).toBe(true);
  expect(long.lines).toBe(2);
  // The full title is in the tooltip of the cut one.
  await toast.locator('.name').hover();
  await expect(page.getByRole('tooltip')).toContainText('in vierzehn Ländern');
});

test('an undo toast stays 10 s; toasts wait while the window is in the back', async ({ page }) => {
  await open(page, '?gallery&platform=windows');
  const list = page.getByTestId('job-list');
  await list.scrollIntoViewIfNeeded();
  const toast = page.getByTestId('toast');
  await page.getByTestId('job-row-freelance-1003').click({ button: 'right' });
  await page.getByTestId('menu-item-archive').click();
  await expect(toast.locator('.life')).toHaveCSS('animation-duration', '10s');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(5000);
  await expect(toast).toHaveCount(1);
  await toast.getByRole('button', { name: 'Ausblenden' }).click();
  // A plain toast (4 s) outlives its time while the window is in the back.
  await page.getByRole('button', { name: 'Toast zeigen' }).click();
  await expect(toast).toHaveCount(1);
  await expect(toast.locator('.life')).toHaveCSS('animation-duration', '4s');
  await page.evaluate(() => window.__harness.fire('tauri://blur', null));
  await page.waitForTimeout(4500);
  await expect(toast).toHaveCount(1);
  await expect(toast.locator('.life')).toHaveCSS('animation-play-state', 'paused');
  await page.evaluate(() => window.__harness.fire('tauri://focus', null));
  await expect(toast).toHaveCount(0, { timeout: 5000 });
});

test('a modal dialog dims the toasts, blocks their undo and keeps their time', async ({ page }) => {
  await open(page, '?gallery&platform=windows');
  await page.getByRole('button', { name: 'Toast zeigen' }).click();
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveCount(1);
  await page.getByTestId('open-danger').click();
  await expect(page.getByTestId('dialog-danger')).toBeVisible();
  // The scrim lies over the toast: a click there reaches the scrim, not the toast.
  const box = (await toast.boundingBox())!;
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="toast"]') !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe(false);
  await page.waitForTimeout(4500);
  await expect(toast).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog-danger')).toHaveCount(0);
  await expect(toast).toHaveCount(0, { timeout: 5000 });
});

test('only the switch of a switch row switches; an empty tile is no filter', async ({ page }) => {
  await open(page, '?gallery');
  const toggle = page.getByTestId('gallery-row-toggle');
  await toggle.scrollIntoViewIfNeeded();
  const before = await toggle.getAttribute('aria-checked');
  await page.getByText('Ruft neue Alert-Mails ab', { exact: false }).click();
  await expect(toggle).toHaveAttribute('aria-checked', before!);
  await toggle.click();
  await expect(toggle).not.toHaveAttribute('aria-checked', before!);
  // The tile with 0 is plain text; the chosen filter is pressed.
  expect(await page.getByTestId('tile-empty').evaluate((node) => node.tagName)).toBe('DIV');
  await expect(page.getByTestId('tile-filter')).toHaveAttribute('aria-pressed', 'true');
});

test('a segmented control never overlaps: each pill covers exactly its option', async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  for (const id of ['segmented-views', 'segmented-narrow']) {
    const control = page.getByTestId(id);
    await control.scrollIntoViewIfNeeded();
    for (const option of ['Neu', 'Alle', 'Gemerkt', 'Bewerbungen']) {
      await control.getByRole('radio', { name: new RegExp(option) }).click();
      const geometry = await control.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const options = [...node.querySelectorAll('.option')].map((o) => o.getBoundingClientRect());
        const chosen = node.querySelector('[aria-checked="true"]')!;
        const pill = chosen.querySelector('.pill')!.getBoundingClientRect();
        const own = chosen.getBoundingClientRect();
        return {
          inside: options.every((o) => o.left >= box.left - 0.5 && o.right <= box.right + 0.5),
          apart: options.every((o, i) => i === 0 || o.left >= options[i - 1]!.right - 0.5),
          pill: [pill.left - own.left, pill.right - own.right].map((d) => Math.abs(d) < 0.5),
          overflow: node.scrollWidth - node.clientWidth,
        };
      });
      expect(geometry, `${id} ${option}`).toEqual({
        inside: true,
        apart: true,
        pill: [true, true],
        overflow: 0,
      });
    }
  }
});

test('baseline: gallery (reduced motion, so counters and loops are at rest)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '?gallery');
  const height = await page.getByTestId('gallery').evaluate((node) => node.scrollHeight);
  await page.setViewportSize({ width: 1360, height: Math.ceil(height) });
  await settle(page);
  // A full-page capture of the long gallery takes WebKit a few seconds per frame.
  test.setTimeout(90_000);
  await expectShot(page, 'gallery', { maxDiffPixelRatio: 0.004, timeout: 30_000 });
});
