/**
 * 真浏览器端到端验证（Playwright + Chromium，模拟 iPhone 16 Pro Max）。
 * 运行： node tools/verify.mjs [url]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const SHOTS = path.join(root, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let failures = 0;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const DEVICE = {
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
};

const browser = await chromium.launch({
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage(DEVICE);

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));

/* ---------------- 工具 ---------------- */

const hasClass = (sel, cls) => page.evaluate(([s, c]) => {
  const el = document.querySelector(s);
  return !!el && el.classList.contains(c);
}, [sel, cls]);

const rectOf = (sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, sel);

async function regionStats(rect) {
  return page.evaluate((r) => {
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    const dpr = c.width / c.getBoundingClientRect().width;
    const x = Math.max(0, Math.round(r.x * dpr));
    const y = Math.max(0, Math.round(r.y * dpr));
    const w = Math.min(c.width - x, Math.round(r.w * dpr));
    const h = Math.min(c.height - y, Math.round(r.h * dpr));
    if (w <= 0 || h <= 0) return null;
    const d = ctx.getImageData(x, y, w, h).data;
    let R = 0, G = 0, B = 0, n = 0;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) {
      R += d[i]; G += d[i + 1]; B += d[i + 2]; n++;
      if (n % 7 === 0) colors.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3));
    }
    return { r: R / n, g: G / n, b: B / n, distinct: colors.size, px: n };
  }, rect);
}

function diff(a, b) {
  if (!a || !b) return 0;
  return (Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)) / 3;
}

/* 把一块区域缩成 14x14 的"指纹"，用来判断某个物体到底有没有被画出来 */
async function signature(rect) {
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

function maxCellDiff(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    if (d > max) max = d;
  }
  return max;
}

const state = () => page.evaluate(() => {
  const s = window.__ZIYI__.state;
  return {
    phase: s.phase, level: s.level, distance: s.distance, score: s.score,
    hearts: s.hearts, speed: s.speed, xp: s.xp, xpToNext: s.xpToNext,
    playerY: s.player.y, playerX: s.player.x, obstacles: s.obstacles.length,
    pickups: s.pickups.length, worldW: s.world.w, worldH: s.world.h
  };
});

/* ---------------- 1. 加载 ---------------- */

console.log('\n[1] 加载与首屏');
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(900);
check('页面无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | '));
check('canvas 存在且尺寸正确',
  await page.evaluate(() => {
    const c = document.getElementById('game');
    return c.width === Math.round(440 * Math.min(devicePixelRatio, 2)) && c.height > 0;
  }));
check('开始界面可见', await page.isVisible('#screen-start'));
check('标题正确', (await page.textContent('.title')).trim() === '自怡向前冲');
check('开始界面有鼓励语', (await page.textContent('#start-greeting')).trim().length > 3,
  (await page.textContent('#start-greeting')).trim());

const sky = await regionStats({ x: 30, y: 40, w: 380, h: 140 });
check('天空是粉色调', sky && sky.r > 235 && sky.g > 215 && sky.b > 225 && sky.r >= sky.g && sky.b > sky.g,
  sky ? 'avg rgb(' + sky.r.toFixed(0) + ',' + sky.g.toFixed(0) + ',' + sky.b.toFixed(0) + ')' : 'null');

const ground = await regionStats({ x: 30, y: 780, w: 380, h: 90 });
check('地面是薄荷绿', ground && ground.g > ground.r && ground.g > ground.b,
  ground ? 'avg rgb(' + ground.r.toFixed(0) + ',' + ground.g.toFixed(0) + ',' + ground.b.toFixed(0) + ')' : 'null');

check('没有滚动条',
  await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1));

await page.screenshot({ path: path.join(SHOTS, '01-start.png') });

/* ---------------- 2. 开始游戏 ---------------- */

