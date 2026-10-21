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

test.setTimeout(60_000);

const maskSelector = '#page-agent-runtime_simulator-mask';
const highlightSelector = '[data-demo-highlight]';
const savedNotes = 'Dispatch confirmed for the afternoon service window.';

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
  if (
    !(await details.evaluate((element: HTMLDetailsElement) => element.open))
  ) {
    await details.locator(':scope > summary').click();
  }
}

async function beginToolCall(
  page: Page,
  name: string,
  args: Record<string, unknown>,
) {
  await page.evaluate(
    ({ name, args }) => {
      (window as any).pendingBrowserToolCall = (
        window as any
      ).browserToolsDemo.callTool(name, args);
    },
    { name, args },
  );
}

async function finishToolCall(page: Page): Promise<ToolResult> {
  return page.evaluate(() => (window as any).pendingBrowserToolCall);
}

async function expectOverlaysReleased(page: Page) {
  await expect(page.locator(maskSelector)).toBeHidden();
  await expect(page.locator(highlightSelector)).toBeHidden();
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
  await expect(page.locator('#visual-mode')).toHaveValue('mask');
  await page.locator('#run-demo').click();
  await expect(page.locator(maskSelector)).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = (window as any).browserToolsDemo.getState();
          return state.workOrders.find((order: any) => order.id === 'WO-1042');
        }),
      { timeout: 30_000 },
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
  await expectOverlaysReleased(page);
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

for (const mode of ['mask', 'highlight', 'both', 'none']) {
  test(`live tool actions use the ${mode} display mode and exclude visuals from their snapshots`, async ({
    page,
  }) => {
    await openDemo(page);
    await expandDemoDetails(page);
    await page.locator('#run-speed').selectOption('slow');
    if (mode === 'mask') {
      await expect(page.locator('#visual-mode')).toHaveValue('mask');
    } else {
      await page.locator('#visual-mode').selectOption(mode);
    }
    await expectOverlaysReleased(page);
    const before = await snapshot(page);
    const index = await findIndex(
      page,
      '[data-testid="open-WO-1042"]',
      before.snapshotId,
    );

    // Record all visible transitions, including accidental flashes in None mode.
    await page.evaluate(
      ({ maskSelector, highlightSelector }) => {
        const seen = new Set<string>();
        const observe = () => {
          for (const [name, selector] of [
            ['mask', maskSelector],
            ['highlight', highlightSelector],
          ]) {
            const element = document.querySelector(selector);
            if (element?.checkVisibility({ checkVisibilityCSS: true }))
              seen.add(name);
          }
        };
        const observer = new MutationObserver(observe);
        observer.observe(document.body, {
          subtree: true,
          attributes: true,
          childList: true,
        });
        document.addEventListener('toggle', observe, true);
        (window as any).finishOverlayObservation = () => {
          observer.disconnect();
          document.removeEventListener('toggle', observe, true);
          return [...seen].sort();
        };
      },
      { maskSelector, highlightSelector },
    );

    await beginToolCall(page, 'browser_click', {
      snapshotId: before.snapshotId,
      index,
    });
    if (mode === 'mask' || mode === 'both') {
      await expect(page.locator(maskSelector)).toBeVisible();
    }
    if (mode === 'highlight' || mode === 'both') {
      const highlight = page.locator(highlightSelector);
      await expect(highlight).toBeVisible();
      await expect(highlight).toContainText(/click/i);
      await expect(highlight).toContainText('WO-1042');
    }
    if (mode !== 'none') {
      const visibleOverlay = page.locator(
        mode === 'mask' ? maskSelector : highlightSelector,
      );
      expect(
        await visibleOverlay.evaluate(
          (element) =>
            !document.querySelector('#operations-app')!.contains(element),
        ),
      ).toBe(true);
      await visibleOverlay.evaluate((element) => {
        const marker = document.createElement('span');
        marker.textContent = 'VISUAL_OVERLAY_SENTINEL';
        element.append(marker);
      });
    }
    const after = readSnapshot(await finishToolCall(page));
    expect(after.snapshotId).not.toBe(before.snapshotId);
    expect(after.content).not.toContain('VISUAL_OVERLAY_SENTINEL');
    expect(after.content).not.toContain('page-agent-runtime_simulator-mask');
    expect(after.content).not.toContain('data-demo-highlight');
    expect(
      await page.evaluate(
        () => (window as any).browserToolsDemo.getState().selectedId,
      ),
    ).toBe('WO-1042');
    const seen = await page.evaluate(() =>
      (window as any).finishOverlayObservation(),
    );
    expect(seen).toEqual(
      mode === 'both' ? ['highlight', 'mask'] : mode === 'none' ? [] : [mode],
    );
    await expectOverlaysReleased(page);
  });
}

