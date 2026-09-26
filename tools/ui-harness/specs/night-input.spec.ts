// The press that ends the OS autoscroll ends only the autoscroll: it presses nothing,
// whichever button it is, like the native scrolling of Windows.

import { expect, open, test } from './fixtures';

test('the click that ends the autoscroll presses nothing; a dragged middle press leaves no mode', async ({
  page,
  browserName,
}) => {
  // The autoscroll is Windows' (WebView2, a Chromium): WebKit has none to end.
  test.skip(browserName === 'webkit', 'no autoscroll in WebKit');
  await open(page, '?platform=windows&scenario=many');
  const archive = page.getByTestId('place-archive');
  const list = (await page.getByTestId('job-list').boundingBox())!;
  const inList = { x: list.x + list.width / 2, y: list.y + list.height / 2 };
  // A middle click in the list: the autoscroll runs until the next press.
  await page.mouse.move(inList.x, inList.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await archive.click();
  await expect(archive).not.toHaveAttribute('aria-selected', 'true');
  // The next click is an ordinary one again.
  await archive.click();
  await expect(archive).toHaveAttribute('aria-selected', 'true');
  // Held and dragged, the middle button scrolled while held: no mode is left.
  const inbox = page.getByTestId('place-inbox');
  await page.mouse.move(inList.x, inList.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(inList.x, inList.y + 60, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await inbox.click();
  await expect(inbox).toHaveAttribute('aria-selected', 'true');
});
