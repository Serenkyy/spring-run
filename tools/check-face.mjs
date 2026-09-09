import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:8123/index.html');
await page.waitForTimeout(900);
await page.click('#btn-start', { noWaitAfter: true });
await page.waitForTimeout(600);
for (const mood of ['run', 'happy']) {
  await page.evaluate((m) => {
    const Z = window.__ZIYI__, s = Z.state, T = Z.Core.TUNE;
    Z.setFrozen(true);
    s.obstacles.length = 0; s.pickups.length = 0;
    s.player.y = m === 'happy' ? T.GROUND_Y - 12 : T.GROUND_Y;
    s.player.onGround = m !== 'happy'; s.player.ducking = false; s.player.invuln = 0;
    s.player.runPhase = 0;
  }, mood);
  await page.waitForTimeout(200);
  const face = await page.evaluate(() => {
    const Z = window.__ZIYI__, s = Z.state, v = Z.view, T = Z.Core.TUNE;
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    const dpr = c.width / c.getBoundingClientRect().width;
    const u = v.u;
    const x0 = Math.round((s.player.x - 3) * u * dpr);
    const y0 = Math.round((s.player.y - 14) * u * dpr);
    const pw = Math.round((s.player.w + 8) * u * dpr);
    const ph = Math.round(8 * u * dpr);
    const d = ctx.getImageData(x0, y0, pw, ph).data;
    const eyes = [], mouth = [];
    for (let i = 0; i < d.length; i += 4) {
      const p = i / 4, x = p % pw, y = Math.floor(p / pw);
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r < 100 && g < 72 && b < 85) eyes.push([x, y]);
      if (r > 160 && r < 215 && g > 70 && g < 125 && b > 100 && b < 150) mouth.push([x, y]);
    }
    const xs = eyes.map(e => e[0]).sort((a, b) => a - b);
    const clusters = [];
    let run = [], prev = -999;
    for (const x of xs) {
      if (x - prev > 6) { if (run.length >= 6) clusters.push(run); run = []; }
      run.push(x); prev = x;
    }
    if (run.length >= 6) clusters.push(run);
    const avgY = (arr) => arr.length ? arr.reduce((a, p) => a + p[1], 0) / arr.length : -1;
    return { clusters: clusters.length, sizes: clusters.map(c => c.length),
      centers: clusters.map(c => Math.round(c.reduce((a, b) => a + b, 0) / c.length)),
      mouthCount: mouth.length, eyeY: avgY(eyes), mouthY: avgY(mouth) };
  });
  console.log(mood, JSON.stringify(face));
}
await browser.close();