test('step mode performs one action at a time, refreshes after manual edits, and releases overlays between steps', async ({
  page,
}) => {
  await openDemo(page);
  await page.locator('#visual-mode').selectOption('both');
  const step = page.locator('#step-demo');
  await expect(step).toHaveText('Step through');

  for (let number = 1; number <= 7; number += 1) {
    await page
      .locator(number === 7 ? '#dialog-next-action' : '#step-demo')
      .click();
    if (number === 1) {
      await expect(page.locator(maskSelector)).toBeVisible();
      await expect(page.locator(highlightSelector)).toBeVisible();
    }
    await expect(step).toBeEnabled({ timeout: 15_000 });
    await expect(page.locator('#demo-step-status')).toContainText(
      new RegExp(`\\b${number}\\s*/\\s*7\\b`),
    );
    await expectOverlaysReleased(page);
    await expect(step).toHaveText(
      number === 7 ? 'Step through' : 'Next action',
    );
    const state = await page.evaluate(() =>
      (window as any).browserToolsDemo.getState(),
    );
    expect(state.selectedId).toBe('WO-1042');
    if (number === 1) {
      expect(state.draft.owner).toBe('Unassigned');
      await page
        .locator('#work-order-notes')
        .fill('Inspected manually between steps.');
    } else if (number === 2) {
      expect(state.draft).toMatchObject({
        owner: 'Maya Chen',
        status: 'New',
        notes: 'Inspected manually between steps.',
      });
    } else if (number === 3) {
      expect(state.draft).toMatchObject({
        status: 'In progress',
        notes: 'Inspected manually between steps.',
      });
    } else if (number === 4) {
      expect(state.draft).toMatchObject({ notes: savedNotes, urgent: false });
    } else if (number === 5) {
      expect(state.draft.urgent).toBe(true);
      expect(state.pendingChanges).toBeNull();
    } else if (number === 6) {
      expect(state.pendingChanges).toMatchObject({
        workOrderId: 'WO-1042',
        owner: 'Maya Chen',
        notes: savedNotes,
      });
      await expect(page.locator('#save-confirmation')).toBeVisible();
      await expect(page.locator('#dialog-next-action')).toBeVisible();
    } else {
      expect(state.pendingChanges).toBeNull();
      expect(
        state.workOrders.find((order: any) => order.id === 'WO-1042'),
      ).toMatchObject({
        owner: 'Maya Chen',
        status: 'In progress',
        notes: savedNotes,
        urgent: true,
      });
      await expect(page.locator('#save-confirmation')).toBeHidden();
    }
  }
});

test('a rejected action releases both visual layers and leaves the page usable', async ({
  page,
}) => {
  await openDemo(page);
  await page.locator('#visual-mode').selectOption('both');
  await expandDemoDetails(page);
  await page.locator('#run-speed').selectOption('slow');
  const before = await snapshot(page);
  const index = await findIndex(page, '#work-order-status', before.snapshotId);
  const originalStatus = await page.locator('#work-order-status').inputValue();
  await beginToolCall(page, 'browser_select', {
    snapshotId: before.snapshotId,
    index,
    value: 'Status that is not an available option',
  });
  await expect(page.locator(maskSelector)).toBeVisible();
  await expect(page.locator(highlightSelector)).toBeVisible();
  const result = await finishToolCall(page);
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/option|select/i);
  await expectOverlaysReleased(page);
  await expect(page.locator('#work-order-status')).toHaveValue(originalStatus);
  await page
    .locator('#work-order-notes')
    .fill('Manual editing works after the rejected action.');
  await expect(page.locator('#work-order-notes')).toHaveValue(
    'Manual editing works after the rejected action.',
  );
});

test('aborting a visual preview leaves the work order unchanged and releases both overlays', async ({
  page,
}) => {
  await openDemo(page);
  await page.locator('#visual-mode').selectOption('both');
  await expandDemoDetails(page);
  await page.locator('#run-speed').selectOption('slow');
  const initialState = await page.evaluate(() =>
    (window as any).browserToolsDemo.getState(),
  );
  const before = await snapshot(page);
  const index = await findIndex(
    page,
    '[data-testid="open-WO-1042"]',
    before.snapshotId,
  );

  await page.evaluate(
    ({ snapshotId, index }) => {
      const controller = new AbortController();
      (window as any).browserToolAbortController = controller;
      (window as any).pendingBrowserToolCall = (
        window as any
      ).browserToolsDemo.callTool(
        'browser_click',
        { snapshotId, index },
        { signal: controller.signal },
      );
    },
    { snapshotId: before.snapshotId, index },
  );
  await expect(page.locator(maskSelector)).toBeVisible();
  await expect(page.locator(highlightSelector)).toBeVisible();
  await page.evaluate(() => (window as any).browserToolAbortController.abort());

  const result = await finishToolCall(page);
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/aborted/i);
  expect(
    await page.evaluate(() => (window as any).browserToolsDemo.getState()),
  ).toEqual(initialState);
  await expectOverlaysReleased(page);
});

