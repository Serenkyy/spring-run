/**
 * core.js 自动化测试 —— 纯逻辑，不需要浏览器。
 * 运行： node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../core.js');
const T = Core.TUNE;

/* ------------------------------------------------------------------ *
 *  一个「完美玩家」AI：用于证明每个障碍图案都是可以通过的
 * ------------------------------------------------------------------ */
function makeAI() {
  let jumpHoldUntil = -1;
  let duckUntil = -1;
  return function decide(st) {
    const p = st.player;
    const speed = st.speed;
    let jumpPressed = false;
    let duck = st.t < duckUntil;

    // 找最近的威胁
    let threat = null;
    for (const o of st.obstacles) {
      if (o.x + o.w < p.x - 0.5) continue;
      if (!threat || o.x < threat.x) threat = o;
    }

    if (threat) {
      const ttr = (threat.x - (p.x + p.w)) / speed; // 到达障碍的时间
      if (threat.fly) {
        if (!p.onGround) {
          duck = true;                      // 空中下蹲加速落地
        } else if (ttr < 0.16) {
          duck = true;
          duckUntil = st.t + (threat.w + p.w + 3) / speed + 0.06;
        }
      } else if (p.onGround && !duck) {
        // 让「通过障碍的那段时间」正好跨过跳跃最高点
        const overlap = (Math.max(0, threat.w - 1.2) + (T.PLAYER_W - 1.2)) / speed;
        const tApex = T.JUMP_V / T.GRAVITY;
        const trigger = tApex - overlap / 2;
        if (ttr <= trigger && ttr > -overlap) {
          jumpPressed = true;
          jumpHoldUntil = st.t + 0.45;      // 按住以跳满
        }
      }
    }

    const jump = st.t < jumpHoldUntil;
    return { jump, jumpPressed, duck };
  };
}

function runFrames(st, frames, inputFn, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) {
    if (st.phase !== 'playing') return i;
    Core.step(st, dt, inputFn(st));
  }
  return frames;
}

/* ------------------------------------------------------------------ */

test('手机上的快速点击也要跳得够高（不能被 jump-cut 吃掉）', () => {
  const st = Core.makeState({ seed: 11 });
  Core.resetRun(st, { seed: 11 });
  let minY = T.GROUND_Y;
  Core.step(st, 1 / 60, { jump: true, jumpPressed: true });   // 只按一帧
  for (let i = 0; i < 60; i++) {
    Core.step(st, 1 / 60, {});
    minY = Math.min(minY, st.player.y);
  }
  const apex = T.GROUND_Y - minY;
  assert.ok(apex > 20, '快速点击只跳了 ' + apex.toFixed(1) + 'u，应该接近满跳 23u');   // 手机上点一下就松手必须是满跳

  // 长时间按住 → 一样是满跳
  const st2 = Core.makeState({ seed: 12 });
  Core.resetRun(st2, { seed: 12 });
  let minY2 = T.GROUND_Y;
  for (let i = 0; i < 60; i++) {
    Core.step(st2, 1 / 60, { jump: true, jumpPressed: i === 0 });
    minY2 = Math.min(minY2, st2.player.y);
  }
  assert.ok(Math.abs((T.GROUND_Y - minY2) - apex) < 0.6, '按住和点击的跳跃高度应该一样');

  // 滞空时间应该在合理范围（0.7~0.8 秒），不然手感会很飘或很沉
  const air = 2 * T.JUMP_V / T.GRAVITY;
  assert.ok(air > 0.6 && air < 0.9, '滞空时间 ' + air.toFixed(2) + 's 不在手感区间');
});

