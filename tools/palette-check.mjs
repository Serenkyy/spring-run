import { chromium } from 'playwright';
const shots = ['01-start.png', '02-levelup.png', '04-longrun.png', '05-gameover.png', '06-landscape.png'];
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage();
for (const s of shots) {
  const url = 'http://127.0.0.1:8123/shots/' + s;
  const res = await page.goto(url).catch(() => null);
  if (!res || !res.ok()) { console.log(s, 'MISSING'); continue; }
  const data = await page.evaluate(() => {
    const img = document.querySelector('img');
    const c = document.createElement('canvas');
    c.width = 220; c.height = Math.round(220 * img.naturalHeight / img.naturalWidth);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map();
    let L = 0, S = 0, n = 0, pastel = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = (mx + mn) / 2;
      const s2 = mx === mn ? 0 : (l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn));
      L += l; S += s2; n++;
      if (l > 0.62 && s2 < 0.6) pastel++;
      if (l < 0.35) dark++;
      const key = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, v]) => {
        const [rr, gg, bb] = k.split(',').map(x => parseInt(x) * 16 + 8);
        const hex = '#' + [rr, gg, bb].map(x => x.toString(16).padStart(2, '0')).join('');
        return hex + ' ' + (v / n * 100).toFixed(0) + '%';
      });
    return { top, avgL: L / n, avgS: S / n, pastelPct: pastel / n * 100, darkPct: dark / n * 100, w: img.naturalWidth, h: img.naturalHeight };
  });
  console.log(s.padEnd(20), data.w + 'x' + data.h, 'avgL=' + data.avgL.toFixed(2), 'avgS=' + data.avgS.toFixed(2),
    'pastel=' + data.pastelPct.toFixed(0) + '%', 'dark=' + data.darkPct.toFixed(1) + '%');
  console.log('   top:', data.top.join('  '));
}
await browser.close();
