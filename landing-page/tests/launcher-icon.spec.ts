import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const loader = await readFile(path.join(root, 'reference-server/embed/ozwell-loader.js'), 'utf8');
const host = 'https://ozwellapi.os.mieweb.org';

async function load(page: Page, config: Record<string, unknown>) {
  const requested: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    requested.push(url.href);
    if (url.href === 'https://app.example/') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<div id="c"></div><script>window.OzwellChatConfig = ${JSON.stringify(config)};</script>
          <script src="${host}/widget"></script>`,
      });
    }
    if (url.href === `${host}/widget`) {
      return route.fulfill({ contentType: 'application/javascript', body: loader });
    }
    if (`${url.origin}${url.pathname}` === `${host}/widget/frame/`) {
      return route.fulfill({ contentType: 'text/html', body: '<html></html>' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://app.example/');
  return requested;
}

test('default launcher uses inline SVG and never requests host favicon', async ({ page }) => {
  const requested = await load(page, {});
  const button = page.locator('#ozwell-chat-button');
  await expect(button).toBeAttached();
  await expect(button.locator('svg.ozwell-chat-icon')).toHaveCount(1);
  await expect(button.locator('img')).toHaveCount(0);
  expect(requested).not.toContain('https://app.example/favicon.ico');
});
