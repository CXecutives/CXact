// The one tooltip handed from anchor to anchor: moving the pointer straight from one trigger
// to the next (a title bar tool, the window's Schließen, a cut row title)
// shows the next tooltip at once, and its very first painted frame already sits where a
// fresh hover of that trigger places it, never at a place measured from the previous text.

import type { Locator, Page } from '@playwright/test';
import { animationsDone, expect, open, test } from './fixtures';
import {
  chipRemove,
  chooseFilter,
  funnel,
  list,
  listed,
  openJob,
  openPlace,
  reveal,
  row,
  rows,
  stage,
  T,
  WIN,
} from './helpers';

interface Frame {
  text: string;
  x: number;
  y: number;
}

/** Records the tooltip layer's box on every frame its text changes (read in
 *  requestAnimationFrame, so it is the box that frame paints). */
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Frame[] = [];
    (window as unknown as { tipFrames: Frame[] }).tipFrames = seen;
    const tick = (): void => {
      const layer = document.querySelector<HTMLElement>('[role="tooltip"]');
      const text = layer?.textContent ?? '';
      if (seen.at(-1)?.text !== text) {
        const box = layer?.getBoundingClientRect();
        seen.push({ text, x: box?.x ?? 0, y: box?.y ?? 0 });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** The first painted frame of the tooltip once it shows `text`. */
async function firstFrame(page: Page, text: string): Promise<Frame> {
  await expect
    .poll(() =>
      page.evaluate(
        (want) =>
          (window as unknown as { tipFrames: Frame[] }).tipFrames.some((f) => f.text === want),
        text,
      ),
    )
    .toBe(true);
  return page.evaluate(
    (want) => (window as unknown as { tipFrames: Frame[] }).tipFrames.find((f) => f.text === want)!,
    text,
  );
}

/** Where a fresh hover places the tooltip (the pointer away on the empty top bar long enough
 *  to cool down). */
async function fresh(page: Page, trigger: Locator): Promise<{ x: number; y: number }> {
  await page.mouse.move(700, 12);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.waitForTimeout(500);
  await trigger.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await page.waitForTimeout(250);
  const box = (await tip.boundingBox())!;
  return { x: box.x, y: box.y };
}

test('moving from one tooltip to the next shows it at its own anchor at once', async ({ page }) => {
  // A list dragged to its narrowest cuts the row titles.
  await page.addInitScript(() => localStorage.setItem('jobs-list-width', '320'));
  await open(page, '?platform=windows');
  const key = (await rows(page).first().getAttribute('data-testid'))!.replace('job-row-', '');
  await openJob(page, key);
  await page.setViewportSize({ width: 1180, height: 760 });
  const titles = await list(page).locator('.title').all();
  let truncated: Locator | null = null;
  for (const title of titles) {
    if (await title.evaluate((n) => n.scrollWidth > n.clientWidth + 1)) {
      truncated = title;
      break;
    }
  }
  const triggers: Locator[] = [
    page.getByTestId('toggle-sidebar'),
    page.getByTestId('window-close'),
    page.getByTestId('toggle-reader'),
  ];
  expect(truncated, 'a cut title').not.toBeNull();
  triggers.push(truncated!);

  // The handover: straight from one trigger to the next, the first frame of each recorded.
  await page.mouse.move(700, 12);
  await page.waitForTimeout(500);
  await watch(page);
  await triggers[0]!.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  const handed: { text: string; frame: Frame }[] = [];
  for (const trigger of triggers.slice(1)) {
    await trigger.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    const text = (await tip.textContent()) ?? '';
    handed.push({ text, frame: await firstFrame(page, text) });
  }

  // Each against a fresh hover of the same trigger.
  for (const [at, trigger] of triggers.slice(1).entries()) {
    const want = await fresh(page, trigger);
    const got = handed[at]!.frame;
    expect(Math.abs(got.x - want.x), handed[at]!.text).toBeLessThanOrEqual(1.5);
    expect(Math.abs(got.y - want.y), handed[at]!.text).toBeLessThanOrEqual(1.5);
  }
});

/* ============================================================== what the audit found */

// A bubble that came with the keyboard's focus or with a hover goes on a press, a scroll and
// Esc, never comes from a focus the code set after a mouse action, never returns for a button
// that slid under a pointer at rest, and its removal with its view throws nothing (the
// fixture fails a test on any page error).

/** The keyboard's way: after a Tab the next focus() is a keyboard user's (it shows a tooltip). */
async function byKeys(page: Page): Promise<void> {
  await page.keyboard.press('Tab');
}

const tip = (page: Page): Locator => page.getByRole('tooltip');

test.describe('a tooltip goes when it should', () => {
  test('on a scroll of the pane: the bubble does not stay where its anchor was', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 420 });
    await open(page, WIN);
    await openJob(page, 'linkedin-4100200301');
    await byKeys(page);
    await page.getByTestId('reader-archive').focus();
    await expect(tip(page)).toHaveText(T.actions.archive);
    await stage(page).evaluate((node) => node.scrollTo({ top: 120 }));
    await expect(tip(page)).toHaveCount(0);
  });

  test('on a press anywhere, also on a sidebar entry that takes no focus', async ({ page }) => {
    await open(page, WIN);
    await byKeys(page);
    await funnel(page).focus();
    await expect(tip(page)).toHaveText(T.toolbar.filter);
    await page.getByTestId('place-archive').click();
    await expect(tip(page)).toHaveCount(0);
    await page.waitForTimeout(700);
    await expect(tip(page)).toHaveCount(0);
  });

  test('on Esc', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('toggle-sidebar').hover();
    await expect(tip(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip(page)).toHaveCount(0);
  });

  test('a press drops the tooltip that still waits for its delay', async ({ page }) => {
    await open(page, WIN);
    await byKeys(page);
    await funnel(page).focus();
    await page.getByTestId('place-trash').click();
    await page.waitForTimeout(700);
    await expect(tip(page)).toHaveCount(0);
  });

  test('a focused control that leaves with its view takes its bubble without an error', async ({
    page,
  }) => {
    await open(page, WIN);
    await byKeys(page);
    await funnel(page).focus();
    await expect(tip(page)).toHaveText(T.toolbar.filter);
    // The native menu changes the view: the funnel goes while it holds the focus.
    await page.evaluate(() => window.__harness.fire('navigate', 'settings'));
    await expect(page.getByTestId('view-settings')).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
  });

  test('a chip taken off with the mouse after Esc in the menu sets no focus, so no tooltip', async ({
    page,
  }) => {
    await open(page, WIN);
    await chooseFilter(page, 'portal-linkedin');
    await chipRemove(page, 'portal-linkedin').click();
    await expect(page.getByTestId('filter-chips')).toHaveCount(0);
    await page.waitForTimeout(700);
    await expect(tip(page)).toHaveCount(0);
    await expect(funnel(page)).not.toBeFocused();
  });

  test('a button that slid under a pointer at rest after a press shows none until it moves', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'linkedin-4100200301');
    const archive = page.getByTestId('reader-archive');
    const box = (await archive.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.up();
    // The next job opened under the pointer, which did not move.
    await expect(page.getByTestId('reader-archive')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(tip(page)).toHaveCount(0);
    // It moves: the button under it says its name after the delay.
    await page.mouse.move(at.x + 2, at.y + 1);
    await expect(tip(page)).toHaveText(T.actions.archive);
  });

  test('an open menu silences what lies behind it, an entry of it still says why it is off', async ({
    page,
  }) => {
    await open(page, WIN);
    const menu = page.getByTestId('menu');
    await funnel(page).click();
    await expect(menu).toBeVisible();
    // Into the menu and back onto the button that opened it: no bubble over the menu's corner.
    await menu.locator('[role^="menuitem"]').first().hover();
    await funnel(page).hover();
    await page.waitForTimeout(700);
    await expect(tip(page)).toHaveCount(0);
    // Nor at the top bar's button behind the menu.
    await page.getByTestId('toggle-sidebar').hover();
    await page.waitForTimeout(700);
    await expect(tip(page)).toHaveCount(0);
    // The menu gone, they speak again.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await funnel(page).hover();
    await expect(tip(page)).toHaveText(T.toolbar.filter);
    // A bubble that stands goes when the key opens a menu.
    await rows(page).first().click();
    await funnel(page).hover();
    await expect(tip(page)).toHaveText(T.toolbar.filter);
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    // An entry of a menu still says why it is off.
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    await page.getByTestId('fetch').click();
    const key = (await listed(page))[0]!;
    await row(page, key).click({ button: 'right' });
    await page.getByTestId('menu-item-trash').click();
    await openPlace(page, 'trash');
    await row(page, key).click({ button: 'right' });
    await expect(page.getByTestId('menu-item-purge')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('menu-item-purge').hover();
    await expect(tip(page)).toHaveText(T.error.text('busy', { activity: 'fetch' }));
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window.__harness.holdAfter = null));
  });

  test('a title that fits but ends under the tools of its row shows its tooltip', async ({
    page,
  }) => {
    await open(page, WIN);
    const key = (await listed(page))[0]!;
    await row(page, key).hover();
    await expect(page.getByTestId('row-tools')).toBeVisible();
    // The title grown to the stretch the tools fade it out in, short of being cut.
    const fits = await page.evaluate((id) => {
      const target = document.querySelector(`[data-testid="job-row-${id}"]`)!;
      const title = target.querySelector<HTMLElement>('.title')!;
      const tools = target.parentElement!.querySelector('[data-testid="row-tools"]')!;
      const fade = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--list-tools-fade'),
      );
      const end = (): number => {
        const range = document.createRange();
        range.selectNodeContents(title);
        return range.getBoundingClientRect().right;
      };
      const limit = tools.getBoundingClientRect().left - fade;
      let text = 'x';
      title.textContent = text;
      while (end() <= limit + 2 && text.length < 200) {
        text += 'x';
        title.textContent = text;
      }
      return title.scrollWidth <= title.clientWidth;
    }, key);
    expect(fits).toBe(true);
    await row(page, key).locator('.title').hover();
    await expect(tip(page)).toBeVisible();
  });
});

