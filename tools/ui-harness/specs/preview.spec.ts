// The preview's menu (tools/ui-harness/preview.ts): only in the harness build, never in the
// app; hidden while a spec drives the page unless `?menu` asks for it; an entry opens its
// state.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, open, test } from './fixtures';
import { T, WIN } from './helpers';

const repo = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

/** Every file under a folder. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('the menu shows only when asked for; an entry opens its state', async ({ page }) => {
  await open(page, WIN);
  await expect(page.getByTestId('preview-menu')).toHaveCount(0);
  await open(page, `${WIN}&menu`);
  const menu = page.getByTestId('preview-menu');
  await menu.getByRole('button', { name: 'Vorschau' }).click();
  await menu.getByRole('button', { name: 'Leere Liste' }).click();
  await expect(page).toHaveURL(/scenario=fresh/);
  await expect(page).toHaveURL(/platform=windows/);
  await expect(page.getByTestId('empty-all').locator('h3')).toHaveText(T.list.empty.inbox.heading);
});

test('the app never holds the menu: no import of the harness, nothing of it in the build', () => {
  const source = files(repo('ui/src')).filter((path) => /\.(ts|svelte)$/.test(path));
  expect(source.length).toBeGreaterThan(50);
  for (const path of source) {
    const text = readFileSync(path, 'utf8');
    expect(text.includes('ui-harness') || text.includes('PreviewMenu'), path).toBe(false);
  }
  // The release build, where one was made (`npm run build`).
  const dist = repo('ui/dist');
  if (!existsSync(dist)) return;
  for (const path of files(dist).filter((each) => each.endsWith('.js'))) {
    const text = readFileSync(path, 'utf8');
    expect(text.includes('preview-menu') || text.includes('__harness'), path).toBe(false);
  }
});
