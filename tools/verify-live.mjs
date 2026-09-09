import { chromium } from 'playwright';
const URL_ = 'https://serenkyy.github.io/spring-run/';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({
  viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
});
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('requestfailed', r => errs.push('failed: ' + r.url()));

const resp = await page.goto(URL_, { waitUntil: 'load' });
console.log('HTTP', resp.status(), resp.url());
await page.waitForTimeout(1200);

const html = await page.content();
console.log('has new how-to text:', html.includes('所有道具都悬在半空'));
console.log('has character fix:', html.includes('drawShoe'));

const before = await page.evaluate(() => ({
  core: !!window.ZiyiCore, debug: !!window.__ZIYI__,
  title: document.title,
  canvasW: document.getElementById('game').width,
  pickups: window.__ZIYI__ ? window.__ZIYI__.state.pickups.length : -1
}));
console.log('initial:', JSON.stringify(before));

await page.click('#btn-start', { noWaitAfter: true });
await page.waitForTimeout(3000);
const after = await page.evaluate(() => {
  const s = window.__ZIYI__.state;
  return { phase: s.phase, dist: Math.round(s.distance), lvl: s.level, hearts: s.hearts };
});
console.log('after 3s:', JSON.stringify(after));

// 检查道具是否都在空中
const air = await page.evaluate(() => new Promise(res => {
  const Z = window.__ZIYI__, T = Z.Core.TUNE;
  const seen = [];
  const t0 = performance.now();
  const id = setInterval(() => {
    for (const pk of Z.state.pickups) if (!seen.includes(pk)) seen.push(pk);
    if (performance.now() - t0 > 12000 || seen.length >= 6) {
      clearInterval(id);
      res(seen.map(pk => ({ kind: pk.kind, y: +pk.y.toFixed(1) })));
    }
  }, 100);
}));
console.log('pickups seen (y should be < 60):', JSON.stringify(air));

// 站着不动 12 秒：应该一个道具都吃不到
const idle = await page.evaluate(() => new Promise(res => {
  const Z = window.__ZIYI__;
  Z.startRun();
  const start = Z.state.stats.pickups;
  setTimeout(() => res({ collected: Z.state.stats.pickups - start, hearts: Z.state.hearts, phase: Z.state.phase }), 12000);
}));
console.log('idle 12s:', JSON.stringify(idle));

await page.screenshot({ path: '/Users/serenkyy/Developer/playground/shots/10-live.png' });
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
