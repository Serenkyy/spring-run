/*!
 * 《自怡向前冲》 ZiYi Run — core.js
 * 纯游戏逻辑（物理 / 生成 / 碰撞 / 升级 / 鼓励语）。
 * 不碰 DOM、不碰 Canvas、不碰 Audio —— 所以可以在 Node 里跑自动化测试。
 * 浏览器里挂到 window.ZiyiCore。
 */
(function (root, factory) {
  var Core = factory();
  if (typeof module === 'object' && module.exports) module.exports = Core;
  if (root) root.ZiyiCore = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  世界坐标系：高度固定为 100 个单位 (u)，宽度 = 100 * 屏幕宽高比。
   *  地面在 y = 72，y 轴向下为正。
   * ------------------------------------------------------------------ */

  var TUNE = {
    WORLD_H: 100,
    GROUND_Y: 72,

    PLAYER_W: 7.2,
    PLAYER_H: 11.2,
    DUCK_W: 8.8,
    DUCK_H: 6.0,
    PLAYER_X_RATIO: 0.2,
    PLAYER_X_MIN: 10,
    PLAYER_X_MAX: 30,

    GRAVITY: 340,          // u/s²
    JUMP_V: 125,           // u/s  → 顶点约 23u，滞空约 0.735s（保证每种障碍都过得去）
    FAST_FALL: 2.5,        // 空中下蹲的额外重力倍数
    COYOTE: 0.09,          // 离开地面后仍可起跳的宽容时间
    JUMP_BUFFER: 0.13,     // 落地前提前按跳的缓冲时间

    BASE_SPEED: 30,
    MAX_SPEED: 68,
    SPEED_PER_LEVEL: 0.078,

    XP_BASE: 120,
    XP_STEP: 75,
    XP_PER_UNIT: 0.5,
    HEARTS_MAX: 3,
    INVULN_HIT: 1.4,
    INVULN_LEVEL: 1.5,
    SHIELD_INVULN: 1.1,
    HEAL_EVERY_LEVELS: 3,

    HITBOX_INSET_X: 1.2,
    HITBOX_INSET_Y: 0.8,
    PICKUP_MAGNET: 2.0,
    PICKUP_HEIGHT_MIN: 13,   // 道具都在空中：必须跳起来才拿得到
    PICKUP_HEIGHT_MAX: 19,
    PICKUP_GAP_MIN: 1.9,     // 道具之间的间隔（秒）
    PICKUP_GAP_MAX: 3.4,
    LETTER_CHANCE: 0.30,     // 平时出现字母的概率（约 ×2.5）
    LETTER_CHANCE_ACTIVE: 0.55, // 正在拼词时更高
    MILESTONE_STEP: 500
  };

  var PALETTE = {
    skyTop: '#FFF1F7',
    skyBottom: '#FFE0EF',
    cloud: '#FFFFFF',
    cloudShade: '#FFD6E8',
    hillFar: '#EBD9F5',
    hillNear: '#DDC7F0',
    tree: '#FFC2DC',
    treeDark: '#FFA8CB',
    petal: '#FFB3D1',
    grassTop: '#CFF3DE',
    grassBottom: '#A9E6C6',
    ground: '#FFEAF2',
    groundLine: '#F7C6DA',
    pink: '#FF8FB8',
    pinkDeep: '#C4577F',
    pinkSoft: '#FFD1E2',
    lavender: '#C9B6FF',
    lemon: '#FFE9A8',
    peach: '#FFC9A8',
    mint: '#B8E8D0',
    sky: '#BFE3FF',
    cream: '#FFF7FA',
    ink: '#8A5A6E',
    skin: '#FFD9C2',
    hair: '#6B4A55',
    shoe: '#FFFFFF'
  };

  /* 一天的光线：随关卡缓慢过渡，让长时间游玩有新鲜感 */
  var SKY_MOODS = [
    { name: '清晨', top: '#FFF1F7', bottom: '#FFE0EF', sun: '#FFF0C9' },
    { name: '正午', top: '#EAF6FF', bottom: '#FFEAF4', sun: '#FFF7D6' },
    { name: '午后', top: '#FFF3EC', bottom: '#FFDCEB', sun: '#FFE2B8' },
    { name: '黄昏', top: '#FFE9F0', bottom: '#FFD3E4', sun: '#FFC9A8' }
  ];

  /* ---------------------------- 工具 ---------------------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rangeOf(rng, lo, hi) { return lo + rng() * (hi - lo); }

  function pick(rng, arr) { return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]; }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  /* ------------------------- 障碍 / 敌人 ------------------------- */
  /* w,h 单位 u；fly 为 true 表示空中（需要下蹲） */

  var OBSTACLES = {
    piano:      { w: 8.4,  h: 9.5,  fly: false, label: '钢琴' },
    basket:     { w: 8.6,  h: 6.0,  fly: false, label: '网球筐' },
    suitcase:   { w: 6.6,  h: 8.6,  fly: false, label: '行李箱' },
    noodle:     { w: 9.6,  h: 5.2,  fly: false, label: '牛肉面' },
    tripod:     { w: 4.6,  h: 12.4, fly: false, label: '相机架' },
    shoe:       { w: 7.0,  h: 4.2,  fly: false, label: '跑鞋' },
    note:       { w: 7.0,  h: 5.2,  fly: true,  label: '音符' },
    ball:       { w: 5.6,  h: 4.6,  fly: true,  label: '网球' },
    book:       { w: 7.6,  h: 4.8,  fly: true,  label: '俄语书' },
    bird:       { w: 7.6,  h: 4.6,  fly: true,  label: '小鸟' }
  };

  /* 空中障碍的底边高度：必须高于下蹲身高（地面 72 - 蹲 6 = 66），
     又要低于站立身高（72 - 11.2 = 60.8），这样「站着会撞、蹲下能过」。 */
  var FLY_BOTTOM = 64.0;
  var FLY_BOTTOM_JITTER = 1.0;

  var PICKUPS = {
    heart:  { w: 4.6, h: 4.6, xp: 0,   label: '爱心' },
    note:   { w: 4.2, h: 4.6, xp: 25,  label: '音符' },
    noodle: { w: 4.8, h: 4.6, xp: 40,  label: '牛肉面' },
    letter: { w: 4.8, h: 5.0, xp: 15,  label: '字母' }
  };

  /* ---------------------------- 俄语单词 ---------------------------- */

  var WORDS = [
    { ru: 'ПРИВЕТ',   zh: '你好' },
    { ru: 'СПАСИБО',  zh: '谢谢' },
    { ru: 'МОЛОДЕЦ',  zh: '真棒' },
    { ru: 'ЛЮБОВЬ',   zh: '爱' },
    { ru: 'ДРУГ',     zh: '朋友' },
    { ru: 'УЧИТЕЛЬ',  zh: '老师' },
    { ru: 'РОССИЯ',   zh: '俄罗斯' },
    { ru: 'СОЛНЦЕ',   zh: '太阳' },
    { ru: 'ВЕСНА',    zh: '春天' },
    { ru: 'ЛЕТО',     zh: '夏天' },
    { ru: 'МУЗЫКА',   zh: '音乐' },
    { ru: 'ТЕННИС',   zh: '网球（Большой теннис 就是「大网球」）' },
    { ru: 'КОШКА',    zh: '猫咪' },
    { ru: 'ПУТЕШЕСТВИЕ', zh: '旅行' }
  ];

  /* ---------------------------- 关卡名字 ---------------------------- */

  var LEVEL_TITLES = [
    '樱花起跑', '春风十里', '钢琴小径', '网球场边', '牛肉面街', '旅行箱里',
    '镜头之下', '俄语课堂', '夏日午后', '阳光正好', '西瓜汽水', '海边散步',
    '晨跑公园', '烤面包香', '蒲公英雨', '晚风与歌'
  ];

  /* ---------------------------- 鼓励语 ---------------------------- */

  var MESSAGES = {
    greeting: [
      '今天也来跑一会儿吧 ♥',
      '钢琴弹累了，就跑两步',
      '想吃什么？跑完去吃牛肉面 🍜',
      '旅行前先热热身',
      '镜头准备好了，主角是你',
      '今天的心情，跑起来就知道了',
      'Цзыи，准备好了吗？',
      '春天和夏天都在等你'
    ],
    start: [
      '自怡，出发啦！',
      '今天也要开开心心的 ♥',
      '慢一点也没关系，你已经很棒了',
      'Молодец! 你最棒！',
      '春天的风都站在你这边',
      '镜头准备好了，跑起来吧'
    ],
    levelup: [
      'Молодец! 你真棒！',
      '第 {level} 关，越来越稳了！',
      '这就是你，一直都在进步',
      '钢琴弹得好，跑步也快！',
      '保持这个节奏，自怡',
      '你比昨天更厉害了一点',
      '这一关的名字，很适合你',
      '看，前面的风景更漂亮',
      '再快一点也难不倒你',
      '你笑起来的样子最好看',
      '春天和夏天都在为你加油',
      '你的学生都在给你鼓掌',
      'Большой теннис！发球吧',
      '这一关，你走得很稳',
      'Пять! 满分！'
    ],
    hit: [
      '没关系，拍拍灰继续跑',
      '摔倒了也要漂亮地站起来',
      '别怕，慢慢来～',
      '失误也是风景的一部分',
      '深呼吸，你可以的',
      '还有心呢，继续！',
      '小麻烦而已，跳过去就好',
      '你比自己想象的更稳'
    ],
    milestone: [
      '{dist} 米啦！这碗牛肉面是你的了 🍜',
      '{dist} 米！你今天状态真好',
      '已经 {dist} 米，镜头前的你最好看',
      '{dist} 米，旅行中最美的风景是你',
      '{dist} 米了，Молодец!',
      '{dist} 米，给自己鼓个掌',
      '{dist} 米，跑得像春天一样',
      '{dist} 米！今天的你很勇敢',
      '{dist} 米，钢琴和跑道都喜欢你'
    ],
    gameover: [
      '这次到这里啦，但我一直都在',
      '累了吧？喝口水，我们下次继续',
      '不管多少分，你都很棒',
      '失败一次，也是数据 +1 呀',
      '没关系，我们再来一次～',
      '你今天已经跑了很远很远',
      '抱一下，然后继续',
      '下一局一定更好',
      '歇一会儿，喝点水 ♥',
      '不管跑多少，你都是最棒的'
    ],
    word: [
      '拼出来啦！',
      '这个词，是你教过的吧',
      '俄语课代表的实力 ♥',
      'Спасибо, 老师！',
      '再来一个词？'
    ]
  };

  /* ---------------------------- 生成图案 ---------------------------- */
  /* dt 是相对图案起点的时间（秒）——生成时乘以当前速度换算成距离，
     这样无论跑多快，图案的「可解性」都不变。 */

  var PATTERNS = [
    { id: 'a1', minLevel: 1,  weight: 3, items: [{ dt: 0, kind: 'shoe' }] },
    { id: 'a2', minLevel: 1,  weight: 3, items: [{ dt: 0, kind: 'noodle' }] },
    { id: 'a3', minLevel: 1,  weight: 3, items: [{ dt: 0, kind: 'basket' }] },
    { id: 'b1', minLevel: 2,  weight: 3, items: [{ dt: 0, kind: 'suitcase' }] },
    { id: 'b2', minLevel: 2,  weight: 2, items: [{ dt: 0, kind: 'note' }] },
    { id: 'c1', minLevel: 3,  weight: 2, items: [{ dt: 0, kind: 'piano' }] },
    { id: 'c2', minLevel: 3,  weight: 2, items: [{ dt: 0, kind: 'shoe' }, { dt: 1.0, kind: 'basket' }] },
    { id: 'd1', minLevel: 4,  weight: 2, items: [{ dt: 0, kind: 'tripod' }] },
    { id: 'd2', minLevel: 4,  weight: 2, items: [{ dt: 0, kind: 'ball' }] },
    { id: 'e1', minLevel: 5,  weight: 2, items: [{ dt: 0, kind: 'shoe' }, { dt: 1.05, kind: 'note' }] },
    { id: 'e2', minLevel: 5,  weight: 2, items: [{ dt: 0, kind: 'book' }] },
    { id: 'f1', minLevel: 7,  weight: 2, items: [{ dt: 0, kind: 'note' }, { dt: 1.15, kind: 'shoe' }] },
    { id: 'f2', minLevel: 7,  weight: 1, items: [{ dt: 0, kind: 'suitcase' }, { dt: 1.1, kind: 'suitcase' }] },
    { id: 'g1', minLevel: 9,  weight: 1, items: [{ dt: 0, kind: 'bird' }, { dt: 1.0, kind: 'bird' }] },
    { id: 'g2', minLevel: 10, weight: 1, items: [{ dt: 0, kind: 'basket' }, { dt: 0.95, kind: 'note' }, { dt: 1.9, kind: 'suitcase' }] },
    { id: 'g3', minLevel: 12, weight: 1, items: [{ dt: 0, kind: 'piano' }, { dt: 1.15, kind: 'ball' }] }
  ];

  /* ---------------------------- 状态 ---------------------------- */

  function makeState(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? ((Math.random() * 0x7fffffff) | 0) : (opts.seed | 0);
    var st = {
      seed: seed,
      rng: mulberry32(seed),
      phase: 'ready',           // ready | playing | over
      t: 0,
      distance: 0,
      bonus: 0,
      score: 0,
      level: 1,
      xp: 0,
      xpToNext: TUNE.XP_BASE,
      xpAccum: 0,
      hearts: TUNE.HEARTS_MAX,
      shield: 0,
      speed: TUNE.BASE_SPEED,
      world: { w: 46, h: TUNE.WORLD_H },
      player: {
        x: 10, y: TUNE.GROUND_Y, vy: 0,
        w: TUNE.PLAYER_W, h: TUNE.PLAYER_H,
        ducking: false, onGround: true,
        coyote: 0, buffer: 0,
        invuln: 0, runPhase: 0, squash: 0, blink: 0
      },
      obstacles: [],
      pickups: [],
      spawn: { nextObstacleAt: 30, nextPickupAt: 26, lastPattern: null, lastPickupAt: -99, forcePattern: null, lastSpawnDistance: -999 },
      word: { index: 0, progress: 0, ru: WORDS[0].ru, zh: WORDS[0].zh },
      milestone: 0,
      shake: 0,
      flash: 0,
      slowmo: 0,
      combo: 0,
      events: [],
      lastMessage: '',
      stats: { jumps: 0, ducks: 0, hits: 0, pickups: 0, words: 0, levelUps: 0 }
    };
    return st;
  }

  function resetRun(st, opts) {
    opts = opts || {};
    var seed = opts.seed == null ? ((Math.random() * 0x7fffffff) | 0) : (opts.seed | 0);
    var w = st.world.w;
    st.seed = seed;
    st.rng = mulberry32(seed);
    st.phase = 'playing';
    st.t = 0;
    st.distance = 0;
    st.bonus = 0;
    st.score = 0;
    st.level = 1;
    st.xp = 0;
    st.xpToNext = TUNE.XP_BASE;
    st.xpAccum = 0;
    st.hearts = TUNE.HEARTS_MAX;
    st.shield = 0;
    st.speed = TUNE.BASE_SPEED;
    st.obstacles.length = 0;
    st.pickups.length = 0;
    st.spawn.nextObstacleAt = 40;
    st.spawn.nextPickupAt = 30;
    st.spawn.lastPattern = null;
    st.spawn.lastPickupAt = -99;
    st.spawn.forcePattern = null;
    st.spawn.lastSpawnDistance = -999;
    st.word = { index: 0, progress: 0, ru: WORDS[0].ru, zh: WORDS[0].zh };
    st.milestone = 0;
    st.shake = 0;
    st.flash = 0;
    st.slowmo = 0;
    st.combo = 0;
    st.events.length = 0;
    st.stats = { jumps: 0, ducks: 0, hits: 0, pickups: 0, words: 0, levelUps: 0 };
    if (opts.level && opts.level > 1) {
      st.level = opts.level | 0;
      st.speed = speedForLevel(st.level);
      st.xpToNext = xpForLevel(st.level);
    }
    var p = st.player;
    p.x = clamp(w * TUNE.PLAYER_X_RATIO, TUNE.PLAYER_X_MIN, TUNE.PLAYER_X_MAX);
    p.y = TUNE.GROUND_Y;
    p.vy = 0;
    p.w = TUNE.PLAYER_W;
    p.h = TUNE.PLAYER_H;
    p.ducking = false;
    p.onGround = true;
    p.coyote = 0;
    p.buffer = 0;
    p.invuln = 1.0;
    p.runPhase = 0;
    p.squash = 0;
    p.blink = 0;
    emit(st, 'start', { message: pickMessage(st, 'start') });
    return st;
  }

  function emit(st, type, data) {
    var ev = { type: type, t: st.t };
    if (data) { for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) ev[k] = data[k]; } }
    st.events.push(ev);
    return ev;
  }

  function pickMessage(st, kind, vars) {
    var list = MESSAGES[kind] || [];
    if (!list.length) return '';
    var msg = pick(st.rng, list);
    if (msg === st.lastMessage && list.length > 1) {
      msg = list[(list.indexOf(msg) + 1) % list.length];
    }
    st.lastMessage = msg;
    if (vars) {
      msg = msg.replace(/\{(\w+)\}/g, function (m, key) {
        return vars[key] == null ? m : String(vars[key]);
      });
    }
    return msg;
  }

  function levelTitle(level) {
    if (level <= LEVEL_TITLES.length) return LEVEL_TITLES[level - 1];
    var extra = ['继续向前', '风景更好', '风很温柔', '阳光正好', '花香满路', '云在跟着你'];
    return extra[(level - LEVEL_TITLES.length - 1) % extra.length];
  }

  function speedForLevel(level) {
    return Math.min(TUNE.MAX_SPEED, TUNE.BASE_SPEED * (1 + TUNE.SPEED_PER_LEVEL * (level - 1)));
  }

  function xpForLevel(level) {
    return TUNE.XP_BASE + TUNE.XP_STEP * (level - 1);
  }

  /* ---------------------------- 生成 ---------------------------- */

  function spawnPattern(st) {
    var eligible = [];
    var total = 0;
    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      if (p.minLevel > st.level) continue;
      if (p.id === st.spawn.lastPattern && PATTERNS.length > 2) continue;
      eligible.push(p);
      total += p.weight;
    }
    if (!eligible.length) return 0;

    var chosen = eligible[0];
    if (st.spawn.forcePattern) {
      for (var fi = 0; fi < PATTERNS.length; fi++) {
        if (PATTERNS[fi].id === st.spawn.forcePattern) { chosen = PATTERNS[fi]; }
      }
      st.spawn.forcePattern = null;
    } else {
      var roll = st.rng() * total;
      for (var j = 0; j < eligible.length; j++) {
        roll -= eligible[j].weight;
        if (roll <= 0) { chosen = eligible[j]; break; }
      }
    }
    st.spawn.lastPattern = chosen.id;
    st.spawn.lastSpawnDistance = st.distance;

    var speed = st.speed;
    var originX = st.world.w + 8;
    var lastDt = 0;
    for (var k = 0; k < chosen.items.length; k++) {
      var it = chosen.items[k];
      var def = OBSTACLES[it.kind];
      if (!def) continue;
      var o = {
        kind: it.kind,
        x: originX + speed * it.dt,
        w: def.w,
        h: def.h,
        fly: !!def.fly,
        y: def.fly
          ? FLY_BOTTOM - rangeOf(st.rng, 0, FLY_BOTTOM_JITTER)
          : TUNE.GROUND_Y,
        hit: false,
        wobble: st.rng() * Math.PI * 2,
        passed: false
      };
      st.obstacles.push(o);
      if (it.dt > lastDt) lastDt = it.dt;
    }

    // 组间间隔：按时间给，随等级略微收紧，但有硬下限保证可解
    var gapTime = clamp(1.75 - 0.04 * st.level, 1.15, 1.75) + st.rng() * 0.7;
    var spanTime = lastDt + 0.6;
    st.spawn.nextObstacleAt = st.distance + speed * (spanTime + gapTime);

    pruneUnsafePickups(st);
    return chosen.items.length;
  }

  /* 刚生成了障碍，检查一下附近的道具会不会「跳起来吃它就正好撞上障碍」。
     道具是可选的，所以直接挪掉最安全 —— 宁可少一个，也不要坑玩家。 */
  function pruneUnsafePickups(st) {
    var speed = st.speed;
    for (var i = st.pickups.length - 1; i >= 0; i--) {
      var pk = st.pickups[i];
      var airFrom = pk.x - speed * 0.55;      // 为了吃到它，大约要在这里起跳
      var airTo = pk.x + speed * 0.55;        // 大约在这里落地
      var bad = false;
      for (var j = 0; j < st.obstacles.length; j++) {
        var o = st.obstacles[j];
        // 道具和障碍挤在一起
        if (pk.x < o.x + o.w + 4 && pk.x + pk.w + 4 > o.x) { bad = true; break; }
        // 地面障碍：正好落在它身上
        if (!o.fly && airTo > o.x - 5 && airFrom < o.x + o.w + 5) { bad = true; break; }
        // 空中障碍：为了吃道具起跳会一头撞上去
        if (o.fly && airTo > o.x - 3 && airFrom < o.x + o.w + 3) { bad = true; break; }
      }
      if (bad) st.pickups.splice(i, 1);
    }
  }

  function pickupBlocked(st, x, w) {
    for (var i = 0; i < st.obstacles.length; i++) {
      var o = st.obstacles[i];
      if (x < o.x + o.w + 3 && x + w + 3 > o.x) return true;
    }
    return false;
  }

  function spawnPickup(st) {
    var roll = st.rng();
    var kind, def;
    // 字母要稀有：正在拼词时稍多一点，否则偶尔才出现
    var letterChance = st.word.progress > 0 ? TUNE.LETTER_CHANCE_ACTIVE : TUNE.LETTER_CHANCE;
    if (st.rng() < letterChance && !pickupBlocked(st, st.world.w + 6, PICKUPS.letter.w)) {
      kind = 'letter';
    } else if (roll < 0.12) {
      kind = 'heart';
    } else if (roll < 0.34) {
      kind = 'noodle';
    } else {
      kind = 'note';
    }
    def = PICKUPS[kind];

    // 全部悬在空中：只有跳起来才拿得到（站着不动什么也捡不到）
    var y = TUNE.GROUND_Y - rangeOf(st.rng, TUNE.PICKUP_HEIGHT_MIN, TUNE.PICKUP_HEIGHT_MAX);
    var x = st.world.w + 6;
    if (pickupBlocked(st, x, def.w)) {
      st.spawn.nextPickupAt = st.distance + st.speed * 1.2;
      return;
    }

    var ch = '';
    if (kind === 'letter') {
      var word = WORDS[st.word.index % WORDS.length];
      st.word.ru = word.ru;
      st.word.zh = word.zh;
      ch = word.ru.charAt(Math.min(st.word.progress, word.ru.length - 1));
    }

    st.pickups.push({
      kind: kind, x: x, y: y, w: def.w, h: def.h,
      xp: def.xp, ch: ch, bob: st.rng() * Math.PI * 2, taken: false
    });
    st.spawn.nextPickupAt = st.distance + st.speed * rangeOf(st.rng, TUNE.PICKUP_GAP_MIN, TUNE.PICKUP_GAP_MAX);
  }

  /* ---------------------------- 物理 ---------------------------- */

  function playerBox(st) {
    var p = st.player;
    return {
      x: p.x + TUNE.HITBOX_INSET_X * 0.5,
      y: p.y - p.h + TUNE.HITBOX_INSET_Y * 0.5,
      w: p.w - TUNE.HITBOX_INSET_X,
      h: p.h - TUNE.HITBOX_INSET_Y
    };
  }

  function obstacleBox(o) {
    var ix = o.w > 3 ? 0.6 : 0.2;
    return {
      x: o.x + ix,
      y: o.y - o.h + 0.5,
      w: o.w - ix * 2,
      h: o.h - 1.0
    };
  }

  function integrate(st, dt, input) {
    var p = st.player;
    var speed = st.speed;

    // --- 蹲 ---
    var wantDuck = !!input.duck;
    if (wantDuck && !p.ducking) {
      p.ducking = true;
      st.stats.ducks++;
      if (!p.onGround) p.vy = Math.max(p.vy, 8);
    } else if (!wantDuck && p.ducking) {
      p.ducking = false;
    }
    p.w = p.ducking ? TUNE.DUCK_W : TUNE.PLAYER_W;
    p.h = p.ducking ? TUNE.DUCK_H : TUNE.PLAYER_H;

    // --- 跳 ---
    if (input.jumpPressed) p.buffer = TUNE.JUMP_BUFFER;
    if (p.buffer > 0) p.buffer -= dt;
    if (p.coyote > 0) p.coyote -= dt;

    if (p.buffer > 0 && (p.onGround || p.coyote > 0)) {
      p.vy = -TUNE.JUMP_V;
      p.onGround = false;
      p.coyote = 0;
      p.buffer = 0;
      p.squash = -0.35;
      st.stats.jumps++;
      emit(st, 'jump', {});
    }

    // --- 重力 ---
    var g = TUNE.GRAVITY;
    if (p.ducking && !p.onGround) g *= TUNE.FAST_FALL;
    p.vy += g * dt;
    if (p.vy > 190) p.vy = 190;

    var prevY = p.y;
    p.y += p.vy * dt;

    if (p.y >= TUNE.GROUND_Y) {
      p.y = TUNE.GROUND_Y;
      if (!p.onGround) {
        p.squash = 0.4;
        emit(st, 'land', {});
      }
      p.vy = 0;
      p.onGround = true;
      p.coyote = TUNE.COYOTE;
    } else {
      if (p.onGround) p.coyote = TUNE.COYOTE;
      p.onGround = false;
    }
    if (p.y < 0) { p.y = 0; p.vy = Math.max(p.vy, 0); }

    // --- 前进 ---
    st.distance += speed * dt;
    st.t += dt;
    st.player.runPhase += dt * (p.onGround ? speed * 0.42 : 6);
    if (st.player.squash > 0) st.player.squash = Math.max(0, st.player.squash - dt * 3.2);
    if (st.player.squash < 0) st.player.squash = Math.min(0, st.player.squash + dt * 3.2);
    if (p.invuln > 0) p.invuln -= dt;
    p.blink += dt;

    // --- 世界移动 ---
    var i;
    for (i = st.obstacles.length - 1; i >= 0; i--) {
      var o = st.obstacles[i];
      o.x -= speed * dt;
      if (o.x + o.w < -12) st.obstacles.splice(i, 1);
    }
    for (i = st.pickups.length - 1; i >= 0; i--) {
      var pk = st.pickups[i];
      pk.x -= speed * dt;
      pk.bob += dt * 3.4;
      if (pk.x + pk.w < -12 || pk.taken) st.pickups.splice(i, 1);
    }
  }

  /* ---------------------------- 碰撞 ---------------------------- */

  function checkCollisions(st) {
    var pb = playerBox(st);
    var p = st.player;

    for (var i = 0; i < st.obstacles.length; i++) {
      var o = st.obstacles[i];
      var ob = obstacleBox(o);
      if (aabb(pb.x, pb.y, pb.w, pb.h, ob.x, ob.y, ob.w, ob.h)) {
        if (o.hit) continue;
        o.hit = true;
        applyHit(st, o);
      }
    }

    for (var j = st.pickups.length - 1; j >= 0; j--) {
      var pk = st.pickups[j];
      if (pk.taken) continue;
      var m = TUNE.PICKUP_MAGNET;
      if (aabb(pb.x, pb.y, pb.w, pb.h, pk.x - m, pk.y - pk.h - m, pk.w + m * 2, pk.h + m * 2)) {
        pk.taken = true;
        applyPickup(st, pk);
      }
    }
  }

  function applyHit(st, o) {
    var p = st.player;
    if (p.invuln > 0) return;
    st.stats.hits++;
    st.shake = 0.4;
    if (st.shield > 0) {
      st.shield--;
      p.invuln = TUNE.SHIELD_INVULN;
      emit(st, 'shield', { message: '护盾挡住了！' });
      return;
    }
    st.hearts--;
    p.invuln = TUNE.INVULN_HIT;
    st.combo = 0;
    if (st.hearts <= 0) {
      st.hearts = 0;
      st.phase = 'over';
      emit(st, 'hit', { message: pickMessage(st, 'hit'), fatal: true, kind: o.kind });
      emit(st, 'gameover', {
        message: pickMessage(st, 'gameover'),
        distance: Math.floor(st.distance),
        level: st.level,
        score: st.score
      });
    } else {
      emit(st, 'hit', { message: pickMessage(st, 'hit'), fatal: false, kind: o.kind });
    }
  }

  function applyPickup(st, pk) {
    st.stats.pickups++;
    st.combo++;
    var xpGain = pk.xp;
    if (pk.kind === 'heart') {
      st.shield = Math.min(2, st.shield + 1);
      emit(st, 'pickup', { kind: 'heart', message: '护盾 +1 ♥', xp: 0 });
    } else if (pk.kind === 'noodle') {
      if (st.hearts < TUNE.HEARTS_MAX) {
        st.hearts++;
        emit(st, 'pickup', { kind: 'noodle', message: '牛肉面！回 1 颗心 🍜', xp: xpGain });
      } else {
        xpGain += 15;
        emit(st, 'pickup', { kind: 'noodle', message: '牛肉面！+40 XP 🍜', xp: xpGain });
      }
    } else if (pk.kind === 'letter') {
      st.word.progress++;
      emit(st, 'letter', { kind: 'letter', ch: pk.ch, message: pk.ch, xp: xpGain });
      var word = WORDS[st.word.index % WORDS.length];
      if (st.word.progress >= word.ru.length) {
        st.stats.words++;
        st.word.index = (st.word.index + 1) % WORDS.length;
        st.word.progress = 0;
        var nx = WORDS[st.word.index % WORDS.length];
        st.word.ru = nx.ru;
        st.word.zh = nx.zh;
        xpGain += 150;
        if (st.hearts < TUNE.HEARTS_MAX) st.hearts++;
        st.flash = 0.5;
        emit(st, 'word', {
          ru: word.ru, zh: word.zh,
          message: pickMessage(st, 'word'),
          xp: xpGain
        });
      }
    } else {
      emit(st, 'pickup', { kind: pk.kind, message: '+' + xpGain + ' XP', xp: xpGain });
    }
    addXp(st, xpGain);
  }

  function addXp(st, amount) {
    if (!(amount > 0)) return;
    st.xp += amount;
    st.bonus += Math.round(amount);
    var guard = 0;
    while (st.xp >= st.xpToNext && guard++ < 50) {
      st.xp -= st.xpToNext;
      levelUp(st);
    }
  }

  function levelUp(st) {
    st.level++;
    st.stats.levelUps++;
    st.xpToNext = xpForLevel(st.level);
    st.speed = speedForLevel(st.level);
    st.player.invuln = Math.max(st.player.invuln, TUNE.INVULN_LEVEL);
    st.flash = 0.6;
    var healed = false;
    if (st.level % TUNE.HEAL_EVERY_LEVELS === 0 && st.hearts < TUNE.HEARTS_MAX) {
      st.hearts++;
      healed = true;
    }
    emit(st, 'levelup', {
      level: st.level,
      title: levelTitle(st.level),
      message: pickMessage(st, 'levelup', { level: st.level }),
      healed: healed,
      speed: st.speed
    });
  }

  /* ---------------------------- 主循环 ---------------------------- */

  function step(st, dt, input) {
    input = input || {};
    if (st.events.length) st.events.length = 0;
    if (st.phase !== 'playing') {
      // 结束时仍让画面慢慢淡出：只推进计时器
      st.t += Math.min(dt || 0, 0.05);
      if (st.shake > 0) st.shake = Math.max(0, st.shake - dt * 2);
      if (st.flash > 0) st.flash = Math.max(0, st.flash - dt * 2.4);
      return st;
    }

    dt = clamp(dt || 0, 0, 0.05);
    var remaining = dt;
    var guard = 0;
    while (remaining > 1e-6 && guard++ < 12) {
      var h = Math.min(remaining, 1 / 90);
      integrate(st, h, input);
      checkCollisions(st);
      remaining -= h;
      if (st.phase !== 'playing') break;
    }

    // 距离换经验
    st.xpAccum += dt * st.speed * TUNE.XP_PER_UNIT;
    if (st.xpAccum >= 1) {
      var whole = Math.floor(st.xpAccum);
      st.xpAccum -= whole;
      addXp(st, whole);
    }

    // 生成
    if (st.distance >= st.spawn.nextObstacleAt) spawnPattern(st);
    if (st.distance >= st.spawn.nextPickupAt) spawnPickup(st);

    // 里程碑
    var ms = Math.floor(st.distance / TUNE.MILESTONE_STEP);
    if (ms > st.milestone) {
      st.milestone = ms;
      st.bonus += 30;
      emit(st, 'milestone', {
        distance: ms * TUNE.MILESTONE_STEP,
        message: pickMessage(st, 'milestone', { dist: ms * TUNE.MILESTONE_STEP })
      });
    }

    if (st.shake > 0) st.shake = Math.max(0, st.shake - dt * 2);
    if (st.flash > 0) st.flash = Math.max(0, st.flash - dt * 2.4);
    if (st.slowmo > 0) st.slowmo = Math.max(0, st.slowmo - dt);

    st.score = Math.floor(st.distance) + st.bonus;
    return st;
  }

  /* ------------------------- 给测试/渲染用的小工具 ------------------------- */

  function skyMood(level) {
    var idx = Math.floor((level - 1) / 4) % SKY_MOODS.length;
    return SKY_MOODS[idx];
  }

  function nearestObstacle(st) {
    var best = null;
    for (var i = 0; i < st.obstacles.length; i++) {
      var o = st.obstacles[i];
      if (o.x + o.w < st.player.x) continue;
      if (!best || o.x < best.x) best = o;
    }
    return best;
  }

  return {
    TUNE: TUNE,
    PALETTE: PALETTE,
    SKY_MOODS: SKY_MOODS,
    OBSTACLES: OBSTACLES,
    PICKUPS: PICKUPS,
    WORDS: WORDS,
    LEVEL_TITLES: LEVEL_TITLES,
    MESSAGES: MESSAGES,
    PATTERNS: PATTERNS,
    FLY_BOTTOM: FLY_BOTTOM,
    makeState: makeState,
    resetRun: resetRun,
    step: step,
    emit: emit,
    addXp: addXp,
    levelUp: levelUp,
    levelTitle: levelTitle,
    speedForLevel: speedForLevel,
    xpForLevel: xpForLevel,
    skyMood: skyMood,
    nearestObstacle: nearestObstacle,
    playerBox: playerBox,
    obstacleBox: obstacleBox,
    aabb: aabb,
    clamp: clamp,
    lerp: lerp,
    mulberry32: mulberry32,
    pickMessage: pickMessage
  };
});