test('所有道具都悬在空中：站着不动一个也捡不到', () => {
  const st = Core.makeState({ seed: 21 });
  Core.resetRun(st, { seed: 21 });
  st.player.ducking = false;
  st.player.h = T.PLAYER_H;
  st.player.w = T.PLAYER_W;
  const stand = Core.playerBox(st);
  const m = T.PICKUP_MAGNET;
  let checked = 0;
  for (let i = 0; i < 60 * 120; i++) {
    Core.step(st, 1 / 60, {});
    for (const pk of st.pickups) {
      if (pk.checked) continue;
      pk.checked = true;
      const box = { x: pk.x - m, y: pk.y - pk.h - m, w: pk.w + m * 2, h: pk.h + m * 2 };
      assert.ok(!Core.aabb(stand.x, stand.y, stand.w, stand.h, box.x, box.y, box.w, box.h),
        pk.kind + ' 站着就能吃到（y=' + pk.y.toFixed(1) + '，站立盒顶 ' + stand.y.toFixed(1) + '）');
      checked++;
    }
    if (st.phase !== 'playing') Core.resetRun(st, { seed: 300 + i });
  }
  assert.ok(checked > 30, '检查到的道具太少: ' + checked);
});

test('什么都不做：捡不到东西，而且很快输（不能躺着赢）', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const st = Core.makeState({ seed });
    Core.resetRun(st, { seed });
    let frames = 0;
    for (let i = 0; i < 60 * 40; i++) {
      Core.step(st, 1 / 60, {});
      frames++;
      if (st.phase !== 'playing') break;
    }
    assert.equal(st.phase, 'over', 'seed ' + seed + ' 完全不动也不会输');
    assert.equal(st.stats.pickups, 0, 'seed ' + seed + ' 白捡了 ' + st.stats.pickups + ' 个道具');
    assert.ok(frames / 60 < 25, 'seed ' + seed + ' 不动能撑 ' + (frames / 60).toFixed(1) + ' 秒');
  }
});

test('字母是稀有的，道具总量也不多', () => {
  const st = Core.makeState({ seed: 33 });
  Core.resetRun(st, { seed: 33 });
  const ai = makeAI();
  const seen = new Set();
  let letters = 0, total = 0;
  for (let i = 0; i < 60 * 180; i++) {
    Core.step(st, 1 / 60, ai(st));
    st.word.progress = 0;              // 强制基线频率，排除「正在拼词」的加成
    for (const pk of st.pickups) {
      if (seen.has(pk)) continue;
      seen.add(pk);
      total++;
      if (pk.kind === 'letter') letters++;
    }
    if (st.phase !== 'playing') Core.resetRun(st, { seed: 400 + i });
  }
  assert.ok(total > 10, '道具太少了: ' + total);
  const perMin = total / 180 * 60;
  assert.ok(perMin < 45, '道具密度还是太高: ' + perMin.toFixed(0) + ' 个/分钟');
  const letterPerMin = letters / 180 * 60;
  const otherPerMin = (total - letters) / 180 * 60;
  assert.ok(letterPerMin > 15 && letterPerMin < 40,
    '字母频率 ' + letterPerMin.toFixed(1) + ' 个/分钟，应该在 15~40 之间');
  assert.ok(otherPerMin > 2,
    '别的道具被字母挤没了: ' + otherPerMin.toFixed(1) + ' 个/分钟');
  assert.ok(letters / total < 0.92, '字母占 ' + (letters / total * 100).toFixed(0) + '%，别的道具全没了');
});

test('源码里没有重名的函数（曾经重名把角色的鞋子画没了）', () => {
  for (const file of ['../game.js', '../core.js']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    const names = [...src.matchAll(/^[ \t]*function[ \t]+([A-Za-z0-9_$]+)/gm)].map(m => m[1]);
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    assert.deepEqual(dupes, [], file + ' 里有重名函数: ' + dupes.join(', '));
  }
});

test('世界几何：站立会撞到空中障碍，下蹲能钻过去', () => {
  const st = Core.makeState({ seed: 1 });
  Core.resetRun(st, { seed: 1 });
  const p = st.player;

  // 站立的碰撞盒
  p.ducking = false; p.h = T.PLAYER_H; p.w = T.PLAYER_W;
  const stand = Core.playerBox(st);
  p.ducking = true; p.h = T.DUCK_H; p.w = T.DUCK_W;
  const duck = Core.playerBox(st);

  const fly = { kind: 'note', x: p.x, w: 5.6, h: 5.2, fly: true, y: Core.FLY_BOTTOM };
  const fb = Core.obstacleBox(fly);

  assert.ok(stand.y < Core.FLY_BOTTOM, '站立时头顶应该在飞行障碍下方');
  assert.ok(Core.aabb(stand.x, stand.y, stand.w, stand.h, fb.x, fb.y, fb.w, fb.h),
    '站立应该撞到空中障碍');
  assert.ok(!Core.aabb(duck.x, duck.y, duck.w, duck.h, fb.x, fb.y, fb.w, fb.h),
    '下蹲应该能钻过去');
});