console.log('\n[2] 开始游戏与触控');
await page.click('#btn-start', { noWaitAfter: true });
await page.waitForTimeout(400);
check('开始界面已隐藏', !(await hasClass('#screen-start', 'show')));
check('进入 playing 状态', (await state()).phase === 'playing');
check('蹲按钮已显示', await hasClass('#btn-duck', 'show'));

const duckBox = await rectOf('#btn-duck');
check('蹲按钮在右下角且尺寸够大',
  duckBox && duckBox.x > 440 * 0.6 && duckBox.y > 956 * 0.6 && duckBox.width >= 76 && duckBox.height >= 76,
  duckBox ? JSON.stringify({ x: Math.round(duckBox.x), y: Math.round(duckBox.y), w: Math.round(duckBox.width) }) : 'null');

const beforeJump = (await state()).playerY;
await page.touchscreen.tap(220, 500);
let apexY = beforeJump;
for (let i = 0; i < 22; i++) {
  await page.waitForTimeout(20);
  const y = (await state()).playerY;
  if (y < apexY) apexY = y;
}
check('点屏幕可以跳起来（快速点击也是满跳）', beforeJump - apexY > 18,
  '离地 ' + (beforeJump - apexY).toFixed(1) + ' 单位');

await page.waitForTimeout(1200);
const st2 = await state();
check('距离在增加', st2.distance > 10, st2.distance.toFixed(0) + ' 米');
check('HUD 距离同步', (await page.textContent('#hud-dist')).includes('米'));

/* ---------------- 3. 障碍物渲染 ---------------- */

console.log('\n[3] 每种障碍物的绘制');
await page.evaluate(() => { window.__ZIYI__.setFrozen(true); });
await page.evaluate(() => {
  const s = window.__ZIYI__.state;
  s.obstacles.length = 0;
  s.pickups.length = 0;
});
await page.waitForTimeout(120);

const kinds = await page.evaluate(() => Object.keys(window.__ZIYI__.Core.OBSTACLES));
const u = await page.evaluate(() => window.__ZIYI__.view.u);

for (const kind of kinds) {
  const info = await page.evaluate((k) => {
    const s = window.__ZIYI__.state;
    const def = window.__ZIYI__.Core.OBSTACLES[k];
    s.obstacles.length = 0;
    const o = {
      kind: k, x: s.player.x + 2, w: def.w, h: def.h, fly: !!def.fly,
      y: def.fly ? window.__ZIYI__.Core.FLY_BOTTOM : window.__ZIYI__.Core.TUNE.GROUND_Y,
      hit: false, wobble: 0, passed: false
    };
    s.obstacles.push(o);
    return { x: o.x, y: o.y, w: o.w, h: o.h };
  }, kind);
  await page.waitForTimeout(90);
  const rect = { x: (info.x - 1) * u, y: (info.y - info.h - 1.5) * u, w: (info.w + 2) * u, h: (info.h + 2) * u };
  const withObs = await signature(rect);
  await page.evaluate(() => { window.__ZIYI__.state.obstacles.length = 0; });
  await page.waitForTimeout(90);
  const without = await signature(rect);
  const mc = maxCellDiff(withObs, without);
  check('障碍物 ' + kind + ' 画出来了，而且看得清', mc >= 35, '对比度 ' + mc.toFixed(0) + '/255');
}

/* 道具 */
for (const kind of ['heart', 'note', 'noodle', 'letter']) {
  const info = await page.evaluate((k) => {
    const s = window.__ZIYI__.state;
    s.pickups.length = 0;
    const def = window.__ZIYI__.Core.PICKUPS[k];
    const pk = { kind: k, x: s.player.x + 2, y: window.__ZIYI__.Core.TUNE.GROUND_Y, w: def.w, h: def.h, xp: def.xp, ch: 'П', bob: 0, taken: false };
    s.pickups.push(pk);
    return { x: pk.x, y: pk.y, w: pk.w, h: pk.h };
  }, kind);
  await page.waitForTimeout(90);
  const rect = { x: (info.x - 2) * u, y: (info.y - info.h - 3) * u, w: (info.w + 4) * u, h: (info.h + 4) * u };
  const withP = await signature(rect);
  await page.evaluate(() => { window.__ZIYI__.state.pickups.length = 0; });
  await page.waitForTimeout(90);
  const without = await signature(rect);
  const mc = maxCellDiff(withP, without);
  check('道具 ' + kind + ' 画出来了', mc >= 30, '对比度 ' + mc.toFixed(0) + '/255');
}

