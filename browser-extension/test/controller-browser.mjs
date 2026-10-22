// Regressions against the packaged controller in an actual browser.
// Run with the same Playwright/browser overrides as browser-smoke.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../landing-page/package.json', import.meta.url));
const entry = require.resolve(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { chromium } = await import(pathToFileURL(entry).href);
const bundle = await readFile(new URL('../vendor/page-controller.js', import.meta.url), 'utf8');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : { channel: 'chromium' }),
});
const fixture = `<!doctype html><title>MIE controller fixture</title>
<style>body{font:16px system-ui}button,label{margin:8px}.spacer{height:1200px}</style>
<h1>Visible page heading</h1>
<button type="button" id="mixed">Visible button label
  <span>Visible nested label</span>
  <span style="display:contents">Visible contents label</span>
  <span hidden>hidden-attribute-secret</span>
  <span style="display:none">display-none-secret</span>
  <span style="visibility:hidden">visibility-hidden-secret</span>
  <span style="visibility:collapse">visibility-collapse-secret</span>
  <span style="opacity:0">opacity-zero-secret</span>
  <span style="display:none"><span style="display:inline">hidden-ancestor-secret</span></span>
  <span style="visibility:hidden"><span style="visibility:visible">Visible restored label</span></span>
</button>
<p>Visible paragraph <span style="opacity:0">noninteractive-hidden-secret</span></p>
<label>Owner <select id="owner"><option>Alex visible option</option><option>Sam visible option</option>
  <option hidden>hidden-option-secret</option><option style="display:none">display-none-option-secret</option>
  <optgroup label="Hidden group" hidden><option>hidden-optgroup-secret</option></optgroup>
</select></label>
<div id="hidden-shadow" style="opacity:0"></div>
<script>document.querySelector('#hidden-shadow').attachShadow({mode:'open'}).innerHTML='<button type="button"><span>hidden-shadow-host-secret</span></button>';</script>
<div class="spacer"></div><p>Visible text below viewport</p>`;

async function fixturePage() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.route('https://ui.mieweb.org/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://ui.mieweb.org/controller-regression');
  return page;
}

try {
  await test('controller excludes hidden descendant text while retaining visible semantics', async () => {
    const page = await fixturePage();
    try {
      await page.addScriptTag({ content: bundle });
      const content = await page.evaluate(async () => {
        const controller = new OzwellPageController.PageController({
          rootElement: document.body, enableMask: false,
          highlightOpacity: 0, highlightLabelOpacity: 0,
          viewportExpansion: -1, keepSemanticTags: true, omitAttributes: ['value'],
        });
        return (await controller.getBrowserState()).content;
      });
      for (const secret of ['hidden-attribute-secret', 'display-none-secret', 'visibility-hidden-secret',
        'visibility-collapse-secret', 'opacity-zero-secret', 'hidden-ancestor-secret',
        'noninteractive-hidden-secret', 'hidden-option-secret', 'display-none-option-secret', 'hidden-optgroup-secret', 'hidden-shadow-host-secret']) {
        assert.ok(!content.includes(secret), `Snapshot disclosed ${secret}: ${content}`);
      }
      for (const text of ['Visible page heading', 'Visible button label', 'Visible nested label',
        'Visible contents label', 'Visible restored label', 'Visible paragraph',
        'Alex visible option', 'Sam visible option', 'Visible text below viewport']) {
        assert.ok(content.includes(text), `Snapshot lost ${text}: ${content}`);
      }
    } finally { await page.close(); }
  });

  for (const nativeNavigation of [true, false]) {
    await test(`controller initializes once per document (${nativeNavigation ? 'Navigation API' : 'interval fallback'})`, async () => {
      const page = await fixturePage();
      try {
        await page.evaluate(nativeNavigation => {
          if (!nativeNavigation) Object.defineProperty(window, 'navigation', { configurable: true, value: undefined });
          window.controllerEffects = { listeners: [], intervals: [] };
          const add = EventTarget.prototype.addEventListener;
          EventTarget.prototype.addEventListener = function (type, ...args) {
            if (this === window && ['popstate', 'hashchange', 'beforeunload'].includes(type)) controllerEffects.listeners.push(`window:${type}`);
            if (window.navigation && this === window.navigation && type === 'navigate') controllerEffects.listeners.push('navigation:navigate');
            return add.call(this, type, ...args);
          };
          const interval = window.setInterval;
          window.setInterval = function (handler, delay, ...args) {
            controllerEffects.intervals.push(delay);
            return interval.call(this, handler, delay, ...args);
          };
        }, nativeNavigation);
        await page.addScriptTag({ content: bundle });
        const first = await page.evaluate(() => {
          window.initialControllerExport = OzwellPageController;
          return structuredClone(controllerEffects);
        });
        assert.equal(first.listeners.length, nativeNavigation ? 4 : 3, 'Instrumentation must observe the initial upstream lifecycle hooks.');
        assert.deepEqual(first.intervals, nativeNavigation ? [] : [500]);
        for (let repetition = 0; repetition < 5; repetition++) await page.addScriptTag({ content: bundle });
        const repeated = await page.evaluate(() => ({
          ...structuredClone(controllerEffects),
          sameExport: initialControllerExport === OzwellPageController,
          sameConstructor: initialControllerExport.PageController === OzwellPageController.PageController,
          frozen: Object.isFrozen(OzwellPageController),
        }));
        assert.deepEqual(repeated.listeners, first.listeners, 'Repeated injection registered more document listeners.');
        assert.deepEqual(repeated.intervals, first.intervals, 'Repeated injection scheduled more polling intervals.');
        assert.equal(repeated.sameExport, true);
        assert.equal(repeated.sameConstructor, true);
        assert.equal(repeated.frozen, true);
      } finally { await page.close(); }
    });
  }
} finally { await browser.close(); }
