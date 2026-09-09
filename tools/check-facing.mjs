import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:8123/index.html');
await page.waitForTimeout(800);
await page.click('#btn-start', { noWaitAfter: true });
await page.waitForTimeout(300);
const res = await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state, v = Z.view;
  Z.setFrozen(true);
  s.obstacles.length = 0; s.pickups.length = 0;
  s.player.y = Z.Core.TUNE.GROUND_Y; s.player.vy = 0; s.player.onGround = true; s.player.ducking = false;
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const dpr = c.width / c.getBoundingClientRect().width;
  const u = v.u;
  const cx = (s.player.x + s.player.w / 2) * u;
  // 对称取样：以角色中心为分界线
  const halfW = 6 * u;
  const x0 = Math.round((cx - halfW) * dpr);
  const y0 = Math.round((s.player.y - 12.6) * u * dpr);
  const pw = Math.round(halfW * 2 * dpr);
  const ph = Math.round(5.4 * u * dpr);
  const d = ctx.getImageData(x0, y0, pw, ph).data;
  const split = pw / 2;
  let hairL = 0, hairR = 0, skinL = 0, skinR = 0, hairMinX = 1e9, hairMaxX = -1e9, skinMinX = 1e9, skinMaxX = -1e9;
  for (let i = 0; i < d.length; i += 4) {
    const x = (i / 4) % pw;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r < 150 && g < 110 && b < 125) { if (x < split) hairL++; else hairR++; if (x < hairMinX) hairMinX = x; if (x > hairMaxX) hairMaxX = x; }
    if (r > 235 && g > 190 && b > 150 && r - b > 25) { if (x < split) skinL++; else skinR++; if (x < skinMinX) skinMinX = x; if (x > skinMaxX) skinMaxX = x; }
  }
  const toU = (x) => ((x - split) / dpr / u).toFixed(1);
  return {
    hairL, hairR, skinL, skinR,
    hairRange: [toU(hairMinX), toU(hairMaxX)],
    skinRange: [toU(skinMinX), toU(skinMaxX)]
  };
});
console.log(JSON.stringify(res, null, 1));
console.log('hair 左/右 =', (res.hairL / Math.max(1, res.hairR)).toFixed(2), ' skin 右/左 =', (res.skinR / Math.max(1, res.skinL)).toFixed(2));
await page.screenshot({ path: '/Users/serenkyy/Developer/playground/shots/09-character.png', clip: { x: 20, y: 470, width: 200, height: 230 } });
await browser.close();