/* ---------------- 3b. 角色绘制 ---------------- */
console.log('\n[3b] 角色与 HUD 位置');
const pInfo = await page.evaluate(() => {
  const s = window.__ZIYI__.state, v = window.__ZIYI__.view;
  s.obstacles.length = 0; s.pickups.length = 0;
  return { x: s.player.x, y: s.player.y, w: s.player.w, h: s.player.h, u: v.u };
});
await page.waitForTimeout(120);
const pRect = { x: (pInfo.x - 2) * pInfo.u, y: (pInfo.y - pInfo.h - 2) * pInfo.u, w: (pInfo.w + 4) * pInfo.u, h: (pInfo.h + 4) * pInfo.u };
const withPlayer = await regionStats(pRect);
const playerDistinct = withPlayer ? withPlayer.distinct : 0;
check('角色被绘制出来（颜色足够丰富）', playerDistinct > 25, 'distinct=' + playerDistinct);
check('角色在屏幕内', pRect.x > 0 && pRect.x + pRect.w < 440 && pRect.y > 0 && pRect.y + pRect.h < 956,
  JSON.stringify({ x: Math.round(pRect.x), y: Math.round(pRect.y) }));

const hudRects = await page.evaluate(() => {
  const sels = ['.hud-level-box', '.hud-stats', '#word-bar', '#hud-hearts', '#btn-mute'];
  return sels.map(s => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { s, x: r.x, y: r.y, w: r.width, h: r.height, op: parseFloat(getComputedStyle(e).opacity) };
  }).filter(Boolean);
});
const playerRect = { x: pRect.x, y: pRect.y, w: pRect.w, h: pRect.h };
const overlap = hudRects.filter(r => r.op > 0.1 &&
  !(r.x + r.w < playerRect.x || r.x > playerRect.x + playerRect.w ||
    r.y + r.h < playerRect.y || r.y > playerRect.y + playerRect.h));
check('HUD 不遮挡角色', overlap.length === 0,
  overlap.length ? '遮挡元素: ' + overlap.map(r => r.s).join(',') : '角色 (' + Math.round(pRect.x) + ',' + Math.round(pRect.y) + ')，HUD 最底 ' + Math.round(Math.max(...hudRects.filter(r => r.op > 0.1).map(r => r.y + r.h))));

/* ---------------- 3c. 朝向（必须朝右跑） ---------------- */
await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state;
  Z.setFrozen(true);
  s.obstacles.length = 0;
  s.pickups.length = 0;
  s.player.y = Z.Core.TUNE.GROUND_Y;
  s.player.vy = 0;
  s.player.onGround = true;
  s.player.ducking = false;
  s.player.runPhase = 0.9;
});
await page.waitForTimeout(200);        // 等画面按新状态重绘后再取样
const facing = await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state, v = Z.view;
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const dpr = c.width / c.getBoundingClientRect().width;
  const u = v.u;
  const cx = (s.player.x + s.player.w / 2) * u;
  const halfW = 6 * u;                       // 以角色中心对称取样
  const x0 = Math.round((cx - halfW) * dpr);
  const y0 = Math.round((s.player.y - 12.6) * u * dpr);
  const pw = Math.round(halfW * 2 * dpr);
  const ph = Math.round(5.4 * u * dpr);
  const d = ctx.getImageData(x0, y0, pw, ph).data;
  const split = pw / 2;
  let hairL = 0, hairR = 0, skinL = 0, skinR = 0;
  let hairMin = 1e9, hairMax = -1e9, skinMin = 1e9, skinMax = -1e9;
  for (let i = 0; i < d.length; i += 4) {
    const x = (i / 4) % pw;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r < 150 && g < 110 && b < 125) {
      if (x < split) hairL++; else hairR++;
      if (x < hairMin) hairMin = x; if (x > hairMax) hairMax = x;
    }
    // 肤色：偏暖（g > b），和粉色背景 / 樱花树冠（g < b）区分开
    if (r > 235 && g > 185 && b < 215 && (g - b) > 10) {
      if (x < split) skinL++; else skinR++;
      if (x < skinMin) skinMin = x; if (x > skinMax) skinMax = x;
    }
  }
  const toU = (x) => (x - split) / dpr / u;
  return {
    hairL, hairR, skinL, skinR,
    hairMin: toU(hairMin), hairMax: toU(hairMax),
    skinMin: toU(skinMin), skinMax: toU(skinMax)
  };
});
const fmt = (f) => 'hair[' + f.hairMin.toFixed(1) + ',' + f.hairMax.toFixed(1) + '] skin[' +
  f.skinMin.toFixed(1) + ',' + f.skinMax.toFixed(1) + '] hairL/R=' + (f.hairL / Math.max(1, f.hairR)).toFixed(2);
