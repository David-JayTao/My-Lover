/** A/B 性能探针（含预热 + 重复 baseline，排除集显升频带来的顺序偏差） */
import { chromium } from 'playwright';
const cases = [
  ['baseline#1', () => {}],
  ['no-butterflies', () => { window.__qixi.layer('butterflies', false); window.__qixi.layer('trail', false); }],
  ['no-trail-only', () => { window.__qixi.layer('trail', false); }],
  ['baseline#2', () => {}],
  ['no-DOM-text', () => document.getElementById('cinema').remove()],
  ['no-bloom', () => window.__qixi.bloom(false)],
  ['heart=40k', () => {}, 'heart=40000'],
  ['baseline#3', () => {}],
];
const b = await chromium.launch({ headless: false, args: ['--window-size=1536,952','--window-position=0,0','--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: 1536, height: 864 } });
// 预热 GPU
await page.goto('http://localhost:5173/?nofs=1&dpr=1.25');
await page.waitForSelector('#entry.is-ready', { timeout: 60000 });
await page.evaluate(() => { document.getElementById('entry').click(); window.__qixi.CONFIG.quality.adaptive = false; window.__qixi.seek(22); });
await page.waitForTimeout(6000);
await page.close();

for (const [name, fn, extra] of cases) {
  const p = await b.newPage({ viewport: { width: 1536, height: 864 } });
  await p.goto('http://localhost:5173/?nofs=1&dpr=1.25' + (extra ? '&' + extra : ''));
  await p.waitForSelector('#entry.is-ready', { timeout: 60000 });
  await p.evaluate(() => { document.getElementById('entry').click(); window.__qixi.CONFIG.quality.adaptive = false; });
  await p.evaluate(fn);
  await p.evaluate(() => window.__qixi.seek(22));
  await p.waitForTimeout(2500);            // 预热本页
  await p.evaluate(() => {
    window.__qixi.seek(22);
    window.__s = []; let last = performance.now();
    const tick = () => { const n = performance.now(); window.__s.push(n - last); last = n; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await p.waitForTimeout(4000);
  const r = await p.evaluate(() => {
    const d = window.__s.slice(10).sort((x, y) => x - y);
    const avg = d.reduce((a, c) => a + c, 0) / d.length;
    return { fps: +(1000 / avg).toFixed(1), p95: +(1000 / d[Math.floor(d.length * 0.95)]).toFixed(1) };
  });
  console.log(name.padEnd(16), JSON.stringify(r));
  await p.close();
}
await b.close();
