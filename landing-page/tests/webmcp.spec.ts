import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const hostOrigin = 'https://host.example.test';
const assistantOrigin = 'https://assistant.example.test';
const loader = await readFile(new URL('../../reference-server/embed/ozwell-loader.js', import.meta.url), 'utf8');
const widget = await readFile(new URL('../../reference-server/embed/ozwell.js', import.meta.url), 'utf8');

// Use WEBMCP_BROWSER_CHANNEL=chrome to exercise a current native implementation.
// Older Playwright Chromium builds still run the widget sender-validation test.
test.use({
  channel: process.env.WEBMCP_BROWSER_CHANNEL,
  launchOptions: { args: ['--enable-features=WebMCP,WebMCPTesting'] },
});

async function routeFixture(page: Page, withWidget = false) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === hostOrigin) {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <div id="container"></div>
        <script>
          window.messages = [];
          addEventListener('message', event => messages.push(event.data));
        </script>
        ${withWidget ? `<iframe src="${assistantOrigin}/widget/frame/?ozwellLoader=1"></iframe>` : ''}` });
    }
    if (url.pathname === '/widget/ozwell.js') {
      return route.fulfill({ contentType: 'application/javascript', body: widget });
    }
    if (url.pathname === '/widget/frame/') {
      return route.fulfill({ contentType: 'text/html', body: withWidget
        ? '<!doctype html><body><script defer src="/widget/ozwell.js"></script>'
        : '<!doctype html><title>Cross-origin tool caller</title>' });
    }
    return route.abort();
  });
  await page.goto(hostOrigin);
}

test('native WebMCP and postMessage invoke the same host tool across origins', async ({ page }) => {
  await routeFixture(page);
  test.skip(!await page.evaluate(() => typeof (document as any).modelContext?.getTools === 'function'),
    'This browser does not implement the current native WebMCP API');

  await page.evaluate(({ assistantOrigin }) => {
    (window as any).calls = [];
    (window as any).OzwellChatConfig = {
      autoMount: false,
      defaultUI: false,
      widgetUrl: `${assistantOrigin}/widget/frame/`,
      tools: ['read', 'unselected'].map(name => ({
        name, description: `Run ${name}`,
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      })),
      webMCP: { tools: ['read'], exposedTo: [assistantOrigin] },
    };
    document.addEventListener('ozwell-tool-call', (event: any) => {
      (window as any).calls.push(event.detail.name);
      event.detail.respond({ value: event.detail.arguments.value });
    });
  }, { assistantOrigin });
  await page.addScriptTag({ content: loader });
  await page.evaluate(({ assistantOrigin }) => {
    (window as any).OzwellChat.mount();
    // A separate in-page agent opts into native discovery. Ozwell's own iframe
    // keeps its existing postMessage route and needs no WebMCP permission.
    const caller = document.createElement('iframe');
    caller.id = 'native-caller';
    caller.allow = 'tools';
    caller.src = `${assistantOrigin}/widget/frame/?native=1`;
    document.body.appendChild(caller);
  }, { assistantOrigin });
  const frame = (await (await page.locator('iframe').first().elementHandle())!.contentFrame())!;
  await frame.waitForURL(`${assistantOrigin}/widget/frame/?ozwellLoader=1`);
  const nativeFrame = (await (await page.locator('#native-caller').elementHandle())!.contentFrame())!;
  await nativeFrame.waitForURL(`${assistantOrigin}/widget/frame/?native=1`);
  expect(await nativeFrame.evaluate(async () => (
    await (document as any).modelContext.getTools()
  ).map((tool: any) => tool.name))).toEqual([]);

  const discover = () => nativeFrame.evaluate(async host => {
    const tools = await (document as any).modelContext.getTools({ fromOrigins: [host] });
    return tools.map((tool: any) => tool.name);
  }, hostOrigin);
  await expect.poll(discover).toEqual(['read']);
  const nativeResult = await nativeFrame.evaluate(async host => {
    const api = (document as any).modelContext;
    const [tool] = await api.getTools({ fromOrigins: [host] });
    return api.executeTool(tool, { value: 0 });
  }, hostOrigin);
  expect(JSON.parse(nativeResult)).toEqual({ value: 0 });

  const callMcp = (id: number) => frame.evaluate(({ host, id }) => new Promise<any>(resolve => {
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.origin !== host || event.data?.id !== id) return;
      window.removeEventListener('message', receive);
      resolve(event.data);
    };
    window.addEventListener('message', receive);
    parent.postMessage({ jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'postMessage_read', arguments: { value: 0 } } }, host);
  }), { host: hostOrigin, id });
  expect((await callMcp(1)).result).toEqual({ value: 0 });
  expect(await page.evaluate(() => (window as any).calls)).toEqual(['read', 'read']);

  await page.evaluate(() => {
    const caller = document.createElement('iframe');
    caller.id = 'untrusted-caller';
    caller.allow = 'tools';
    caller.src = 'https://untrusted.example.test/widget/frame/';
    document.body.appendChild(caller);
  });
  const untrusted = (await (await page.locator('#untrusted-caller').elementHandle())!.contentFrame())!;
  await untrusted.waitForURL('https://untrusted.example.test/widget/frame/');
  expect(await untrusted.evaluate(async host => (
    await (document as any).modelContext.getTools({ fromOrigins: [host] })
  ).map((tool: any) => tool.name), hostOrigin)).toEqual([]);

  await page.evaluate(() => (window as any).OzwellChat.configure({ webMCP: false }));
  await expect.poll(discover).toEqual([]);
  expect((await callMcp(2)).result).toEqual({ value: 0 });
  expect(await page.evaluate(() => (window as any).calls)).toEqual(['read', 'read', 'read']);
});

test('widget MCP handshake and tools reject other senders and changed parent origins', async ({ page }) => {
  await routeFixture(page, true);
  const frame = (await (await page.locator('iframe').elementHandle())!.contentFrame())!;
  await frame.waitForURL(`${assistantOrigin}/widget/frame/?ozwellLoader=1`);
  await expect.poll(() => page.evaluate(() => (window as any).messages.filter((m: any) => m.method === 'initialize').length)).toBeGreaterThan(0);
  const initId = await page.evaluate(() => (window as any).messages.filter((m: any) => m.method === 'initialize').at(-1).id);
  const initResult = { jsonrpc: '2.0', id: initId, result: { protocolVersion: '2025-11-25' } };

  // A real message sent from the iframe itself has the wrong source.
  await frame.evaluate(({ data, origin }) => {
    window.postMessage(data, location.origin);
    parent.postMessage({ marker: 'untrusted-init' }, origin);
  }, { data: initResult, origin: hostOrigin });
  await expect.poll(() => page.evaluate(() => (window as any).messages.some((m: any) => m.marker === 'untrusted-init'))).toBe(true);
  expect(await page.evaluate(() => (window as any).messages.filter((m: any) => m.method === 'tools/list'))).toEqual([]);

  await page.evaluate(({ data, origin }) => document.querySelector('iframe')!.contentWindow!.postMessage(data, origin),
    { data: initResult, origin: assistantOrigin });
  await expect.poll(() => page.evaluate(() => (window as any).messages.filter((m: any) => m.method === 'tools/list').length)).toBe(1);
  const toolsId = await page.evaluate(() => (window as any).messages.find((m: any) => m.method === 'tools/list').id);
  const toolResult = { jsonrpc: '2.0', id: toolsId, result: { tools: [
    { name: 'postMessage_read', description: 'Read', inputSchema: { type: 'object' } },
  ] } };

  // Model a navigated parent: the WindowProxy is unchanged, its origin differs.
  await frame.evaluate(data => window.dispatchEvent(new MessageEvent('message', {
    source: parent, origin: 'https://untrusted.example.test', data,
  })), toolResult);
  expect(await frame.evaluate(() => (window as any).OzwellDebug.getTools())).toEqual([]);
  await page.evaluate(({ data, origin }) => document.querySelector('iframe')!.contentWindow!.postMessage(data, origin),
    { data: toolResult, origin: assistantOrigin });
  await expect.poll(() => frame.evaluate(() => (window as any).OzwellDebug.getTools().map((tool: any) => tool.function.name)))
    .toEqual(['postMessage_read']);

  await frame.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
    source: parent, origin: 'https://untrusted.example.test',
    data: { source: 'ozwell-chat-parent', type: 'config', payload: { config: { model: 'untrusted-model' } } },
  })));
  expect(await frame.evaluate(() => (window as any).OzwellDebug.getState().config.model)).toBeUndefined();
  expect(await frame.evaluate(() => (window as any).OzwellDebug.getState().parentOrigin)).toBe(hostOrigin);
});