const shoes = await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state, v = Z.view, T = Z.Core.TUNE;
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const dpr = c.width / c.getBoundingClientRect().width;
  const u = v.u;
  const x0 = Math.round((s.player.x - 2) * u * dpr);
  const y0 = Math.round((T.GROUND_Y - 4) * u * dpr);
  const pw = Math.round((s.player.w + 4) * u * dpr);
  const ph = Math.round(3.5 * u * dpr);
  const d = ctx.getImageData(x0, y0, pw, ph).data;
  let white = 0, pink = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 244 && g > 244 && b > 244) white++;
    if (r > 240 && g > 120 && g < 170 && b > 165 && b < 205) pink++;
  }
  return { white, pink };
});
check('脚上真的有白色跑鞋（函数重名 bug 的回归测试）', shoes.white > 25, JSON.stringify(shoes));

/* 脸：必须有两只眼睛，而且嘴要在眼睛下面（用户报过：没有左眼、微笑长在鼻子上） */
const face = await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state, v = Z.view, T = Z.Core.TUNE;
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const dpr = c.width / c.getBoundingClientRect().width;
  const u = v.u;
  const x0 = Math.round((s.player.x - 3) * u * dpr);
  const y0 = Math.round((T.GROUND_Y - 14) * u * dpr);
  const pw = Math.round((s.player.w + 8) * u * dpr);
  const ph = Math.round(8 * u * dpr);
  const d = ctx.getImageData(x0, y0, pw, ph).data;
  const eyes = [], mouth = [];
  for (let i = 0; i < d.length; i += 4) {
    const p = i / 4, x = p % pw, y = Math.floor(p / pw);
    const r = d[i], g = d[i + 1], b = d[i + 2];
    // 眼睛 #5B3A45 (91,58,69) —— 要比头发 #6B4A55 (107,74,85) 更深
    if (r < 100 && g < 72 && b < 85) eyes.push([x, y]);
    // 嘴 #B95C7A：中等饱和的粉红
    if (r > 160 && r < 215 && g > 70 && g < 125 && b > 100 && b < 150) mouth.push([x, y]);
  }
  const xs = eyes.map(e => e[0]).sort((a, b) => a - b);
  let clusters = 0, run = 0, prev = -999;
  for (const x of xs) {
    if (x - prev > 6) { if (run >= 8) clusters++; run = 0; }
    run++; prev = x;
  }
  if (run >= 8) clusters++;
  const avgY = (arr) => arr.length ? arr.reduce((a, p) => a + p[1], 0) / arr.length : -1;
  return { clusters, eyeCount: eyes.length, mouthCount: mouth.length, eyeY: avgY(eyes), mouthY: avgY(mouth), ph };
});
check('脸上有两只分开的眼睛（左眼别再丢了）', face.clusters >= 2 && face.eyeCount > 40,
  'cluster=' + face.clusters + ' eyes=' + face.eyeCount);
