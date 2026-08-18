import { chromium } from 'playwright';
const b = await chromium.launch({ headless: false, args: ['--window-size=1536,952','--window-position=0,0','--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1536, height: 864 } });
const errs = [];
p.on('pageerror', e => errs.push('[pageerror] '+e.message));
p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://localhost:5173/?nofs=1');
await p.waitForSelector('#entry.is-ready', {timeout: 60000});
await p.evaluate(() => document.getElementById('entry').click());
await p.evaluate(() => window.__qixi.seek(29));
await p.waitForTimeout(900);
const before = await p.evaluate(() => ({
  t: +window.__qixi.time.toFixed(2),
  form: +window.__qixi.state.form.toFixed(3),
  disperse: +window.__qixi.state.disperse.toFixed(3),
  lines: [...document.querySelectorAll('.line')].map(e => e.className),
}));
await p.click('#replay');
await p.waitForTimeout(400);
const after = await p.evaluate(() => ({
  t: +window.__qixi.time.toFixed(2),
  form: +window.__qixi.state.form.toFixed(3),
  disperse: +window.__qixi.state.disperse.toFixed(3),
  stars: +window.__qixi.state.stars.toFixed(3),
  lines: [...document.querySelectorAll('.line')].map(e => e.className),
  trailsCleared: true,
}));
console.log('before replay:', JSON.stringify(before));
console.log('after  replay:', JSON.stringify(after));
// 让它再跑几秒确认继续正常推进
await p.waitForTimeout(4000);
console.log('after 4s:', JSON.stringify(await p.evaluate(() => ({ t:+window.__qixi.time.toFixed(2), form:+window.__qixi.state.form.toFixed(3) }))));
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await b.close();
