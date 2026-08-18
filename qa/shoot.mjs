/**
 * 视觉 QA：在真实 Chromium（硬件 GPU）中打开作品，按时间轴关键时刻截图。
 *   node qa/shoot.mjs [t1 t2 ...]
 *
 * 说明：headed 模式下直接 page.screenshot 会因为合成器 damage-rect 只截到局部，
 * 因此这里先在渲染同一帧内 canvas.toDataURL 取出精确像素，
 * 再把它塞进一个 <img> 覆盖画布，最后连同 DOM 字幕一起截图。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'shots');
mkdirSync(outDir, { recursive: true });

const times = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const shots = times.length
  ? times
  : [1.0, 3.2, 5.0, 7.0, 9.0, 11.0, 12.9, 14.5, 16.5, 18.0, 20.0, 24.0, 27.0, 28.1, 29.0, 30.5, 32.0, 34.0];

const W = 1536;
const H = 864;

const browser = await chromium.launch({
  headless: false,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-gpu-blocklist',
    `--window-size=${W},${H + 88}`,
    '--window-position=0,0',
  ],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[404?] ${r.url()} ${r.failure()?.errorText || ''}`));

await page.goto('http://localhost:5173/?nofs=1&fps=1&capture=1', { waitUntil: 'load' });
await page.waitForFunction('window.__qixi && window.__qixi.CONFIG', null, { timeout: 60000 });
await page.waitForTimeout(2500);
console.log('GPU:', await page.evaluate(() => window.__qixi.gpu()));
await page.evaluate(() => document.getElementById('entry').click());
await page.waitForTimeout(500);

// 覆盖用的 <img>
await page.evaluate(() => {
  const img = document.createElement('img');
  img.id = '__snap';
  img.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;z-index:5;display:none;';
  document.body.appendChild(img);
});

for (const t of shots) {
  await page.evaluate((tt) => window.__qixi.freeze(tt), t);
  await page.waitForTimeout(t > 15 ? 3500 : 700); // 让 CSS 字幕过渡走完（时间轴已冻结）
  const url = await page.evaluate(() => window.__qixi.capture());
  await page.evaluate((u) => {
    const img = document.getElementById('__snap');
    img.src = u;
    img.style.display = 'block';
    document.getElementById('stage').style.visibility = 'hidden';
  }, url);
  await page.waitForTimeout(120);
  const name = `t${t.toFixed(1).padStart(4, '0')}.png`;
  await page.screenshot({ path: resolve(outDir, name) });
  await page.evaluate(() => {
    document.getElementById('__snap').style.display = 'none';
    document.getElementById('stage').style.visibility = 'visible';
  });
  console.log('shot', name);
}

/* 真实播放帧率（不冻结） */
await page.evaluate(() => {
  window.__qixi.seek(13);
  window.__qixi.resume();
});
await page.waitForTimeout(7000);
console.log('perf:', await page.evaluate(
  () => document.querySelector('div[style*="monospace"]')?.textContent || 'n/a'
));

console.log('\n--- console ---');
console.log(errors.length ? [...new Set(errors)].join('\n') : '(clean)');

await browser.close();