check('嘴在眼睛下面（微笑不在鼻子上）', face.mouthCount > 10 && face.mouthY > face.eyeY + 4,
  'eyeY=' + face.eyeY.toFixed(1) + ' mouthY=' + face.mouthY.toFixed(1) + ' mouthPx=' + face.mouthCount);

check('马尾在身后（比脸更靠左）→ 朝右跑', facing.hairMin < facing.skinMin - 1.5, fmt(facing));
check('脸/鼻子在前进方向（不比头发更靠左）', facing.skinMax > facing.hairMax - 0.5 && facing.skinR > facing.skinL,
  fmt(facing));

/* ---------------- 4. 碰撞与下蹲 ---------------- */

console.log('\n[4] 碰撞判定');
const duckOK = await page.evaluate(async () => {
  const Z = window.__ZIYI__, Core = Z.Core, s = Z.state;
  s.obstacles.length = 0; s.pickups.length = 0;
  s.player.invuln = 0;
  const hearts0 = s.hearts;
  // 站立 → 应该撞到空中障碍
  s.obstacles.push({ kind: 'note', x: s.player.x, w: 5.6, h: 5.2, fly: true, y: Core.FLY_BOTTOM, hit: false, wobble: 0, passed: false });
  Core.step(s, 1 / 60, {});
  const hitStanding = s.hearts < hearts0;
  // 下蹲 → 应该安全通过
  s.obstacles.length = 0;
  s.player.invuln = 0;
  const hearts1 = s.hearts;
  s.obstacles.push({ kind: 'note', x: s.player.x, w: 5.6, h: 5.2, fly: true, y: Core.FLY_BOTTOM, hit: false, wobble: 0, passed: false });
  Core.step(s, 1 / 60, { duck: true });
  const hitDucking = s.hearts < hearts1;
  s.obstacles.length = 0;
  return { hitStanding, hitDucking };
});
check('站着会撞到空中障碍', duckOK.hitStanding);
check('下蹲能钻过空中障碍', !duckOK.hitDucking);

/* ---------------- 5. 升级 / 鼓励语 / 进度 ---------------- */

console.log('\n[5] 升级与鼓励语');
await page.evaluate(() => {
  const Z = window.__ZIYI__;
  Z.setFrozen(false);
  Z.state.obstacles.length = 0;
  Z.state.pickups.length = 0;
  Z.state.events.length = 0;
  Z.state.player.invuln = 999;
});
await page.waitForTimeout(120);
await page.evaluate(() => {
  const Z = window.__ZIYI__;
  Z.Core.addXp(Z.state, Z.state.xpToNext);
});
await page.waitForTimeout(220);
const bannerText = await page.textContent('#banner');
const bannerVisible = await page.evaluate(() => document.getElementById('banner').classList.contains('show'));
check('升级横幅出现', bannerVisible && bannerText.includes('第 2 关'), bannerText.slice(0, 40));
check('横幅里有鼓励语', bannerText.length > 8);
check('HUD 等级已更新', (await page.textContent('#hud-level')) === 'Lv.2');
check('关卡名已更新', (await page.textContent('#hud-level-title')).length > 0, await page.textContent('#hud-level-title'));
await page.screenshot({ path: path.join(SHOTS, '02-levelup.png') });

await page.evaluate(() => {
  const Z = window.__ZIYI__;
  Z.showWordCard('ПРИВЕТ', '你好', '拼出来啦！');
});
await page.waitForTimeout(400);
check('俄语单词卡显示', await hasClass('#word-card', 'show'));
await page.screenshot({ path: path.join(SHOTS, '03-wordcard.png') });

/* ---------------- 6. 长时间运行 + AI 驾驶 ---------------- */

