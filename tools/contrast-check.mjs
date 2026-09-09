import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:8123/index.html');
await page.waitForTimeout(800);
await page.click('#btn-start', { noWaitAfter: true });
await page.waitForTimeout(300);
await page.evaluate(() => { window.__ZIYI__.setFrozen(true); window.__ZIYI__.state.obstacles.length = 0; window.__ZIYI__.state.pickups.length = 0; });

async function sig(rect) {
  return page.evaluate((r) => {
    const c = document.getElementById('game');
    const dpr = c.width / c.getBoundingClientRect().width;
    const off = document.createElement('canvas');
    off.width = 14; off.height = 14;
    const o = off.getContext('2d');
    o.drawImage(c, r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr, 0, 0, 14, 14);
    return Array.from(o.getImageData(0, 0, 14, 14).data);
  }, rect);
}
function cmp(a, b) {
  let max = 0, sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    if (d > max) max = d; sum += d;
  }
  return { max, mean: sum / (a.length / 4) };
}
const u = await page.evaluate(() => window.__ZIYI__.view.u);
console.log('u =', u.toFixed(2), 'px per world unit');
const kinds = await page.evaluate(() => Object.keys(window.__ZIYI__.Core.OBSTACLES));
for (const kind of kinds) {
  const info = await page.evaluate((k) => {
    const s = window.__ZIYI__.state, def = window.__ZIYI__.Core.OBSTACLES[k], T = window.__ZIYI__.Core.TUNE;
    s.obstacles.length = 0;
    const o = { kind: k, x: s.player.x + 2, w: def.w, h: def.h, fly: !!def.fly, y: def.fly ? window.__ZIYI__.Core.FLY_BOTTOM : T.GROUND_Y, hit: false, wobble: 0, passed: false };
    s.obstacles.push(o);
    return { x: o.x, y: o.y, w: o.w, h: o.h };
  }, kind);
  await page.waitForTimeout(80);
  const rect = { x: (info.x - 1) * u, y: (info.y - info.h - 1.5) * u, w: (info.w + 2) * u, h: (info.h + 2) * u };
  const a = await sig(rect);
  await page.evaluate(() => { window.__ZIYI__.state.obstacles.length = 0; });
  await page.waitForTimeout(80);
  const b = await sig(rect);
  const d = cmp(a, b);
  console.log(kind.padEnd(10), 'max=' + d.max.toFixed(0).padStart(3), 'mean=' + d.mean.toFixed(1).padStart(5));
}
for (const kind of ['heart', 'note', 'noodle', 'letter']) {
  const info = await page.evaluate((k) => {
    const s = window.__ZIYI__.state, def = window.__ZIYI__.Core.PICKUPS[k], T = window.__ZIYI__.Core.TUNE;
    s.pickups.length = 0;
    const pk = { kind: k, x: s.player.x + 2, y: T.GROUND_Y, w: def.w, h: def.h, xp: def.xp, ch: 'П', bob: 0, taken: false };
    s.pickups.push(pk);
    return { x: pk.x, y: pk.y, w: pk.w, h: pk.h };
  }, kind);
  await page.waitForTimeout(80);
  const rect = { x: (info.x - 2) * u, y: (info.y - info.h - 3) * u, w: (info.w + 4) * u, h: (info.h + 4) * u };
  const a = await sig(rect);
  await page.evaluate(() => { window.__ZIYI__.state.pickups.length = 0; });
  await page.waitForTimeout(80);
  const b = await sig(rect);
  const d = cmp(a, b);
  console.log(('pick:' + kind).padEnd(10), 'max=' + d.max.toFixed(0).padStart(3), 'mean=' + d.mean.toFixed(1).padStart(5));
}
await browser.close();
