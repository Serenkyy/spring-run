import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:8123/index.html');
await page.waitForTimeout(900);
await page.click('#btn-start', { noWaitAfter: true });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state, T = Z.Core.TUNE;
  Z.setFrozen(true);
  s.obstacles.length = 0; s.pickups.length = 0;
  s.player.x = 10; s.player.y = T.GROUND_Y; s.player.vy = 0;
  s.player.onGround = true; s.player.ducking = false; s.player.runPhase = 0; s.player.invuln = 0;
});
await page.waitForTimeout(200);
const rows = await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state, v = Z.view;
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const dpr = c.width / c.getBoundingClientRect().width;
  const u = v.u;
  const out = [];
  for (const wy of [69.5, 70.0, 70.3, 70.6, 70.9, 71.2, 71.5, 71.8]) {
    let line = 'y=' + wy.toFixed(1) + ' ';
    for (let wx = 11.5; wx <= 17.0; wx += 0.25) {
      const px = Math.round(wx * u * dpr), py = Math.round(wy * u * dpr);
      const d = ctx.getImageData(px, py, 1, 1).data;
      line += d[0] + ',' + d[1] + ',' + d[2] + '  ';
    }
    out.push(line);
  }
  return out;
});
rows.forEach(r => console.log(r));
await browser.close();