console.log('\n[6] 长时间运行（AI 驾驶 10 秒）');
await page.evaluate(() => {
  const Z = window.__ZIYI__;
  Z.setFrozen(false);
  Z.startRun();
});
await page.evaluate(() => {
  // 页面内的「完美玩家」AI，和 Node 测试用的是同一套策略
  const Z = window.__ZIYI__, Core = Z.Core, T = Core.TUNE;
  let jumpHoldUntil = -1, duckUntil = -1;
  window.__ai = setInterval(() => {
    const s = Z.state, p = s.player, speed = s.speed, inp = Z.input;
    if (s.phase !== 'playing') { inp.jump = false; inp.duck = false; return; }
    let duck = s.t < duckUntil;
    let threat = null;
    for (const o of s.obstacles) {
      if (o.x + o.w < p.x - 0.5) continue;
      if (!threat || o.x < threat.x) threat = o;
    }
    let pressed = false;
    if (threat) {
      const ttr = (threat.x - (p.x + p.w)) / speed;
      if (threat.fly) {
        if (!p.onGround) duck = true;
        else if (ttr < 0.16) { duck = true; duckUntil = s.t + (threat.w + p.w + 3) / speed + 0.06; }
      } else if (p.onGround && !duck) {
        const overlap = (Math.max(0, threat.w - 1.2) + (T.PLAYER_W - 1.2)) / speed;
        const tApex = T.JUMP_V / T.GRAVITY;
        const trigger = tApex - overlap / 2;
        if (ttr <= trigger && ttr > -overlap) { pressed = true; jumpHoldUntil = s.t + 0.45; }
      }
    }
    inp.jump = s.t < jumpHoldUntil;
    if (pressed) inp.jumpPressed = true;
    inp.duck = duck;
  }, 16);
});

for (let sec = 0; sec < 10; sec++) {
  await page.waitForTimeout(1000);
  if (sec % 2 === 1) {
    const d = await page.evaluate(() => ({
      t: +window.__ZIYI__.state.t.toFixed(2),
      dist: Math.round(window.__ZIYI__.state.distance),
      lvl: window.__ZIYI__.state.level,
      hp: window.__ZIYI__.state.hearts,
      phase: window.__ZIYI__.state.phase,
      frozen: window.__ZIYI__.isFrozen(),
      hidden: document.hidden,
      vis: document.visibilityState
    }));
    console.log('    诊断 ' + (sec + 1) + 's: ' + JSON.stringify(d));
  }
}
const longRun = await state();
await page.evaluate(() => clearInterval(window.__ai));
check('AI 长跑没有报错', errors.length === 0, errors.slice(0, 2).join(' | '));
check('AI 跑出了距离', longRun.distance > 250, longRun.distance.toFixed(0) + ' 米');
check('AI 升级了', longRun.level >= 2, 'Lv.' + longRun.level);
check('没有掉血（完美操作）', longRun.hearts === 3, 'hearts=' + longRun.hearts);
await page.screenshot({ path: path.join(SHOTS, '04-longrun.png') });

/* ---------------- 6b. 高关卡渲染 ---------------- */
console.log('\n[6b] 高关卡（Lv.15）渲染与运行');
await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state;
  s.level = 15;
  s.speed = Z.Core.speedForLevel(15);
  s.xpToNext = Z.Core.xpForLevel(15);
  s.player.invuln = 999;
  window.__ai2 = setInterval(() => {
    const Z2 = window.__ZIYI__, Core = Z2.Core, T = Core.TUNE, s2 = Z2.state, p = s2.player, speed = s2.speed, inp = Z2.input;
    if (s2.phase !== 'playing') { inp.jump = false; inp.duck = false; return; }
    let threat = null;
    for (const o of s2.obstacles) { if (o.x + o.w < p.x - 0.5) continue; if (!threat || o.x < threat.x) threat = o; }
    let duck = false, pressed = false;
    if (threat) {
      const ttr = (threat.x - (p.x + p.w)) / speed;
      if (threat.fly) duck = ttr < 0.16 || !p.onGround;
      else if (p.onGround) {
        const overlap = (Math.max(0, threat.w - 1.2) + (T.PLAYER_W - 1.2)) / speed;
        const trigger = T.JUMP_V / T.GRAVITY - overlap / 2;
        if (ttr <= trigger && ttr > -overlap) { pressed = true; window.__hold = s2.t + 0.45; }
      }
    }
    inp.jump = s2.t < (window.__hold || 0);
    if (pressed) inp.jumpPressed = true;
    inp.duck = duck;
  }, 16);
});
await page.waitForTimeout(9000);
await page.evaluate(() => clearInterval(window.__ai2));
const highRun = await state();
check('高关卡仍在运行且无报错', highRun.phase === 'playing' && errors.length === 0,
  'Lv.' + highRun.level + ' speed=' + highRun.speed.toFixed(1));
