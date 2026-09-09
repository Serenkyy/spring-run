/**
 * 「视觉」工具：把角色渲染成高分辨率字符画，方便逐像素检查。
 * 用法: node tools/render-character.mjs [stand|jump|duck|all]
 */
import { chromium } from 'playwright';

const which = process.argv[2] || 'all';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:8123/index.html');
await page.waitForTimeout(900);
await page.click('#btn-start', { noWaitAfter: true });
await page.waitForTimeout(600);

async function shot(mode, runPhase) {
  await page.evaluate(([m, ph]) => {
    const Z = window.__ZIYI__, s = Z.state, T = Z.Core.TUNE;
    Z.setFrozen(true);
    s.obstacles.length = 0; s.pickups.length = 0;
    s.player.x = 10;
    s.player.y = T.GROUND_Y;
    s.player.vy = 0;
    s.player.onGround = m !== 'jump';
    s.player.ducking = m === 'duck';
    s.player.runPhase = ph;
    s.player.invuln = 0;          // 关掉无敌闪烁，看清真正的模型
    if (m === 'jump') { s.player.y = T.GROUND_Y - 14; s.player.onGround = false; }
  }, [mode, runPhase]);
  await page.waitForTimeout(160);
  const out = await page.evaluate(() => {
    const Z = window.__ZIYI__, s = Z.state, v = Z.view;
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    const dpr = c.width / c.getBoundingClientRect().width;
    const u = v.u;
    // 采样区域：角色周围 16 单位宽 × 20 单位高
    const cx = (s.player.x + s.player.w / 2) * u;
    const x0 = Math.round((cx - 8 * u) * dpr);
    const y0 = Math.round((s.player.y - 18) * u * dpr);   // 世界单位 → 像素
    const pw = Math.round(16 * u * dpr);
    const ph = Math.round(20 * u * dpr);
    const d = ctx.getImageData(x0, y0, pw, ph).data;

    const pal = [
      ['s', [255, 217, 194]],   // 皮肤（近）
      ['b', [240, 192, 164]],   // 皮肤（远）
      ['H', [107, 74, 85]],     // 头发
      ['E', [91, 58, 69]],      // 眼睛
      ['p', [255, 143, 184]],   // 裙子 / 蝴蝶结 / 鞋底
      ['d', [255, 182, 209]],   // 裙子亮面
      ['w', [255, 255, 255]],   // 领口 / 鞋
      ['r', [185, 92, 122]]     // 嘴
    ];
    const cols = 64, rows = 40;
    const lines = [];
    for (let ry = 0; ry < rows; ry++) {
      let line = '';
      for (let rx = 0; rx < cols; rx++) {
        const px = Math.floor((rx + 0.5) / cols * pw);
        const py = Math.floor((ry + 0.5) / rows * ph);
        const i = (py * pw + px) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let best = '.', bd = 46;
        for (const [ch, col] of pal) {
          const dd = Math.abs(r - col[0]) + Math.abs(g - col[1]) + Math.abs(b - col[2]);
          if (dd < bd) { bd = dd; best = ch; }
        }
        line += best;
      }
      lines.push(line);
    }
    return { lines, info: { x: s.player.x, y: +s.player.y.toFixed(1), w: s.player.w, h: s.player.h, duck: s.player.ducking, onGround: s.player.onGround, phase: +s.player.runPhase.toFixed(2) } };
  });
  return out;
}

const modes = which === 'all'
  ? [['stand', 0.0], ['stand', 1.57], ['stand', 3.14], ['jump', 0], ['duck', 0]]
  : [[which, 0]];
for (const [m, ph] of modes) {
  const r = await shot(m, ph);
  console.log('===== ' + m + ' runPhase=' + r.info.phase + '  y=' + r.info.y + ' h=' + r.info.h + ' duck=' + r.info.duck + ' =====');
  console.log('   legend: s=skin b=backskin H=hair E=eye p=pink d=lightpink w=white r=mouth .=other');
  r.lines.forEach((l, i) => console.log(String(i).padStart(2, ' ') + '|' + l + '|'));
  console.log('');
}
await browser.close();
