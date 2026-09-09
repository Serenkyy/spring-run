import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:8123/index.html');
await page.waitForTimeout(700);
await page.click('#btn-start', { noWaitAfter: true });
await page.waitForTimeout(300);
await page.evaluate(() => {
  const Z = window.__ZIYI__, Core = Z.Core, T = Core.TUNE;
  let jumpHoldUntil = -1, duckUntil = -1;
  window.__ai = setInterval(() => {
    const s = Z.state, p = s.player, speed = s.speed, inp = Z.input;
    if (s.phase !== 'playing') { inp.jump = false; inp.duck = false; return; }
    let duck = s.t < duckUntil, threat = null;
    for (const o of s.obstacles) { if (o.x + o.w < p.x - 0.5) continue; if (!threat || o.x < threat.x) threat = o; }
    let pressed = false;
    if (threat) {
      const ttr = (threat.x - (p.x + p.w)) / speed;
      if (threat.fly) { if (!p.onGround) duck = true; else if (ttr < 0.16) { duck = true; duckUntil = s.t + (threat.w + p.w + 3) / speed + 0.06; } }
      else if (p.onGround && !duck) {
        const overlap = (Math.max(0, threat.w - 1.2) + (T.PLAYER_W - 1.2)) / speed;
        const trigger = T.JUMP_V / T.GRAVITY - overlap / 2;
        if (ttr <= trigger && ttr > -overlap) { pressed = true; jumpHoldUntil = s.t + 0.45; }
      }
    }
    inp.jump = s.t < jumpHoldUntil;
    if (pressed) inp.jumpPressed = true;
    inp.duck = duck;
  }, 16);
  window.__frames = 0;
  const origRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) { window.__frames++; return origRAF(cb); };
});
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => {
    const s = window.__ZIYI__.state;
    return { t: +s.t.toFixed(1), dist: Math.round(s.distance), lvl: s.level, hearts: s.hearts, phase: s.phase, obs: s.obstacles.length, frames: window.__frames, frozen: window.__ZIYI__.isFrozen() };
  });
  console.log(JSON.stringify(st));
}
console.log('errors:', errs.slice(0, 5));
await browser.close();