test('a title that is short never says it again', async ({ page }) => {
  await open(page, WIN);
  await openPlace(page, 'archive');
  const key = (await listed(page))[0]!;
  await row(page, key).locator('.title').hover();
  await page.waitForTimeout(700);
  await expect(tip(page)).toHaveCount(0);
});

test.describe('Esc and the bubble of the info symbol in the mailbox form', () => {
  const ADDRESS = 'jemand@example.org';

  /** The form with an address typed, and its info symbol. */
  async function openForm(page: Page): Promise<{ form: Locator; info: Locator }> {
    await open(page, `${WIN}&scenario=no-mailbox&view=settings`);
    await (await reveal(page, page.getByTestId('mailbox-connect'))).click();
    const form = page.getByTestId('mailbox-form');
    await page.getByTestId('mailbox-user').fill(ADDRESS);
    // Unfolded, it glides into view once (and a scroll takes every bubble away).
    await animationsDone(page);
    const view = page.getByTestId('view-settings');
    let top: number | null = null;
    await expect
      .poll(async () => {
        const before = top;
        top = await view.evaluate((node) => node.scrollTop);
        return before === top;
      })
      .toBe(true);
    return { form, info: form.getByTestId('info-tip') };
  }

  /** Esc took only the bubble; the next one reaches the form. */
  async function escTakesBubbleFirst(page: Page, form: Locator): Promise<void> {
    await expect(tip(page)).toHaveText(T.settings.passwordInfo.gmail);
    await page.keyboard.press('Escape');
    await expect(tip(page)).toHaveCount(0);
    await animationsDone(page);
    await expect(form).toBeVisible();
    await expect(page.getByTestId('mailbox-user')).toHaveValue(ADDRESS);
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
  }

  test('a bubble a press brought goes alone', async ({ page }) => {
    const { form, info } = await openForm(page);
    await info.click();
    await escTakesBubbleFirst(page, form);
  });

  test('a bubble on the keyboard focus goes alone', async ({ page }) => {
    const { form, info } = await openForm(page);
    await page.keyboard.press('Tab');
    await expect(info).toBeFocused();
    await escTakesBubbleFirst(page, form);
  });

  test('a bubble only under the pointer takes no Esc', async ({ page }) => {
    const { form, info } = await openForm(page);
    await info.hover();
    await expect(tip(page)).toHaveText(T.settings.passwordInfo.gmail);
    await page.keyboard.press('Escape');
    await expect(tip(page)).toHaveCount(0);
    await expect(form).toHaveCount(0);
  });
});
