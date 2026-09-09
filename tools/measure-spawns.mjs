import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../core.js');
const T = Core.TUNE;

function makeAI() {
  let jumpHoldUntil = -1, duckUntil = -1;
  return function (st) {
    const p = st.player, speed = st.speed;
    let duck = st.t < duckUntil, threat = null;
    for (const o of st.obstacles) { if (o.x + o.w < p.x - 0.5) continue; if (!threat || o.x < threat.x) threat = o; }
    let pressed = false;
    if (threat) {
      const ttr = (threat.x - (p.x + p.w)) / speed;
      if (threat.fly) { if (!p.onGround) duck = true; else if (ttr < 0.16) { duck = true; duckUntil = st.t + (threat.w + p.w + 3) / speed + 0.06; } }
      else if (p.onGround && !duck) {
        const overlap = (Math.max(0, threat.w - 1.2) + (T.PLAYER_W - 1.2)) / speed;
        const trigger = T.JUMP_V / T.GRAVITY - overlap / 2;
        if (ttr <= trigger && ttr > -overlap) { pressed = true; jumpHoldUntil = st.t + 0.45; }
      }
    }
    return { jump: st.t < jumpHoldUntil, jumpPressed: pressed, duck };
  };
}

// 活跃玩家：统计 60 秒内「生成」了多少障碍/道具，其中字母占比
const spawns = { obstacle: 0, heart: 0, note: 0, noodle: 0, letter: 0 };
const picked = { heart: 0, note: 0, noodle: 0, letter: 0 };
let seconds = 0, deaths = 0;
for (let seed = 1; seed <= 6; seed++) {
  const st = Core.makeState({ seed });
  Core.resetRun(st, { seed });
  const ai = makeAI();
  const seenObs = new Set(), seenPk = new Set();
  const frames = 60 * 30;
  for (let i = 0; i < frames; i++) {
    Core.step(st, 1 / 60, ai(st));
    for (const o of st.obstacles) if (!seenObs.has(o)) { seenObs.add(o); spawns.obstacle++; }
    for (const pk of st.pickups) if (!seenPk.has(pk)) { seenPk.add(pk); spawns[pk.kind] = (spawns[pk.kind] || 0) + 1; }
    for (const ev of st.events) if (ev.type === 'pickup' || ev.type === 'letter') picked[ev.kind] = (picked[ev.kind] || 0) + 1;
    if (st.phase !== 'playing') { deaths++; break; }
  }
  seconds += 30;
}
const per = (n) => (n / seconds * 60).toFixed(1);
console.log('每 60 秒（活跃玩家）:');
console.log('  障碍', per(spawns.obstacle), '个');
console.log('  道具合计', per(spawns.heart + spawns.note + spawns.noodle + spawns.letter), '个 →',
  ' 音符', per(spawns.note), ' 牛肉面', per(spawns.noodle), ' 爱心', per(spawns.heart), ' 字母', per(spawns.letter));
console.log('  30 秒内实际吃到:', JSON.stringify(picked), ' 死亡次数', deaths, '/ 6');