await page.screenshot({ path: path.join(SHOTS, '04b-highlevel.png') });

/* ---------------- 7. 结束流程 ---------------- */

console.log('\n[7] 结束与存档');
await page.evaluate(() => {
  const Z = window.__ZIYI__, s = Z.state, T = Z.Core.TUNE;
  // 清掉 AI 残留的输入和跳跃缓冲，否则她会原地起跳躲开这个障碍
  Z.input.jump = false; Z.input.jumpPressed = false; Z.input.duck = false;
  s.obstacles.length = 0;
  s.pickups.length = 0;
  s.player.y = T.GROUND_Y; s.player.vy = 0; s.player.onGround = true;
  s.player.ducking = false; s.player.buffer = 0; s.player.coyote = 0;
  s.hearts = 1;
  s.player.invuln = 0;
  s.obstacles.push({ kind: 'piano', x: s.player.x + 0.5, y: T.GROUND_Y, w: 8.4, h: 9.5, fly: false, hit: false, wobble: 0, passed: false });
});
await page.waitForTimeout(900);
check('游戏结束界面出现', await hasClass('#screen-over', 'show'));
const overStats = await page.textContent('#over-stats');
check('结算面板有数据', overStats.includes('分数') && overStats.includes('米'));
check('结束语存在', (await page.textContent('#over-msg')).length > 3, await page.textContent('#over-msg'));
const saved = await page.evaluate(() => localStorage.getItem('ziyi-run-v1'));
check('成绩已写入 localStorage', !!saved && JSON.parse(saved).best >= 0, saved ? saved.slice(0, 80) : 'null');
await page.screenshot({ path: path.join(SHOTS, '05-gameover.png') });

await page.click('#btn-again', { noWaitAfter: true });
await page.waitForTimeout(500);
check('可以重新开始', (await state()).phase === 'playing' && !(await hasClass('#screen-over', 'show')));

/* ---------------- 8. 横屏 ---------------- */

console.log('\n[8] 横屏适配');
await page.setViewportSize({ width: 956, height: 440 });
await page.waitForTimeout(600);
const land = await state();
check('横屏世界宽度自适应', land.worldW > 150, 'worldW=' + land.worldW.toFixed(0));
check('横屏仍在运行', land.phase === 'playing');
await page.screenshot({ path: path.join(SHOTS, '06-landscape.png') });

/* ---------------- 9. 帧率与音频 ---------------- */

console.log('\n[9] 帧率与音频');
await page.setViewportSize({ width: 440, height: 956 });
await page.waitForTimeout(400);
const fps = await page.evaluate(() => new Promise(resolve => {
  let frames = 0;
  const t0 = performance.now();
  function tick() {
    frames++;
    if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
    else resolve(frames / ((performance.now() - t0) / 1000));
  }
  requestAnimationFrame(tick);
}));
check('帧率可用（headless 软件渲染下 > 20fps）', fps > 20, fps.toFixed(1) + ' fps');

const audio = await page.evaluate(() => window.__ZIYI__.audio());
check('WebAudio 已初始化', audio.hasContext && (audio.state === 'running' || audio.state === 'suspended'),
  JSON.stringify(audio));
