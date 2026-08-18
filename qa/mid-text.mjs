/** 抓字幕入场过程中的一帧，确认逐字浮现的中间状态 */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: false, args: ['--window-size=1536,952','--window-position=0,0'] });
const p = await b.newPage({ viewport: { width: 1536, height: 864 } });
await p.goto('http://localhost:5173/?nofs=1&capture=1');
await p.waitForSelector('#entry.is-ready', {timeout:60000});
await p.evaluate(() => document.getElementById('entry').click());
await p.evaluate(() => window.__qixi.freeze(21.7));   // text2 刚开始入场
await p.waitForTimeout(Number(process.argv[2] || 1000));
const url = await p.evaluate(() => window.__qixi.capture());
await p.evaluate((u) => { const i=document.createElement('img'); i.src=u;
  i.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:1'; document.body.appendChild(i);
  document.getElementById('stage').style.visibility='hidden'; }, url);
await p.waitForTimeout(120);
await p.screenshot({ path: 'qa/shots/mid-text.png' });
await b.close();
