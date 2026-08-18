/** 以录制目标分辨率（1920×1080 drawing buffer）跑完整时间轴，报告帧率分布 */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: false, args: ['--window-size=1536,952','--window-position=0,0','--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1536, height: 864 } });
const errs = [];
p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('[pageerror] '+e.message));
await p.goto('http://localhost:5173/?nofs=1&dpr=1.25');
await p.waitForFunction('window.__qixi && window.__qixi.CONFIG', null, {timeout:60000});
await p.waitForTimeout(2500);
await p.evaluate(() => {
  window.__samples = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    window.__samples.push({ dt: now - last, t: window.__qixi.time });
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  document.getElementById('entry').click();
});
await p.waitForTimeout(36000);
const r = await p.evaluate(() => {
  const s = window.__samples.filter(x => x.t > 0.5);
  const dts = s.map(x => x.dt).sort((a,b)=>a-b);
  const pct = (q) => dts[Math.floor(dts.length*q)];
  // 按场景分段统计
  const seg = (a,b) => {
    const d = s.filter(x=>x.t>=a && x.t<b).map(x=>x.dt);
    if (!d.length) return 'n/a';
    return (1000/(d.reduce((p,c)=>p+c,0)/d.length)).toFixed(1);
  };
  return {
    frames: s.length,
    mean: (1000/(dts.reduce((p,c)=>p+c,0)/dts.length)).toFixed(1),
    p50: (1000/pct(0.5)).toFixed(1),
    p95_worst: (1000/pct(0.95)).toFixed(1),
    max_dt: dts[dts.length-1].toFixed(1),
    segments: { '0-4':seg(0,4), '4-13':seg(4,13), '13-20':seg(13,20), '20-27':seg(20,27), '27-32':seg(27,32), '32-35':seg(32,35) },
    dpr: document.querySelector('canvas').width + 'x' + document.querySelector('canvas').height,
  };
});
console.log(JSON.stringify(r, null, 1));
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await b.close();