test('每种障碍在任意速度下都留出足够的起跳窗口', () => {
  const apex = T.JUMP_V * T.JUMP_V / (2 * T.GRAVITY);
  for (const [name, o] of Object.entries(Core.OBSTACLES)) {
    if (o.fly) continue;
    const H = o.h - 1.0;
    assert.ok(apex > H + 2, name + ' 太高了，跳不过去 (apex=' + apex.toFixed(1) + ', H=' + H + ')');
    const win = 2 * Math.sqrt(2 * (apex - H) / T.GRAVITY);
    for (const speed of [T.BASE_SPEED, 45, 60, T.MAX_SPEED]) {
      const overlap = (o.w - 1.2 + T.PLAYER_W - 1.2) / speed;
      assert.ok(win > overlap + 0.08,
        name + ' 在速度 ' + speed + ' 下窗口不足: have=' + win.toFixed(3) + ' need=' + overlap.toFixed(3));
    }
  }
});

test('每个生成图案都能被完美玩家通过（所有速度）', () => {
  const levels = [1, 2, 3, 5, 8, 12, 16, 20, 26, 34];
  for (const pat of Core.PATTERNS) {
    for (const level of levels) {
      if (pat.minLevel > level) continue;
      const seed = 1234 + level * 7 + pat.id.length;
      const st = Core.makeState({ seed });
      Core.resetRun(st, { seed, level });
      st.world.w = 46; st.world.h = 100;
      st.spawn.nextObstacleAt = 30;
      st.spawn.forcePattern = pat.id;

      const ai = makeAI();
      let spawned = false;
      let hit = false;
      st.events.length = 0;

      for (let i = 0; i < 60 * 60; i++) {
        Core.step(st, 1 / 60, ai(st));
        for (const ev of st.events) {
          if (ev.type === 'hit' || ev.type === 'gameover') hit = true;
        }
        if (!spawned && st.spawn.lastSpawnDistance >= 0) {
          spawned = true;
          st.spawn.nextObstacleAt = Infinity;
          st.spawn.nextPickupAt = Infinity;
        }
        if (spawned && st.obstacles.every(o => o.x + o.w < st.player.x)) break;
      }
      assert.ok(spawned, pat.id + ' 没有生成');
      assert.ok(!hit, '图案 ' + pat.id + ' 在 ' + level + ' 级撞到了（速度 ' +
        Core.speedForLevel(level).toFixed(1) + '）');
    }
  }
});

test('物理不变量：随机输入模糊测试 20 万帧不崩、不出 NaN', () => {
  const seeds = [1, 42, 777, 20240521, 987654];
  for (const seed of seeds) {
    const st = Core.makeState({ seed });
    Core.resetRun(st, { seed });
    const rng = Core.mulberry32(seed ^ 0x5f5f);
    let held = false;
    for (let i = 0; i < 40000; i++) {
      if (st.phase !== 'playing') { Core.resetRun(st, { seed: seed + i }); }
      const dt = i % 997 === 0 ? 10 : (1 / 60) * (0.5 + rng());
      if (rng() < 0.06) held = !held;
      const input = {
        jump: held,
        jumpPressed: rng() < 0.05,
        duck: rng() < 0.15
      };
      Core.step(st, dt, input);

      assert.ok(Number.isFinite(st.distance) && st.distance >= 0, 'distance 异常');
      assert.ok(Number.isFinite(st.player.y), 'player.y 是 NaN');
      assert.ok(st.player.y >= 0 && st.player.y <= T.GROUND_Y + 0.001, 'player.y 越界: ' + st.player.y);
      assert.ok(Number.isFinite(st.player.vy), 'player.vy 是 NaN');
      assert.ok(Number.isFinite(st.speed) && st.speed > 0, 'speed 异常');
      assert.ok(st.obstacles.length < 60, '障碍物泄漏: ' + st.obstacles.length);
      assert.ok(st.pickups.length < 60, '道具泄漏: ' + st.pickups.length);
      assert.ok(st.hearts >= 0 && st.hearts <= T.HEARTS_MAX, 'hearts 越界');
      assert.ok(st.xp >= 0 && st.xp < st.xpToNext + 1e-6, 'XP 未正确结转');
      assert.ok(st.level >= 1 && st.level < 5000, 'level 异常');
      assert.ok(st.speed <= T.MAX_SPEED + 1e-9, '速度超过上限');
    }
  }
});

