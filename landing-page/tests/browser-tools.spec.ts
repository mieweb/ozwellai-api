import { expect, test, type Frame, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const hostOrigin = 'https://operations.example.test';
const assistantOrigin = 'https://assistant.example.test';
const publicDirectory = new URL('../public/', import.meta.url);
const loader = await readFile(
  new URL('../../reference-server/embed/ozwell-loader.js', import.meta.url),
  'utf8',
);

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};
type Snapshot = {
  snapshotId: string;
  content: string;
  url: string;
  title: string;
};

// Exercise the checked-in page and built package without an agent key or model.
// Only the remote assistant UI is replaced; messages use the real loader.
async function openDemo(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === '/widget' ||
      url.pathname.endsWith('/ozwell-loader.js')
    ) {
      return route.fulfill({
        contentType: 'application/javascript',
        body: loader,
      });
    }
    if (url.pathname.includes('/widget/frame/')) {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
        <title>Cross-origin assistant fixture</title>
        <script>parent.postMessage({ source: 'ozwell-chat-widget', type: 'ready' }, ${JSON.stringify(hostOrigin)});</script>`,
      });
    }
    if (url.origin !== hostOrigin) return route.abort();

    const filename = url.pathname.replace(/^\/(?:assets\/)?/, '');
    if (!filename || filename.includes('..')) return route.abort();
    let body = await readFile(new URL(filename, publicDirectory));
    if (filename.endsWith('.html')) {
      body = Buffer.from(
        body
          .toString('utf8')
          .replaceAll('__REFERENCE_BASE_URL__', assistantOrigin)
          .replace(/__[A-Z_]*AGENT_KEY__/g, ''),
      );
    }
    const contentType = filename.endsWith('.js')
      ? 'application/javascript'
      : filename.endsWith('.css')
        ? 'text/css'
        : 'text/html';
    return route.fulfill({ contentType, body });
  });
  await page.goto(`${hostOrigin}/browser-tools.html`);
  await expect(page.locator('#controller-status')).toContainText(/ready/i);
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as any).browserToolsDemo?.callTool),
    )
    .toBe('function');
}

async function callTool(
  page: Page,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  return page.evaluate(
    ({ name, args }) => (window as any).browserToolsDemo.callTool(name, args),
    { name, args },
  );
}

async function expandDemoDetails(page: Page) {
  const details = page.locator('#demo-details');
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) {
    await details.locator(':scope > summary').click();
  }
}

function readSnapshot(result: ToolResult): Snapshot {
  expect(result.isError).not.toBe(true);
  expect(result.content[0].type).toBe('text');
  const snapshot = JSON.parse(result.content[0].text);
  expect(snapshot.snapshotId).toBeTruthy();
  expect(snapshot.content).toEqual(expect.any(String));
  return snapshot;
}

async function snapshot(page: Page) {
  return readSnapshot(await callTool(page, 'browser_snapshot'));
}

async function findIndex(
  page: Page,
  selector: string,
  snapshotId: string,
): Promise<number> {
  const index = await page.evaluate(
    ({ selector, snapshotId }) =>
      (window as any).browserToolsDemo.findIndex(selector, snapshotId),
    { selector, snapshotId },
  );
  expect(index).toEqual(expect.any(Number));
  return index;
}

let nextRequestId = 1;
async function callMcp(
  frame: Frame,
  method: string,
  params?: Record<string, unknown>,
): Promise<any> {
  const id = nextRequestId++;
  return frame.evaluate(
    ({ hostOrigin, id, method, params }) =>
      new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener('message', receive);
          reject(new Error(`Timed out waiting for ${method}`));
        }, 5000);
        const receive = (event: MessageEvent) => {
          if (
            event.source !== parent ||
            event.origin !== hostOrigin ||
            event.data?.id !== id
          )
            return;
          window.clearTimeout(timeout);
          window.removeEventListener('message', receive);
          resolve(event.data);
        };
        window.addEventListener('message', receive);
        parent.postMessage(
          { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) },
          hostOrigin,
        );
      }),
    { hostOrigin, id, method, params },
  );
}

test('the scripted workflow persists a work order through the browser tools', async ({
  page,
}) => {
  await openDemo(page);
  await expect(page.locator('#demo-details')).toHaveJSProperty('open', false);
  await expect(page.locator('#run-demo')).toBeVisible();
  await expect(page.locator('#reset-demo')).toBeHidden();
  await page.locator('#run-demo').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = (window as any).browserToolsDemo.getState();
        return state.workOrders.find((order: any) => order.id === 'WO-1042');
      }),
    )
    .toMatchObject({
      owner: 'Maya Chen',
      status: 'In progress',
      notes: 'Dispatch confirmed for the afternoon service window.',
      urgent: true,
    });
  await expect(page.locator('#run-demo')).toBeEnabled();
  await expect(page.locator('#controller-status')).toContainText(
    'WO-1042 saved',
  );
  await expect(page.locator('#save-confirmation')).not.toBeVisible();
  expect(
    await page.evaluate(() => (window as any).browserToolsDemo.getState()),
  ).toMatchObject({
    selectedId: 'WO-1042',
    pendingChanges: null,
    activity: expect.arrayContaining([
      expect.objectContaining({
        workOrderId: 'WO-1042',
        message: expect.stringContaining('Maya Chen, In progress'),
      }),
    ]),
  });
  await expandDemoDetails(page);
  await page.locator('#reset-demo').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).browserToolsDemo
            .getState()
            .workOrders.find((order: any) => order.id === 'WO-1042').notes,
      ),
    )
    .not.toBe('Dispatch confirmed for the afternoon service window.');
});

test('snapshots include only the operations app, excluding the console and assistant', async ({
  page,
}) => {
  await openDemo(page);
  await page.evaluate(() => {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.textContent = 'OUTSIDE_SCOPE_SENTINEL';
    marker.id = 'outside-scope-action';
    document.querySelector('#tool-console')!.append(marker);
  });
  await expandDemoDetails(page);
  await page.locator('#read-page').click();
  await expect(page.locator('#tool-output')).toContainText('snapshotId');
  const state = await snapshot(page);
  expect(state.url).toBe(`${hostOrigin}/browser-tools.html`);
  expect(state.content).toContain('WO-1042');
  expect(state.content).not.toContain('OUTSIDE_SCOPE_SENTINEL');
  expect(state.content).not.toContain('Cross-origin assistant fixture');
  expect(state.content).not.toContain('Run demo');
});

test('a user edit invalidates previously observed element references', async ({
  page,
}) => {
  await openDemo(page);
  const before = await snapshot(page);
  const index = await findIndex(
    page,
    '[data-testid="open-WO-1042"]',
    before.snapshotId,
  );
  const input = page.locator('#work-order-search');
  await input.fill(`${await input.inputValue()} user edit`);
  const result = await callTool(page, 'browser_click', {
    snapshotId: before.snapshotId,
    index,
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/snapshot|stale/i);
  expect((await snapshot(page)).snapshotId).not.toBe(before.snapshotId);
});

test('link actions cannot navigate away from the host page', async ({
  page,
  context,
}) => {
  await openDemo(page);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://navigation.example.test/leaving';
    link.id = 'blocked-navigation';
    link.textContent = 'Forbidden navigation target';
    document.querySelector('#operations-app')!.append(link);
  });
  const before = await snapshot(page);
  const index = await findIndex(page, '#blocked-navigation', before.snapshotId);
  const pageCount = context.pages().length;
  const result = await callTool(page, 'browser_click', {
    snapshotId: before.snapshotId,
    index,
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/navigation|link/i);
  expect(page.url()).toBe(`${hostOrigin}/browser-tools.html`);
  expect(context.pages()).toHaveLength(pageCount);
});

test('the real iframe loader discovers and invokes scoped browser tools across origins', async ({
  page,
}) => {
  await openDemo(page);
  const launcher = page.getByRole('button', { name: 'Open chat', exact: true });
  const chat = page.locator('#ozwell-chat-wrapper');
  await expect(launcher).toBeVisible();
  await expect(chat).toHaveClass(/hidden/);
  await launcher.click();
  await expect(chat).toHaveClass(/visible/);
  await expect(launcher).toBeHidden();
  const iframe = page.locator('#ozwell-chat-container iframe');
  await expect(iframe).toHaveCount(1);
  const frame = (await (await iframe.elementHandle())!.contentFrame())!;
  await expect.poll(() => frame.url()).not.toBe('about:blank');
  expect(new URL(frame.url()).origin).not.toBe(hostOrigin);
  const initialized = await callMcp(frame, 'initialize');
  expect(initialized.result.serverInfo.name).toBe('ozwell-parent');

  const discovery = await callMcp(frame, 'tools/list');
  const tools = discovery.result.tools;
  expect(tools.map((tool: any) => tool.name).sort()).toEqual([
    'postMessage_browser_click',
    'postMessage_browser_fill',
    'postMessage_browser_scroll',
    'postMessage_browser_select',
    'postMessage_browser_snapshot',
  ]);
  await page.getByRole('button', { name: 'Hide chat', exact: true }).click();
  await expect(chat).toHaveClass(/hidden/);
  await expect(launcher).toBeVisible();

  await page.evaluate(() => {
    (window as any).iframeActionCount = 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'iframe-roundtrip-action';
    button.textContent = 'Run iframe roundtrip action';
    button.addEventListener('click', () => {
      (window as any).iframeActionCount += 1;
    });
    document.querySelector('#operations-app')!.append(button);
  });
  const observed = await callMcp(frame, 'tools/call', {
    name: 'postMessage_browser_snapshot',
    arguments: {},
  });
  const before = readSnapshot(observed.result);
  const index = await findIndex(
    page,
    '#iframe-roundtrip-action',
    before.snapshotId,
  );
  const action = await callMcp(frame, 'tools/call', {
    name: 'postMessage_browser_click',
    arguments: { snapshotId: before.snapshotId, index },
  });
  const after = readSnapshot(action.result);
  expect(after.snapshotId).not.toBe(before.snapshotId);
  expect(await page.evaluate(() => (window as any).iframeActionCount)).toBe(1);
});
