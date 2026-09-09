import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../core.js');
const T = Core.TUNE;
function idle(seed, maxSec = 300) {
  const st = Core.makeState({ seed });
  Core.resetRun(st, { seed });
  let deaths = 0, firstDeath = null;
  for (let i = 0; i < 60 * maxSec; i++) {
    Core.step(st, 1 / 60, {});          // 完全不动
    if (st.phase !== 'playing') {
      if (firstDeath === null) firstDeath = { t: st.t, dist: Math.round(st.distance), lvl: st.level, pickups: st.stats.pickups, hearts: st.hearts };
      deaths++;
      Core.resetRun(st, { seed: seed + deaths });
    }
  }
  return firstDeath;
}
let totalT = 0, totalDist = 0, totalPick = 0, n = 0;
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const d = idle(seed, 120);
  totalT += d.t; totalDist += d.dist; totalPick += d.pickups; n++;
  if (seed <= 4) console.log('seed', seed, JSON.stringify(d));
}
console.log('平均: 存活', (totalT / n).toFixed(1), '秒, 距离', Math.round(totalDist / n), '米, 白捡道具', (totalPick / n).toFixed(1), '个');

// 统计 60 秒正常游玩时各种道具的数量
const st = Core.makeState({ seed: 42 });
Core.resetRun(st, { seed: 42 });
const counts = {};
for (let i = 0; i < 60 * 60; i++) {
  Core.step(st, 1 / 60, { jump: false, duck: false });
  for (const ev of st.events) {
    if (ev.type === 'pickup' || ev.type === 'letter') counts[ev.kind] = (counts[ev.kind] || 0) + 1;
  }
  if (st.phase !== 'playing') Core.resetRun(st, { seed: 100 + i });
}
console.log('60 秒内生成/拾取的道具:', JSON.stringify(counts));

// 地面道具比例
const st2 = Core.makeState({ seed: 7 });
Core.resetRun(st2, { seed: 7 });
let ground = 0, air = 0;
for (let i = 0; i < 60 * 120; i++) {
  Core.step(st2, 1 / 60, {});
  for (const pk of st2.pickups) {
    if (pk.counted) continue;
    pk.counted = true;
    if (pk.y >= T.GROUND_Y - 0.01) ground++; else air++;
  }
  if (st2.phase !== 'playing') Core.resetRun(st2, { seed: 200 + i });
}
console.log('道具位置: 地面', ground, '个 / 空中', air, '个  → 地面占', (ground / (ground + air) * 100).toFixed(0) + '%');