check('音频未静音（默认开声音）', audio.muted === false && audio.music === true);

await page.evaluate(() => document.getElementById('btn-mute').click());
await page.waitForTimeout(150);
const muted = await page.evaluate(() => window.__ZIYI__.audio());
check('静音按钮生效', muted.muted === true, JSON.stringify(muted));
await page.evaluate(() => document.getElementById('btn-mute').click());

/* ---------------- 10. 单文件版 ---------------- */

console.log('\n[10] 单文件版 ziyi-run.html');
const singlePath = path.join(root, 'ziyi-run.html');
if (fs.existsSync(singlePath)) {
  const p2 = await browser.newPage(DEVICE);
  const err2 = [];
  p2.on('console', m => { if (m.type() === 'error') err2.push(m.text()); });
  p2.on('pageerror', e => err2.push(e.message));
  await p2.goto('file://' + singlePath, { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  const singleOk = await p2.evaluate(() => ({
    title: document.title,
    hasCore: !!window.ZiyiCore,
    hasDebug: !!window.__ZIYI__,
    canvasW: document.getElementById('game').width,
    sky: (() => {
      const c = document.getElementById('game');
      const d = c.getContext('2d').getImageData(Math.round(c.width / 2), Math.round(c.height * 0.1), 1, 1).data;
      return [d[0], d[1], d[2]];
    })()
  }));
  check('单文件版能直接打开（file://）', singleOk.hasCore && singleOk.hasDebug && singleOk.canvasW > 0,
    JSON.stringify(singleOk));
  check('单文件版没有外部请求错误', err2.length === 0, err2.slice(0, 2).join(' | '));
  check('单文件版背景已绘制', singleOk.sky[0] > 230 && singleOk.sky[1] > 200, 'rgb(' + singleOk.sky.join(',') + ')');
  await p2.screenshot({ path: path.join(SHOTS, '07-singlefile.png') });
  await p2.close();
} else {
  console.log('  (跳过：ziyi-run.html 还没生成，先跑 node tools/build.mjs)');
}

/* ---------------- 11. 小屏幕 ---------------- */

console.log('\n[11] 小屏幕（iPhone SE 375x667）');
await page.setViewportSize({ width: 375, height: 667 });
await page.waitForTimeout(600);
const small = await page.evaluate(() => {
  const c = document.getElementById('game');
  const duck = document.getElementById('btn-duck').getBoundingClientRect();
  const start = document.getElementById('screen-start');
  return {
    canvasW: c.width, canvasH: c.height,
    duck: { x: Math.round(duck.x), y: Math.round(duck.y), w: Math.round(duck.width), h: Math.round(duck.height) },
    startOverflow: start.scrollHeight - start.clientHeight,
    worldW: Math.round(window.__ZIYI__.state.world.w),
    phase: window.__ZIYI__.state.phase
  };
});
check('小屏也能正常渲染', small.canvasW > 0 && small.worldW > 30, JSON.stringify(small));
check('小屏下蹲按钮在屏幕内', small.duck.x + small.duck.w <= 375 && small.duck.y + small.duck.h <= 667,
  JSON.stringify(small.duck));
check('小屏开始界面不需要滚动就能看全', small.startOverflow <= 2, 'overflow=' + small.startOverflow + 'px');
await page.screenshot({ path: path.join(SHOTS, '08-small-screen.png') });

/* ---------------- 汇总 ---------------- */

await browser.close();
console.log('\n' + '='.repeat(52));
console.log('通过 ' + (results.length - failures) + '/' + results.length + ' 项检查');
if (failures) {
  console.log('\n失败项：');
  results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name + '  ' + (r.detail || '')));
}
if (errors.length) {
  console.log('\n运行时错误：');
  errors.slice(0, 10).forEach(e => console.log('  ! ' + e));
}
console.log('截图目录: shots/');
process.exit(failures || errors.length ? 1 : 0);
