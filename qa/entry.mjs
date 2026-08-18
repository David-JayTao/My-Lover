import { chromium } from 'playwright';
const b = await chromium.launch({ headless: false, args: ['--window-size=1536,952','--window-position=0,0'] });
const p = await b.newPage({ viewport: { width: 1536, height: 864 } });
const errs = [];
p.on('console', m => { if (m.type()==='error'||m.type()==='warning') errs.push(`[${m.type()}] ${m.text()}`); });
p.on('pageerror', e => errs.push('[pageerror] '+e.message));
p.on('requestfailed', r => errs.push('[reqfail] '+r.url()));
p.on('response', r => { if (r.status() >= 400) errs.push(`[${r.status()}] ${r.url()}`); });
await p.goto('http://localhost:5173/?nofs=1&capture=1');
await p.waitForFunction('window.__qixi && window.__qixi.CONFIG', null, {timeout: 60000});
await p.waitForTimeout(3000);
// 入口画面（DOM 覆盖在 canvas 上，这里直接截 DOM 即可，canvas 背景很暗）
const url = await p.evaluate(() => window.__qixi.capture());
await p.evaluate((u) => {
  const img = document.createElement('img');
  img.id='__snap'; img.src=u;
  img.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:1;';
  document.body.appendChild(img);
  document.getElementById('stage').style.visibility='hidden';
}, url);
await p.waitForTimeout(200);
await p.screenshot({ path: 'qa/shots/entry.png' });
console.log(errs.length ? [...new Set(errs)].join('\n') : '(clean console)');
await b.close();
