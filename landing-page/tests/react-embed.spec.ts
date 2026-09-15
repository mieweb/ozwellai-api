import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const loader = await readFile(path.join(root, 'reference-server/embed/ozwell-loader.js'), 'utf8');

async function appBundle(widgetUrl?: string) {
  const result = await build({
    stdin: {
      contents: `
        import { StrictMode, useRef, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { OzwellChat } from './packages/react/src/OzwellChat';
        function App() {
          const button = useRef(null);
          const [clicks, setClicks] = useState(0);
          return <>
            <button ref={button} onClick={() => setClicks(value => value + 1)}>Hello World: {clicks}</button>
            <OzwellChat
              widgetUrl={${JSON.stringify(widgetUrl) ?? 'undefined'}}
              apiKey="agnt_key-test"
              tools={[{ type: 'function', function: {
                name: 'click_hello_world', description: 'Click Hello World',
                parameters: { type: 'object', properties: {} }
              } }]}
              onToolCall={(name, args, respond) => {
                if (name === 'click_hello_world') button.current.click();
                respond({ content: [{ type: 'text', text: 'Clicked Hello World' }] });
              }}
              onError={error => { window.embedError = error; }}
            />
          </>;
        }
        createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
      `,
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    alias: {
      react: path.join(root, 'node_modules/react'),
      'react-dom': path.join(root, 'node_modules/react-dom'),
    },
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  return result.outputFiles[0].text;
}

for (const widgetUrl of [undefined, 'https://custom.example/widget/frame/', '/widget/frame/']) {
  test(`React embed loads and executes page tools: ${widgetUrl ?? 'default host'}`, async ({ page }) => {
    const bundle = await appBundle(widgetUrl);
    const host = widgetUrl ? new URL(widgetUrl, 'https://app.example').origin : 'https://ozwellapi.os.mieweb.org';
    const discoveries: string[] = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.href === 'https://app.example/') {
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      }
      if (url.href === `${host}/widget`) {
        return route.fulfill({ contentType: 'application/javascript', body: loader });
      }
      if (url.href === `${host}/v1/agents/me`) {
        discoveries.push(route.request().headers().authorization);
        return route.fulfill({ json: { tools: [] } });
      }
      if (url.href === `${host}/widget/frame/`) {
        return route.fulfill({ contentType: 'text/html', body: `<script>
          window.received = [];
          addEventListener('message', event => received.push(event.data));
          parent.postMessage({ source: 'ozwell-chat-widget', type: 'ready' }, 'https://app.example');
        </script>` });
      }
      return route.abort();
    });
    await page.goto('https://app.example/');
    await page.addScriptTag({ content: bundle });
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(page.locator('iframe')).toHaveJSProperty('src', `${host}/widget/frame/`);
    const frame = (await (await page.locator('iframe').elementHandle())!.contentFrame())!;
    await frame.waitForURL(`${host}/widget/frame/`);
    await expect.poll(() => frame.evaluate(() => (window as any).received.find((message: any) => message.type === 'config')?.payload.config.apiKey)).toBe('agnt_key-test');
    expect(discoveries).toEqual(['Bearer agnt_key-test']);
    await frame.evaluate(() => parent.postMessage({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'postMessage_click_hello_world', arguments: {} },
    }, 'https://app.example'));
    await expect(page.getByRole('button', { name: 'Hello World: 1', exact: true })).toBeVisible();
    await expect.poll(() => frame.evaluate(() => (window as any).received.find((message: any) => message.id === 1)?.result)).toEqual({ content: [{ type: 'text', text: 'Clicked Hello World' }] });
    await expect(page.locator('iframe')).toHaveCount(1);
  });
}

test('React embed reports loader network failures', async ({ page }) => {
  await page.route('https://app.example/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.route('https://ozwellapi.os.mieweb.org/widget', route => route.abort());
  await page.goto('https://app.example/');
  await page.addScriptTag({ content: await appBundle() });
  await expect.poll(() => page.evaluate(() => (window as any).embedError?.code)).toBe('SCRIPT_LOAD_ERROR');
});