test('an aborted queued request cannot mutate the page after the preceding action succeeds', async ({
  page,
}) => {
  await openDemo(page);
  await page.locator('#visual-mode').selectOption('both');
  await expandDemoDetails(page);
  await page.locator('#run-speed').selectOption('slow');
  const initialState = await page.evaluate(() =>
    (window as any).browserToolsDemo.getState(),
  );
  const before = await snapshot(page);
  const clickIndex = await findIndex(
    page,
    '[data-testid="open-WO-1042"]',
    before.snapshotId,
  );
  const fillIndex = await findIndex(
    page,
    '#work-order-notes',
    before.snapshotId,
  );

  // Queue both requests together. The successful selection expires this token;
  // cancellation must win before the second request validates or uses it.
  await page.evaluate(
    ({ snapshotId, clickIndex, fillIndex }) => {
      const api = (window as any).browserToolsDemo;
      const controller = new AbortController();
      (window as any).pendingBrowserToolCall = api.callTool('browser_click', {
        snapshotId,
        index: clickIndex,
      });
      (window as any).pendingAbortedBrowserToolCall = api.callTool(
        'browser_fill',
        {
          snapshotId,
          index: fillIndex,
          value: 'An aborted queued request must never enter these notes.',
        },
        { signal: controller.signal },
      );
      controller.abort();
    },
    { snapshotId: before.snapshotId, clickIndex, fillIndex },
  );
  await expect(page.locator(maskSelector)).toBeVisible();
  await expect(page.locator(highlightSelector)).toBeVisible();
  const after = readSnapshot(await finishToolCall(page));
  expect(after.snapshotId).not.toBe(before.snapshotId);
  const cancelled: ToolResult = await page.evaluate(
    () => (window as any).pendingAbortedBrowserToolCall,
  );
  expect(cancelled.isError).toBe(true);
  expect(cancelled.content[0].text).toMatch(/aborted/i);
  expect(cancelled.content[0].text).not.toMatch(/stale|expired/i);

  const state = await page.evaluate(() =>
    (window as any).browserToolsDemo.getState(),
  );
  const selected = initialState.workOrders.find(
    (order: any) => order.id === 'WO-1042',
  );
  expect(state.selectedId).toBe('WO-1042');
  expect(state.workOrders).toEqual(initialState.workOrders);
  expect(state.activity).toEqual(initialState.activity);
  expect(state.pendingChanges).toBeNull();
  expect(state.draft).toEqual({
    owner: selected.owner,
    status: selected.status,
    notes: selected.notes,
    urgent: selected.urgent,
  });
  await expectOverlaysReleased(page);
});

test('reset and a cancelled confirmation both restart the step runner safely', async ({
  page,
}) => {
  await openDemo(page);
  await page.locator('#visual-mode').selectOption('none');
  const step = page.locator('#step-demo');
  await step.click();
  await expect(step).toBeEnabled({ timeout: 15_000 });
  await expect(step).toHaveText('Next action');
  await expandDemoDetails(page);
  await page.locator('#reset-demo').click();
  await expect(step).toHaveText('Step through');
  expect(
    await page.evaluate(
      () => (window as any).browserToolsDemo.getState().selectedId,
    ),
  ).toBe('WO-1038');

  for (let number = 1; number <= 6; number += 1) {
    await step.click();
    await expect(step).toBeEnabled({ timeout: 15_000 });
    await expect(page.locator('#demo-step-status')).toContainText(
      new RegExp(`\\b${number}\\s*/\\s*7\\b`),
    );
  }
  await expect(page.locator('#save-confirmation')).toBeVisible();
  await page.locator('#cancel-save').click();
  await step.click();
  await expect(step).toBeEnabled({ timeout: 15_000 });
  await expect(step).toHaveText('Step through');
  await expect(page.locator('#controller-status')).toContainText(
    /No indexed element|not found|missing/i,
  );
  await expectOverlaysReleased(page);
  const state = await page.evaluate(() =>
    (window as any).browserToolsDemo.getState(),
  );
  expect(state.pendingChanges).toBeNull();
  expect(
    state.workOrders.find((order: any) => order.id === 'WO-1042').owner,
  ).toBe('Unassigned');
  await step.click();
  await expect(step).toBeEnabled({ timeout: 15_000 });
  await expect(step).toHaveText('Next action');
  await expect(page.locator('#demo-step-status')).toContainText(
    /\b1\s*\/\s*7\b/,
  );
});
