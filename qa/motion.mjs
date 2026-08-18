/** 把 3 个相隔 0.35s 的帧叠成一张图：可以同时看出「飞行方向」和「朝向」 */
import { chromium } from 'playwright';
const t0 = Number(process.argv[2] || 24);
const b = await chromium.launch({ headless: false, args: ['--window-size=1536,952','--window-position=0,0'] });
const p = await b.newPage({ viewport: { width: 1536, height: 864 } });
await p.goto('http://localhost:5173/?nofs=1&capture=1');
await p.waitForSelector('#entry.is-ready', { timeout: 60000 });
await p.evaluate(() => document.getElementById('entry').click());
await p.waitForTimeout(400);
const shots = [];
for (const dt of [0, 0.35, 0.7]) {
  if (dt === 0) { await p.evaluate((t) => { window.__qixi.seek(t); window.__qixi.resume(); }, t0); }
  await p.waitForTimeout(dt === 0 ? 120 : 350);
  shots.push(await p.evaluate(() => window.__qixi.capture()));
}
await p.evaluate((urls) => {
  document.body.innerHTML = '';
  document.body.style.background = '#000';
  const c = document.createElement('canvas');
  c.width = 1536; c.height = 864;
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
  document.body.appendChild(c);
  const g = c.getContext('2d');
  let done = 0;
  urls.forEach((u, i) => {
    const img = new Image();
    img.onload = () => {
      g.globalAlpha = [0.32, 0.55, 1.0][i];
      g.globalCompositeOperation = 'lighter';
      g.drawImage(img, 0, 0);
      if (++done === urls.length) window.__done = true;
    };
    img.src = u;
  });
}, shots);
await p.waitForFunction('window.__done', null, { timeout: 20000 });
await p.waitForTimeout(200);
await p.screenshot({ path: 'qa/shots/motion.png' });
await b.close();
