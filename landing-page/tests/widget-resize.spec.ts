import { test, expect, type Page } from '@playwright/test';

// The resize handle lives in the loader's default floating UI (parent document),
// so these tests drive it directly rather than through the widget iframe.

const MIN_WIDTH = 320;
const MIN_HEIGHT = 360;
const SIZE_KEY = 'ozwell.widget.size';

async function openWidget(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as any).OzwellChat !== 'undefined', { timeout: 15000 });
  await page.evaluate((key) => localStorage.removeItem(key), SIZE_KEY);
  await page.locator('#ozwell-chat-button, button:has-text("💬")').click();
  await expect(page.locator('#ozwell-chat-wrapper.visible')).toBeVisible({ timeout: 5000 });
}

function wrapperSize(page: Page) {
  return page.evaluate(() => {
    const w = document.getElementById('ozwell-chat-wrapper')!;
    return { width: w.offsetWidth, height: w.offsetHeight };
  });
}

// Drag the top-left handle by (dx, dy); positive values enlarge the window.
function dragHandle(page: Page, dx: number, dy: number) {
  return page.evaluate(({ dx, dy }) => {
    const wrapper = document.getElementById('ozwell-chat-wrapper')!;
    const handle = wrapper.querySelector('.ozwell-resize-handle') as HTMLElement;
    const b = handle.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx - dx, clientY: cy - dy }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return { width: wrapper.offsetWidth, height: wrapper.offsetHeight };
  }, { dx, dy });
}

test.describe('Widget resize', () => {
  test('drag enlarges the window by the pointer delta', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWidget(page);
    const before = await wrapperSize(page);
    const after = await dragHandle(page, 160, 120);
    expect(after.width).toBe(before.width + 160);
    expect(after.height).toBe(before.height + 120);
  });

  test('drag is clamped to minimum and viewport bounds', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWidget(page);
    // Shrink far past the minimum.
    const small = await dragHandle(page, -1000, -1000);
    expect(small.width).toBe(MIN_WIDTH);
    expect(small.height).toBe(MIN_HEIGHT);
    // Grow far past the viewport.
    const large = await dragHandle(page, 5000, 5000);
    expect(large.width).toBeLessThanOrEqual(1280 - 40);
    expect(large.height).toBeLessThanOrEqual(900 - 48);
  });

  test('size persists across reload and resets on double-tap', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWidget(page);
    const resized = await dragHandle(page, 200, 140);
    const saved = await page.evaluate((key) => localStorage.getItem(key), SIZE_KEY);
    expect(saved).toBe(JSON.stringify(resized));

    // Reload: the saved size is restored.
    await page.reload();
    await page.waitForFunction(() => typeof (window as any).OzwellChat !== 'undefined', { timeout: 15000 });
    await page.locator('#ozwell-chat-button, button:has-text("💬")').click();
    await expect(page.locator('#ozwell-chat-wrapper.visible')).toBeVisible({ timeout: 5000 });
    expect(await wrapperSize(page)).toEqual(resized);

    // Double-tap the handle resets to default and forgets the saved size.
    await page.evaluate(() => {
      const handle = document.querySelector('#ozwell-chat-wrapper .ozwell-resize-handle') as HTMLElement;
      const b = handle.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    expect(await page.evaluate((key) => localStorage.getItem(key), SIZE_KEY)).toBeNull();
    expect(await page.evaluate(() => {
      const w = document.getElementById('ozwell-chat-wrapper')!;
      return { inlineW: w.style.width, inlineH: w.style.height };
    })).toEqual({ inlineW: '', inlineH: '' });
  });

  test('keyboard arrows resize and Home resets', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWidget(page);
    const before = await wrapperSize(page);
    await page.locator('#ozwell-chat-wrapper .ozwell-resize-handle').focus();
    await page.keyboard.press('ArrowLeft'); // wider by 16
    await page.keyboard.press('ArrowUp');   // taller by 16
    const after = await wrapperSize(page);
    expect(after.width).toBe(before.width + 16);
    expect(after.height).toBe(before.height + 16);
    await page.keyboard.press('Home');
    expect(await wrapperSize(page)).toEqual(before);
    expect(await page.evaluate((key) => localStorage.getItem(key), SIZE_KEY)).toBeNull();
  });

  test('mobile keeps the window fullscreen and hides the handle', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openWidget(page);
    await expect(page.locator('#ozwell-chat-wrapper .ozwell-resize-handle')).toBeHidden();
    const size = await wrapperSize(page);
    expect(size.width).toBe(390);
    expect(size.height).toBe(780);
  });

  test('an interrupted pointer stops resizing and restores the iframe', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWidget(page);
    const result = await page.evaluate(() => {
      const wrapper = document.getElementById('ozwell-chat-wrapper')!;
      const handle = wrapper.querySelector('.ozwell-resize-handle') as HTMLElement;
      const b = handle.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx - 100, clientY: cy - 80 }));
      document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
      const afterCancel = wrapper.offsetWidth;
      // A move after cancel must have no effect.
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx - 400, clientY: cy - 300 }));
      const afterStrayMove = wrapper.offsetWidth;
      const iframe = wrapper.querySelector('iframe') as HTMLIFrameElement | null;
      return { afterCancel, afterStrayMove, iframePointerEvents: iframe ? iframe.style.pointerEvents : '' };
    });
    expect(result.afterStrayMove).toBe(result.afterCancel);
    expect(result.iframePointerEvents).toBe('');
  });
});
