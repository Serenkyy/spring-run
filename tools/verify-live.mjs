import { chromium } from 'playwright';
const URL_ = 'https://serenkyy.github.io/spring-run/';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.click('#btn-start', { noWaitAfter: true });
await page.waitForTimeout(700);
const res = await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state, v = Z.view, T = Z.Core.TUNE;
  Z.setFrozen(true);
  s.obstacles.length = 0; s.pickups.length = 0;
  s.player.y = T.GROUND_Y; s.player.vy = 0; s.player.onGround = true;
  s.player.ducking = false; s.player.invuln = 0; s.player.runPhase = 1.57;
  return { letterChance: T.LETTER_CHANCE, active: T.LETTER_CHANCE_ACTIVE };
});
await page.waitForTimeout(220);
const shoe = await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state, v = Z.view, T = Z.Core.TUNE;
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const dpr = c.width / c.getBoundingClientRect().width;
  const u = v.u;
  const x0 = Math.round((s.player.x - 3) * u * dpr);
  const y0 = Math.round((T.GROUND_Y - 4.5) * u * dpr);
  const pw = Math.round((s.player.w + 6) * u * dpr);
  const ph = Math.round(4 * u * dpr);
  const d = ctx.getImageData(x0, y0, pw, ph).data;
  let white = 0, skin = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 244 && g > 244 && b > 244) white++;
    if (r > 245 && g > 205 && g < 230 && b > 180 && b < 210) skin++;
  }
  return { white, skin };
});
console.log('deployed LETTER_CHANCE =', res.letterChance, '/ active =', res.active);
console.log('feet pixels: white(shoe) =', shoe.white, ' skin(legs) =', shoe.skin);
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await page.screenshot({ path: '/Users/serenkyy/Developer/playground/shots/11-live-character.png' });
await browser.close();