test('确定性：同样的种子 + 同样的输入 → 同样的结果', () => {
  function play() {
    const st = Core.makeState({ seed: 99 });
    Core.resetRun(st, { seed: 99 });
    const rng = Core.mulberry32(12345);
    for (let i = 0; i < 3000; i++) {
      Core.step(st, 1 / 60, { jump: rng() < 0.3, jumpPressed: rng() < 0.04, duck: rng() < 0.2 });
      if (st.phase !== 'playing') break;
    }
    return {
      distance: st.distance, level: st.level, xp: st.xp,
      hearts: st.hearts, obstacles: st.obstacles.length, phase: st.phase
    };
  }
  assert.deepEqual(play(), play());
});

test('组间间隔永远留够反应时间', () => {
  const st = Core.makeState({ seed: 5 });
  Core.resetRun(st, { seed: 5, level: 12 });
  const ai = makeAI();
  let last = null;
  let minGap = Infinity;
  for (let i = 0; i < 60 * 300; i++) {
    const before = st.spawn.lastSpawnDistance;
    Core.step(st, 1 / 60, ai(st));
    if (st.spawn.lastSpawnDistance !== before) {
      if (last !== null) {
        const gapSec = (st.spawn.lastSpawnDistance - last) / st.speed;
        if (gapSec < minGap) minGap = gapSec;
      }
      last = st.spawn.lastSpawnDistance;
    }
    if (st.phase !== 'playing') break;
  }
  assert.ok(minGap > 0.95, '最小间隔只有 ' + minGap.toFixed(2) + ' 秒');
});

test('完美玩家能长期存活并持续升级', () => {
  const st = Core.makeState({ seed: 2026 });
  Core.resetRun(st, { seed: 2026 });
  const ai = makeAI();
  const seenLevels = new Set();
  let deaths = 0;
  for (let i = 0; i < 60 * 180; i++) {          // 3 分钟
    Core.step(st, 1 / 60, ai(st));
    seenLevels.add(st.level);
    if (st.phase !== 'playing') { deaths++; Core.resetRun(st, { seed: 2026 + i }); }
  }
  assert.equal(deaths, 0, '完美玩家不该死 ' + deaths + ' 次');
  assert.ok(st.level >= 8, '3 分钟只到 ' + st.level + ' 级，升级太慢');
  assert.ok(st.distance > 5000, '3 分钟只跑了 ' + Math.floor(st.distance) + ' 米');
  assert.ok(seenLevels.size >= 8);
});

test('俄语单词：按顺序收集字母可以拼出单词', () => {
  const st = Core.makeState({ seed: 7 });
  Core.resetRun(st, { seed: 7 });
  const word = Core.WORDS[0];
  const events = [];
  for (let i = 0; i < word.ru.length; i++) {
    // 直接把字母道具塞到玩家身上
    st.pickups.push({
      kind: 'letter', x: st.player.x, y: T.GROUND_Y, w: 4.8, h: 5,
      xp: 15, ch: word.ru.charAt(i), bob: 0, taken: false
    });
    Core.step(st, 1 / 60, {});
    for (const ev of st.events) events.push(ev);
  }
  const done = events.find(e => e.type === 'word');
  assert.ok(done, '没有触发拼词事件');
  assert.equal(done.ru, word.ru);
  assert.equal(done.zh, word.zh);
  assert.equal(st.word.index, 1, '应该切换到下一个单词');
  assert.equal(st.stats.words, 1);
});

