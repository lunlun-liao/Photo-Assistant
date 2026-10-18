import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4174';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'pipe' });
  let log = '';
  server.stdout.on('data', data => { log += data; });
  server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(log);
    try { ready = (await fetch(origin)).ok; } catch { /* Wait for the test server. */ }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, `Preview server did not start: ${log}`);
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream'],
  });
});
after(async () => { await browser?.close(); server?.kill(); });

async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  return { page, context, errors };
}

test('composition, JPEG download, persistent gallery, and deletion work in the production build', async () => {
  const { page, context, errors } = await fixture();
  try {
    assert.equal(await page.locator('.subject-option').count(), 3);
    assert.match(await page.locator('.subject-section').innerText(), /範例標註/);
    await page.getByRole('button', { name: '三分構圖', exact: true }).click();
    assert.equal(await page.locator('.composition-option.selected').innerText(), '三分構圖');
    await page.getByLabel('照片比例', { exact: true }).selectOption('1:1');
    await page.getByRole('button', { name: '拍攝照片', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    const size = await page.locator('.shot-preview img').evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
    assert.ok(size.width > 500); assert.equal(size.width, size.height);
    assert.match(await page.locator('.shot-details').innerText(), /三分構圖/);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: '下載照片', exact: true }).click();
    const download = await downloadPromise;
    const bytes = await readFile(await download.path());
    assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    assert.ok(bytes.length > 10000);
    await page.getByRole('button', { name: '繼續探索', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('.nav-count')?.textContent === '01');
    await page.getByRole('button', { name: /我的作品/ }).click();
    assert.equal(await page.locator('.gallery-item').count(), 1);
    await page.locator('.gallery-item').click();
    await page.getByRole('button', { name: '從作品集刪除此照片', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.gallery-item').count(), 0);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('.nav-count').innerText(), '00');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('depth viewpoint changes rendered pixels, comparison restores the source, and capture uses the rendered view', async () => {
  const { page, context, errors } = await fixture();
  try {
    await page.getByRole('button', { name: '視角探索', exact: true }).click();
    await page.waitForSelector('.viewpoint.ready');
    const neutral = await page.locator('.viewpoint canvas').evaluate(canvas => canvas.toDataURL());
    await page.getByRole('slider', { name: '水平虛擬位置', exact: true }).fill('0.75');
    await page.getByRole('slider', { name: '垂直虛擬位置', exact: true }).fill('0.25');
    await page.waitForFunction(before => document.querySelector('.viewpoint canvas')?.toDataURL() !== before, neutral, { timeout: 10000 });
    const shifted = await page.locator('.viewpoint canvas').evaluate(canvas => canvas.toDataURL());
    assert.notEqual(createHash('sha256').update(neutral).digest('hex'), createHash('sha256').update(shifted).digest('hex'));
    await page.getByRole('button', { name: '對照原始畫面', exact: true }).click();
    assert.ok(await page.locator('.reconstruction-layer').evaluate(el => getComputedStyle(el).visibility === 'hidden'));
    await page.getByRole('button', { name: '返回新視角', exact: true }).click();
    await page.getByRole('button', { name: '拍攝照片', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.match(await page.locator('.shot-details').innerText(), /深度重投影預覽/);
    assert.ok(await page.locator('.shot-preview img').evaluate(image => image.naturalWidth > 300));
    await page.getByRole('button', { name: '繼續探索', exact: true }).click();
    await page.getByRole('button', { name: '重設位置', exact: true }).click();
    assert.equal(await page.locator('#horizontal').inputValue(), '0');
    assert.equal(await page.locator('#vertical').inputValue(), '0');
    await page.locator('.viewfinder').scrollIntoViewIfNeeded();
    const bounds = await page.locator('.viewfinder').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 25, { steps: 4 });
    await page.mouse.up();
    assert.ok(Number(await page.locator('#horizontal').inputValue()) < 0, 'Dragging should translate the virtual position');
    assert.ok(Number(await page.locator('#vertical').inputValue()) > 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('photo import and manual subject selection work; AI network denial shows an error without invented detections', async () => {
  const { page, context, errors } = await fixture();
  try {
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#de3421'; ctx.fillRect(0, 0, 640, 480);
      return canvas.toDataURL().split(',')[1];
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'test-photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => document.querySelector('.camera-status')?.textContent.includes('照片工作台'));
    assert.equal(await page.locator('.subject-option').count(), 0);
    await page.locator('.viewfinder').click({ position: { x: 150, y: 150 } });
    assert.match(await page.locator('.subject-option.selected').innerText(), /我的主體/);
    await page.getByRole('button', { name: '拍攝照片', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    const pixel = await page.locator('.shot-preview img').evaluate(image => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    });
    assert.ok(pixel[0] > 200 && pixel[1] < 80, `Expected imported red image, got ${pixel}`);
    await page.getByRole('button', { name: '繼續探索', exact: true }).click();
    let requests = 0;
    await context.route('https://huggingface.co/**', route => { requests++; return route.fulfill({ status: 403, body: 'Model access blocked by test' }); });
    await page.getByRole('button', { name: 'AI 分析畫面', exact: true }).click();
    await page.locator('.ai-error').waitFor({ timeout: 45000 });
    assert.ok(requests > 0, 'The real worker must attempt to load its model');
    assert.match(await page.locator('.ai-error').innerText(), /無法載入|無法執行/);
    assert.equal(await page.locator('.subject-option').count(), 1);
    assert.match(await page.locator('.subject-option').innerText(), /手動選擇/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('camera permission failure preserves the demo; a simulated camera can capture, resume, and release its tracks', async () => {
  const denied = await fixture();
  try {
    await denied.page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await denied.page.getByRole('button', { name: '啟動即時相機', exact: true }).click();
    await denied.page.getByRole('alert').waitFor();
    assert.match(await denied.page.getByRole('alert').innerText(), /相機權限/);
    assert.match(await denied.page.locator('.camera-status').innerText(), /範例體驗/);
    assert.deepEqual(denied.errors, []);
  } finally { await denied.context.close(); }
  const { page, context, errors } = await fixture({ permissions: ['camera'] });
  try {
    await page.getByRole('button', { name: '啟動即時相機', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
    assert.match(await page.locator('.camera-status').innerText(), /即時相機/);
    await page.getByRole('button', { name: /我的作品/ }).click();
    await page.getByRole('button', { name: '拍攝工作台', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
    await page.getByRole('button', { name: '拍攝照片', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.match(await page.locator('.shot-details').innerText(), /原始畫面/);
    assert.ok(await page.locator('.shot-preview img').evaluate(image => image.naturalWidth >= 640));
    await page.getByRole('button', { name: '繼續探索', exact: true }).click();
    await page.evaluate(() => { window.testTracks = document.querySelector('video').srcObject.getTracks(); });
    await page.getByRole('button', { name: '關閉相機', exact: true }).click();
    assert.ok(await page.evaluate(() => window.testTracks.every(track => track.readyState === 'ended')));
    assert.match(await page.locator('.camera-status').innerText(), /範例體驗/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('phone and tablet layouts fit the viewport; help supports keyboard dismissal', async () => {
  const { page, context, errors } = await fixture();
  try {
    for (const width of [360, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`);
      const shutter = await page.getByRole('button', { name: '拍攝照片', exact: true }).boundingBox();
      assert.ok(shutter.width >= 44 && shutter.height >= 44);
    }
    await page.getByRole('button', { name: '開啟使用說明', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /未包含生成式遮擋補全/);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: '開啟使用說明', exact: true }).evaluate(el => document.activeElement === el), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