test('撞击 → 扣心 → 归零后进入 gameover', () => {
  const st = Core.makeState({ seed: 3 });
  Core.resetRun(st, { seed: 3 });
  st.player.invuln = 0;
  let gameover = null;
  for (let k = 0; k < T.HEARTS_MAX + 1; k++) {
    st.player.invuln = 0;
    st.obstacles.push({
      kind: 'piano', x: st.player.x, y: T.GROUND_Y, w: 8.4, h: 9.5,
      fly: false, hit: false, wobble: 0, passed: false
    });
    Core.step(st, 1 / 60, {});
    for (const ev of st.events) if (ev.type === 'gameover') gameover = ev;
    st.obstacles.length = 0;
  }
  assert.equal(st.hearts, 0);
  assert.equal(st.phase, 'over');
  assert.ok(gameover, '没有发出 gameover 事件');
  assert.ok(typeof gameover.message === 'string' && gameover.message.length > 0);
});

test('护盾可以抵挡一次撞击', () => {
  const st = Core.makeState({ seed: 4 });
  Core.resetRun(st, { seed: 4 });
  st.player.invuln = 0;
  st.shield = 1;
  st.obstacles.push({
    kind: 'shoe', x: st.player.x, y: T.GROUND_Y, w: 7, h: 4.2,
    fly: false, hit: false, wobble: 0, passed: false
  });
  Core.step(st, 1 / 60, {});
  assert.equal(st.shield, 0, '护盾应该被消耗');
  assert.equal(st.hearts, T.HEARTS_MAX, '血量不该掉');
  assert.ok(st.player.invuln > 0);
});

test('升级：血量回复、速度提升、发出鼓励语', () => {
  const st = Core.makeState({ seed: 6 });
  Core.resetRun(st, { seed: 6 });
  st.hearts = 1;
  const speed0 = st.speed;
  const evs = [];
  for (let lv = 0; lv < 3; lv++) {
    st.events.length = 0;                 // 模拟一帧的开始
    Core.addXp(st, st.xpToNext);
    for (const ev of st.events) evs.push(ev);
  }
  assert.equal(st.level, 4);
  assert.ok(st.speed > speed0, '速度应该提升');
  assert.equal(st.hearts, 2, '第 3 级应该回 1 颗心（4 级不回）');
  const ups = evs.filter(e => e.type === 'levelup');
  assert.equal(ups.length, 3);
  for (const ev of ups) {
    assert.ok(ev.message.length > 0, '升级必须有鼓励语');
    assert.ok(ev.title.length > 0, '升级必须有关卡名');
  }
});

test('难度曲线单调且有上限', () => {
  let prev = 0;
  for (let lv = 1; lv <= 60; lv++) {
    const s = Core.speedForLevel(lv);
    assert.ok(s >= prev, '速度必须单调不降');
    assert.ok(s <= T.MAX_SPEED + 1e-9, '速度必须封顶');
    prev = s;
  }
  for (let lv = 1; lv <= 30; lv++) {
    assert.ok(Core.xpForLevel(lv + 1) > Core.xpForLevel(lv), 'XP 需求必须递增');
  }
});

test('里程碑会给出进度提示', () => {
  const st = Core.makeState({ seed: 8 });
  Core.resetRun(st, { seed: 8 });
  const msgs = [];
  for (let i = 0; i < 60 * 120; i++) {
    Core.step(st, 1 / 60, {});
    for (const ev of st.events) if (ev.type === 'milestone') msgs.push(ev);
    if (st.phase !== 'playing') { st.phase = 'playing'; st.hearts = 3; }
    if (msgs.length >= 3) break;
  }
  assert.ok(msgs.length >= 3, '应该出现至少 3 次里程碑');
  assert.ok(msgs[0].distance === 500);
  assert.ok(/\d/.test(msgs[0].message), '里程碑消息里应该有距离数字');
});

test('分数随距离单调增长', () => {
  const st = Core.makeState({ seed: 9 });
  Core.resetRun(st, { seed: 9 });
  let last = -1;
  for (let i = 0; i < 60 * 30; i++) {
    Core.step(st, 1 / 60, {});
    assert.ok(st.score >= last, '分数不该倒退');
    last = st.score;
  }
});
