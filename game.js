/*!
 * 《自怡向前冲》 ZiYi Run — game.js
 * 渲染 / 输入 / 音效 / 存档。逻辑在 core.js。
 */
(function () {
  'use strict';

  var Core = window.ZiyiCore;
  if (!Core) { console.error('[ziyi] core.js 没有加载'); return; }
  var T = Core.TUNE;
  var PAL = Core.PALETTE;

  /* ============================ DOM ============================ */

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d', { alpha: false });
  var el = {
    level: document.getElementById('hud-level'),
    levelTitle: document.getElementById('hud-level-title'),
    xpFill: document.getElementById('hud-xp-fill'),
    hearts: document.getElementById('hud-hearts'),
    dist: document.getElementById('hud-dist'),
    score: document.getElementById('hud-score'),
    banner: document.getElementById('banner'),
    card: document.getElementById('word-card'),
    duck: document.getElementById('btn-duck'),
    mute: document.getElementById('btn-mute'),
    start: document.getElementById('screen-start'),
    over: document.getElementById('screen-over'),
    best: document.getElementById('start-best'),
    startBtn: document.getElementById('btn-start'),
    againBtn: document.getElementById('btn-again'),
    shareBtn: document.getElementById('btn-share'),
    howBtn: document.getElementById('btn-how'),
    how: document.getElementById('how'),
    overStats: document.getElementById('over-stats'),
    overMsg: document.getElementById('over-msg'),
    overTitle: document.getElementById('over-title'),
    hint: document.getElementById('hint'),
    greeting: document.getElementById('start-greeting'),
    overlay: document.getElementById('overlay'),
    wordBar: document.getElementById('word-bar'),
    wordNow: document.getElementById('word-now')
  };

  /* ============================ 存档 ============================ */

  var SAVE_KEY = 'ziyi-run-v1';
  var save = {
    best: 0, bestLevel: 1, bestDistance: 0, totalDistance: 0,
    runs: 0, wordsCollected: 0, muted: false, music: true
  };
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      for (var k in save) if (Object.prototype.hasOwnProperty.call(parsed, k)) save[k] = parsed[k];
    }
  } catch (e) { /* 隐私模式下 localStorage 可能不可用 */ }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
  }

  /* ============================ 视图 ============================ */

  var view = { cssW: 360, cssH: 640, dpr: 1, u: 6.4, worldW: 46, worldH: 100 };
  var skyGrad = null, groundGrad = null, trackGrad = null, sunGrad = null;
  var scrollX = 0;
  var petals = [];
  var sparkles = [];

  function resize() {
    var rect = stage.getBoundingClientRect();
    var cssW = Math.max(240, Math.round(rect.width || window.innerWidth));
    var cssH = Math.max(320, Math.round(rect.height || window.innerHeight));
    view.cssW = cssW;
    view.cssH = cssH;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);   // 手机上 2x 已经很清晰，省一点性能
    view.u = cssH / T.WORLD_H;
    canvas.width = Math.round(cssW * view.dpr);
    canvas.height = Math.round(cssH * view.dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    state.world.h = T.WORLD_H;
    state.world.w = cssW / view.u;
    view.worldW = state.world.w;
    view.worldH = state.world.h;
    var newX = Core.clamp(state.world.w * T.PLAYER_X_RATIO, T.PLAYER_X_MIN, T.PLAYER_X_MAX);
    if (state.phase === 'playing' && Math.abs(newX - state.player.x) > 1.5) {
      state.player.invuln = Math.max(state.player.invuln, 0.9);   // 旋转屏幕后别被瞬移撞死
    }
    state.player.x = newX;

    glowCache = {};
    buildGradients();
    seedPetals();
  }

  function buildGradients() {
    var mood = Core.skyMood(state.level);
    skyGrad = ctx.createLinearGradient(0, 0, 0, view.cssH * 0.8);
    skyGrad.addColorStop(0, mood.top);
    skyGrad.addColorStop(0.55, mood.bottom);
    skyGrad.addColorStop(1, PAL.grassTop);

    groundGrad = ctx.createLinearGradient(0, view.cssH * 0.72, 0, view.cssH);
    groundGrad.addColorStop(0, PAL.grassTop);
    groundGrad.addColorStop(1, PAL.grassBottom);

    trackGrad = ctx.createLinearGradient(0, view.cssH * 0.72, 0, view.cssH * 0.86);
    trackGrad.addColorStop(0, '#FFE3EF');
    trackGrad.addColorStop(1, '#FFD0E2');

    sunGrad = ctx.createRadialGradient(
      view.cssW * 0.78, view.cssH * 0.14, 0,
      view.cssW * 0.78, view.cssH * 0.14, view.cssH * 0.42);
    sunGrad.addColorStop(0, 'rgba(255,244,214,0.95)');
    sunGrad.addColorStop(0.45, 'rgba(255,226,240,0.35)');
    sunGrad.addColorStop(1, 'rgba(255,226,240,0)');
  }

  function seedPetals() {
    petals = [];
    for (var i = 0; i < 22; i++) {
      petals.push({
        x: Math.random() * (view.cssW / view.u + 20) - 10,
        y: -10 + Math.random() * 120,
        s: 0.35 + Math.random() * 0.55,
        vy: 2.4 + Math.random() * 3.6,
        sway: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 2.4,
        a: 0.35 + Math.random() * 0.5
      });
    }
  }

  /* ============================ 音频 ============================ */

  var Sound = (function () {
    var ac = null, master = null, musicGain = null, sfxGain = null;
    var started = false;
    var nextNoteTime = 0, noteIndex = 0;

    function ensure() {
      if (ac) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { ac = new AC(); } catch (e) { return false; }
      master = ac.createGain();
      master.gain.value = save.muted ? 0 : 1;
      master.connect(ac.destination);
      sfxGain = ac.createGain();
      sfxGain.gain.value = 0.3;
      sfxGain.connect(master);
      musicGain = ac.createGain();
      musicGain.gain.value = save.music ? 0.14 : 0;
      musicGain.connect(master);
      return true;
    }

    function resume() {
      if (!ensure()) return;
      if (ac.state === 'suspended') ac.resume();
      started = true;
      nextNoteTime = ac.currentTime + 0.1;
    }

    function tone(freq, when, dur, type, gain, dest, detune) {
      if (!ac) return;
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      if (detune) o.detune.value = detune;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gain, when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g);
      g.connect(dest || sfxGain);
      o.start(when);
      o.stop(when + dur + 0.02);
    }

    function noise(when, dur, freq, gain) {
      if (!ac) return;
      var len = Math.max(1, Math.floor(ac.sampleRate * dur));
      var buf = ac.createBuffer(1, len, ac.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ac.createBufferSource();
      src.buffer = buf;
      var f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      var g = ac.createGain();
      g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(sfxGain);
      src.start(when);
    }

    var PENTA = [0, 2, 4, 7, 9];

    return {
      unlock: resume,
      isOn: function () { return started; },
      debug: function () {
        return { hasContext: !!ac, state: ac ? ac.state : 'none', muted: !!save.muted, music: !!save.music };
      },
      setMuted: function (m) {
        save.muted = m;
        if (master) master.gain.value = m ? 0 : 1;
      },
      setMusic: function (on) {
        save.music = on;
        if (musicGain) musicGain.gain.value = on ? 0.14 : 0;
      },
      jump: function () {
        if (!ac) return;
        var t = ac.currentTime;
        tone(520, t, 0.16, 'sine', 0.22);
        tone(780, t + 0.02, 0.14, 'triangle', 0.1);
      },
      land: function () {
        if (!ac) return;
        noise(ac.currentTime, 0.09, 420, 0.16);
      },
      pickup: function (step) {
        if (!ac) return;
        var t = ac.currentTime;
        var semi = PENTA[(step || 0) % PENTA.length];
        var f = 660 * Math.pow(2, semi / 12);
        tone(f, t, 0.28, 'triangle', 0.2);
        tone(f * 2, t + 0.01, 0.18, 'sine', 0.07);
      },
      letter: function (step) {
        if (!ac) return;
        var t = ac.currentTime;
        var f = 523.25 * Math.pow(2, PENTA[(step || 0) % PENTA.length] / 12);
        tone(f, t, 0.34, 'triangle', 0.22);
        tone(f * 1.5, t, 0.22, 'sine', 0.08);
      },
      levelUp: function () {
        if (!ac) return;
        var t = ac.currentTime;
        var notes = [523.25, 659.25, 783.99, 1046.5];
        for (var i = 0; i < notes.length; i++) {
          tone(notes[i], t + i * 0.09, 0.5, 'triangle', 0.2);
          tone(notes[i] * 2, t + i * 0.09, 0.3, 'sine', 0.05);
        }
      },
      word: function () {
        if (!ac) return;
        var t = ac.currentTime;
        var notes = [659.25, 783.99, 987.77, 1318.5, 1567.98];
        for (var i = 0; i < notes.length; i++) tone(notes[i], t + i * 0.07, 0.55, 'sine', 0.16);
      },
      hit: function () {
        if (!ac) return;
        var t = ac.currentTime;
        tone(300, t, 0.22, 'sine', 0.24);
        tone(180, t + 0.05, 0.3, 'triangle', 0.18);
        noise(t, 0.14, 300, 0.2);
      },
      over: function () {
        if (!ac) return;
        var t = ac.currentTime;
        var notes = [523.25, 440, 349.23];
        for (var i = 0; i < notes.length; i++) tone(notes[i], t + i * 0.16, 0.7, 'triangle', 0.16);
      },
      /* 背景音乐：钢琴感的琶音循环，I–V–vi–IV */
      tick: function () {
        if (!ac || !save.music || save.muted) return;
        var now = ac.currentTime;
        if (nextNoteTime < now) nextNoteTime = now + 0.05;
        while (nextNoteTime < now + 0.4) {
          var bar = Math.floor(noteIndex / 8) % 4;
          var roots = [349.23, 392.0, 440.0, 261.63];  // F  G  A  C
          var root = roots[bar];
          var arp = [0, 4, 7, 12, 7, 4, 0, 7];
          var f = root * Math.pow(2, arp[noteIndex % 8] / 12);
          tone(f, nextNoteTime, 0.9, 'triangle', 0.075, musicGain);
          tone(f * 2.01, nextNoteTime, 0.5, 'sine', 0.02, musicGain);
          if (noteIndex % 8 === 0) {
            tone(root / 2, nextNoteTime, 2.4, 'sine', 0.05, musicGain);
          }
          nextNoteTime += 0.34;
          noteIndex++;
        }
      }
    };
  })();

  /* ============================ 状态 ============================ */

  var state = Core.makeState({ seed: (Math.random() * 1e9) | 0 });
  var input = { jump: false, jumpPressed: false, duck: false };
  var paused = false;
  var frozen = false;            // 仅测试用：冻结逻辑，只渲染
  var bannerTimer = 0;
  var hintTimer = 0;
  var bestBeaten = false;
  var lastHud = { level: -1, dist: -1, score: -1, hearts: -1, xp: -1, shield: -1 };

  /* ============================ 工具 ============================ */

  function rr(c, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.closePath(); }

  function hash(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* ============================ 角色 ============================ */

  function drawLeg(c, phase, back) {
    var sw = Math.sin(phase) * 1.7;
    var hipX = back ? -0.5 : 0.5, hipY = -4.4;
    var kneeX = hipX + sw * 0.55, kneeY = hipY + 1.85 + Math.abs(sw) * 0.15;
    var footX = hipX + sw * 1.05, footY = -0.5;
    c.lineCap = 'round';
    c.strokeStyle = back ? '#F2C4A8' : PAL.skin;
    c.lineWidth = 1.15;
    c.beginPath(); c.moveTo(hipX, hipY); c.lineTo(kneeX, kneeY); c.stroke();
    c.beginPath(); c.moveTo(kneeX, kneeY); c.lineTo(footX, footY); c.stroke();
    // 跑鞋
    c.save();
    c.translate(footX, footY + 0.15);
    c.rotate(sw * 0.12);
    c.fillStyle = back ? '#F0F0F0' : '#FFFFFF';
    rr(c, -0.95, -0.75, 2.1, 1.35, 0.6); c.fill();
    c.fillStyle = PAL.pink;
    rr(c, -0.95, 0.05, 2.1, 0.55, 0.28); c.fill();
    c.restore();
  }

  function drawArm(c, phase, back) {
    var sw = Math.sin(phase + Math.PI) * 1.5;
    var sx = back ? -1.5 : 1.5, sy = -7.2;
    var ex = sx + sw * 0.9, ey = sy + 1.5;
    var hx = sx + sw * 1.7, hy = sy + 2.4;
    c.lineCap = 'round';
    c.strokeStyle = back ? '#F2C4A8' : PAL.skin;
    c.lineWidth = 0.95;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.lineTo(hx, hy); c.stroke();
    c.fillStyle = back ? '#F2C4A8' : PAL.skin;
    circle(c, hx, hy, 0.55); c.fill();
  }

  function drawHead(c, t, mood) {
    var bob = Math.sin(t * 2) * 0.12;
    var hx = 0, hy = -9.85 + bob;
    // 后发
    c.fillStyle = PAL.hair;
    c.beginPath();
    c.ellipse(hx, hy + 0.2, 2.75, 2.6, 0, 0, Math.PI * 2);
    c.fill();
    // 马尾
    var sway = Math.sin(t * 3.1) * 0.55;
    c.beginPath();
    c.moveTo(hx - 1.6, hy - 0.6);
    c.quadraticCurveTo(hx - 4.4 + sway, hy - 1.6, hx - 5.2 + sway * 1.4, hy + 1.6);
    c.quadraticCurveTo(hx - 3.6 + sway, hy + 1.2, hx - 1.9, hy + 0.9);
    c.closePath();
    c.fill();
    // 发带
    c.fillStyle = PAL.pink;
    c.beginPath();
    c.ellipse(hx - 2.3, hy - 0.9, 1.05, 0.72, -0.5, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(hx - 3.3, hy - 0.2, 0.75, 0.5, -0.9, 0, Math.PI * 2);
    c.fill();
    // 脸
    c.fillStyle = PAL.skin;
    circle(c, hx, hy + 0.35, 2.15); c.fill();
    // 刘海
    c.fillStyle = PAL.hair;
    c.beginPath();
    c.moveTo(hx - 2.2, hy - 0.1);
    c.quadraticCurveTo(hx - 1.6, hy - 2.5, hx + 0.4, hy - 2.3);
    c.quadraticCurveTo(hx + 2.1, hy - 2.2, hx + 2.2, hy - 0.4);
    c.quadraticCurveTo(hx + 1.2, hy - 1.5, hx - 0.1, hy - 1.5);
    c.quadraticCurveTo(hx - 1.4, hy - 1.5, hx - 2.2, hy - 0.1);
    c.closePath();
    c.fill();
    // 眼睛
    c.fillStyle = '#5B3A45';
    var blink = (t % 4.2) > 4.05;
    if (blink || mood === 'happy') {
      c.strokeStyle = '#5B3A45'; c.lineWidth = 0.28; c.lineCap = 'round';
      c.beginPath(); c.moveTo(hx - 1.25, hy + 0.35); c.lineTo(hx - 0.45, hy + 0.35); c.stroke();
      c.beginPath(); c.moveTo(hx + 0.45, hy + 0.35); c.lineTo(hx + 1.25, hy + 0.35); c.stroke();
    } else {
      circle(c, hx - 0.85, hy + 0.4, 0.34); c.fill();
      circle(c, hx + 0.85, hy + 0.4, 0.34); c.fill();
      c.fillStyle = '#FFFFFF';
      circle(c, hx - 0.73, hy + 0.28, 0.12); c.fill();
      circle(c, hx + 0.97, hy + 0.28, 0.12); c.fill();
    }
    // 腮红
    c.fillStyle = 'rgba(255,140,175,0.45)';
    circle(c, hx - 1.55, hy + 1.05, 0.5); c.fill();
    circle(c, hx + 1.55, hy + 1.05, 0.5); c.fill();
    // 嘴
    c.strokeStyle = '#B95C7A'; c.lineWidth = 0.26; c.lineCap = 'round';
    c.beginPath();
    c.arc(hx, hy + 0.85, 0.55, 0.25, Math.PI - 0.25);
    c.stroke();
  }

  function drawBody(c, phase) {
    // 裙子
    c.fillStyle = PAL.pink;
    c.beginPath();
    c.moveTo(-2.0, -7.6);
    c.quadraticCurveTo(-3.3, -5.4, -3.1, -3.3);
    c.quadraticCurveTo(0, -2.5, 3.1, -3.3);
    c.quadraticCurveTo(3.3, -5.4, 2.0, -7.6);
    c.closePath();
    c.fill();
    // 裙子亮面
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath();
    c.moveTo(-0.4, -7.4);
    c.quadraticCurveTo(-1.6, -5.2, -1.4, -3.4);
    c.quadraticCurveTo(0, -3.0, 0.7, -3.4);
    c.quadraticCurveTo(0.7, -5.4, 0.4, -7.4);
    c.closePath();
    c.fill();
    // 领口
    c.fillStyle = '#FFFFFF';
    c.beginPath();
    c.ellipse(0, -7.55, 1.35, 0.55, 0, 0, Math.PI * 2);
    c.fill();
    // 腰间小蝴蝶结
    c.fillStyle = '#FF6FA5';
    circle(c, 0, -5.0, 0.42); c.fill();
  }

  function drawPlayer(c, p, t) {
    if (p.invuln > 0 && Math.floor(p.invuln * 14) % 2 === 0 && st_isPlaying()) {
      c.globalAlpha = 0.45;
    }
    var phase = p.runPhase;
    var squash = p.squash;
    c.save();
    c.translate(0, squash * 1.1);
    c.scale(1 - squash * 0.35, 1 + squash * 0.35);

    if (p.ducking) {
      // 蹲下 / 滑行
      c.save();
      c.translate(0.6, 0);
      c.fillStyle = PAL.skin;
      c.beginPath(); c.ellipse(-0.2, -3.2, 2.5, 2.0, 0.15, 0, Math.PI * 2); c.fill();
      c.fillStyle = PAL.pink;
      c.beginPath();
      c.moveTo(-3.4, -3.4);
      c.quadraticCurveTo(-1.0, -6.0, 1.9, -4.6);
      c.quadraticCurveTo(2.4, -2.6, 0.4, -1.6);
      c.quadraticCurveTo(-1.8, -1.2, -3.4, -3.4);
      c.closePath(); c.fill();
      // 腿
      c.strokeStyle = PAL.skin; c.lineWidth = 1.15; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-1.2, -2.4); c.lineTo(-2.6, -0.9); c.stroke();
      c.beginPath(); c.moveTo(-0.2, -2.2); c.lineTo(-1.4, -0.7); c.stroke();
      c.fillStyle = '#FFFFFF';
      rr(c, -3.5, -1.2, 2.1, 1.3, 0.6); c.fill();
      // 头
      c.save();
      c.translate(2.0, -4.4);
      c.rotate(0.18);
      c.fillStyle = PAL.hair;
      c.beginPath(); c.ellipse(-0.5, 0.2, 2.5, 2.35, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = PAL.skin;
      circle(c, 0.25, 0.3, 1.95); c.fill();
      c.fillStyle = PAL.hair;
      c.beginPath();
      c.moveTo(-1.9, 0.1); c.quadraticCurveTo(-1.2, -2.2, 0.6, -2.0);
      c.quadraticCurveTo(2.0, -1.8, 2.0, -0.1);
      c.quadraticCurveTo(0.6, -1.3, -1.9, 0.1); c.closePath(); c.fill();
      c.fillStyle = '#5B3A45';
      circle(c, 0.35, 0.45, 0.3); c.fill();
      circle(c, 1.55, 0.45, 0.3); c.fill();
      c.fillStyle = 'rgba(255,140,175,0.45)';
      circle(c, 1.9, 1.15, 0.45); c.fill();
      c.restore();
      c.restore();
    } else if (!p.onGround) {
      // 跳跃
      drawLeg(c, phase, true);
      drawLeg(c, phase, false);
      drawArm(c, phase, true);
      drawBody(c, phase);
      drawArm(c, phase, false);
      drawHead(c, t, 'happy');
      // 跳起来时腿收起来一点
      c.fillStyle = PAL.pink;
      circle(c, -1.2, -3.0, 0.9); c.fill();
    } else {
      drawLeg(c, phase, true);
      drawLeg(c, phase, false);
      drawArm(c, phase, true);
      drawBody(c, phase);
      drawArm(c, phase, false);
      drawHead(c, t, 'run');
    }
    c.restore();
    c.globalAlpha = 1;
  }

  function st_isPlaying() { return state.phase === 'playing'; }

  /* ============================ 障碍物 ============================ */

  function drawPiano(c, w, h) {
    c.fillStyle = '#B9A3F5';
    rr(c, -w / 2, -h, w, h, 1.1); c.fill();
    c.fillStyle = '#DED2FF';
    rr(c, -w / 2 + 0.6, -h + 0.7, w - 1.2, h - 3.2, 0.7); c.fill();
    // 键盘
    c.fillStyle = '#FFFFFF';
    rr(c, -w / 2 + 0.5, -3.5, w - 1.0, 2.3, 0.3); c.fill();
    c.fillStyle = '#7A6A8F';
    for (var i = 0; i < 6; i++) {
      var x = -w / 2 + 1.2 + i * ((w - 2.4) / 6);
      c.fillRect(x, -3.5, 0.42, 1.35);
    }
    // 谱架
    c.fillStyle = '#B49BFF';
    rr(c, -w / 2 + 1.1, -h + 1.1, w - 2.2, 1.5, 0.3); c.fill();
    // 音符装饰
    c.fillStyle = '#FFFFFF';
    c.font = 'bold 2.1px -apple-system, system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('♪', 0, -h + 2.1);
    // 脚轮
    c.fillStyle = '#9C87C9';
    circle(c, -w / 2 + 1.1, -0.6, 0.6); c.fill();
    circle(c, w / 2 - 1.1, -0.6, 0.6); c.fill();
  }

  function drawBasket(c, w, h) {
    c.fillStyle = '#E8C9A0';
    c.beginPath();
    c.moveTo(-w / 2, -h);
    c.lineTo(w / 2, -h);
    c.lineTo(w / 2 - 0.9, 0);
    c.lineTo(-w / 2 + 0.9, 0);
    c.closePath(); c.fill();
    c.strokeStyle = '#D3AE83'; c.lineWidth = 0.28;
    for (var i = 1; i < 5; i++) {
      var y = -h + (h / 5) * i;
      c.beginPath(); c.moveTo(-w / 2 + 0.2, y); c.lineTo(w / 2 - 0.2, y); c.stroke();
    }
    c.fillStyle = '#F6E2C6';
    rr(c, -w / 2, -h - 0.7, w, 1.1, 0.5); c.fill();
    // 网球
    var balls = [[-1.9, -h - 1.9], [0, -h - 2.5], [1.9, -h - 1.9]];
    for (var b = 0; b < balls.length; b++) {
      c.fillStyle = '#DDF58C';
      circle(c, balls[b][0], balls[b][1], 1.25); c.fill();
      c.strokeStyle = '#C4E070'; c.lineWidth = 0.24;
      c.beginPath();
      c.arc(balls[b][0], balls[b][1], 1.25, -0.6, 0.6); c.stroke();
    }
  }

  function drawSuitcase(c, w, h) {
    c.fillStyle = '#FFB3D1';
    rr(c, -w / 2, -h, w, h, 0.9); c.fill();
    c.fillStyle = '#FFC9DE';
    rr(c, -w / 2 + 0.55, -h + 0.6, w - 1.1, h - 1.2, 0.6); c.fill();
    c.strokeStyle = '#FF8FB8'; c.lineWidth = 0.42;
    c.beginPath(); c.moveTo(-w / 2 + 0.3, -h * 0.62); c.lineTo(w / 2 - 0.3, -h * 0.62); c.stroke();
    c.beginPath(); c.moveTo(-w / 2 + 0.3, -h * 0.34); c.lineTo(w / 2 - 0.3, -h * 0.34); c.stroke();
    // 拉杆
    c.strokeStyle = '#D89BB5'; c.lineWidth = 0.42;
    c.beginPath(); c.moveTo(-1.1, -h); c.lineTo(-1.1, -h - 1.5); c.stroke();
    c.beginPath(); c.moveTo(1.1, -h); c.lineTo(1.1, -h - 1.5); c.stroke();
    c.beginPath(); c.moveTo(-1.1, -h - 1.5); c.lineTo(1.1, -h - 1.5); c.stroke();
    // 贴纸
    c.fillStyle = '#FFF3B0';
    circle(c, -1.5, -h * 0.78, 0.62); c.fill();
    c.fillStyle = '#B8E8D0';
    circle(c, 1.5, -h * 0.2, 0.5); c.fill();
  }

  function drawNoodle(c, w, h, t) {
    // 碗
    c.fillStyle = '#FFFFFF';
    c.beginPath();
    c.moveTo(-w / 2, -h * 0.62);
    c.quadraticCurveTo(-w / 2 + 0.4, 0.2, 0, 0.2);
    c.quadraticCurveTo(w / 2 - 0.4, 0.2, w / 2, -h * 0.62);
    c.closePath(); c.fill();
    c.strokeStyle = PAL.pink; c.lineWidth = 0.42;
    c.beginPath();
    c.moveTo(-w / 2 + 0.2, -h * 0.5);
    c.quadraticCurveTo(0, -h * 0.22, w / 2 - 0.2, -h * 0.5);
    c.stroke();
    // 汤面
    c.fillStyle = '#F6D9A8';
    c.beginPath();
    c.ellipse(0, -h * 0.62, w / 2 - 0.1, h * 0.2, 0, 0, Math.PI * 2);
    c.fill();
    // 面 + 牛肉
    c.strokeStyle = '#FFF0CE'; c.lineWidth = 0.34;
    for (var i = 0; i < 3; i++) {
      c.beginPath();
      c.arc(-1.4 + i * 1.5, -h * 0.62, 0.85, 0.2, Math.PI - 0.2);
      c.stroke();
    }
    c.fillStyle = '#C9736B';
    rr(c, -1.5, -h * 0.72, 1.5, 0.85, 0.28); c.fill();
    rr(c, 0.5, -h * 0.7, 1.3, 0.8, 0.26); c.fill();
    // 葱花
    c.fillStyle = '#A9E6C6';
    circle(c, -0.4, -h * 0.55, 0.24); c.fill();
    circle(c, 1.3, -h * 0.52, 0.22); c.fill();
    // 筷子
    c.strokeStyle = '#D9A066'; c.lineWidth = 0.3;
    c.beginPath(); c.moveTo(-1.6, -h * 0.95); c.lineTo(2.2, -h * 1.35); c.stroke();
    c.beginPath(); c.moveTo(-1.3, -h * 0.8); c.lineTo(2.4, -h * 1.16); c.stroke();
    // 热气
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 0.34; c.lineCap = 'round';
    for (var s = 0; s < 2; s++) {
      var off = Math.sin(t * 2 + s * 2) * 0.5;
      c.beginPath();
      c.moveTo(-1.1 + s * 2.2 + off, -h * 1.05);
      c.quadraticCurveTo(-1.6 + s * 2.2 + off, -h * 1.5, -1.1 + s * 2.2 + off, -h * 1.95);
      c.stroke();
    }
  }

  function drawTripod(c, w, h, t) {
    // 三脚架
    c.strokeStyle = '#B9A7C9'; c.lineWidth = 0.55; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, -h + 2.6); c.lineTo(-w / 2, 0); c.stroke();
    c.beginPath(); c.moveTo(0, -h + 2.6); c.lineTo(w / 2, 0); c.stroke();
    c.beginPath(); c.moveTo(0, -h + 2.6); c.lineTo(0, 0); c.stroke();
    // 相机
    c.fillStyle = '#8E7AA8';
    rr(c, -w / 2 - 1.4, -h, (w / 2 + 1.4) * 2, 3.4, 0.7); c.fill();
    c.fillStyle = '#A895C2';
    rr(c, -w / 2 - 1.1, -h + 0.4, (w / 2 + 1.1) * 2, 1.5, 0.4); c.fill();
    // 镜头
    c.fillStyle = '#6B5A82';
    circle(c, 0.2, -h + 1.7, 1.15); c.fill();
    c.fillStyle = '#CFE8FF';
    circle(c, 0.2, -h + 1.7, 0.62); c.fill();
    // 录制红点
    c.fillStyle = Math.sin(t * 6) > 0 ? '#FF5C7A' : '#FF9EB1';
    circle(c, -w / 2 - 0.9, -h + 0.9, 0.38); c.fill();
  }

  function drawShoe(c, w, h) {
    c.fillStyle = '#FFFFFF';
    c.beginPath();
    c.moveTo(-w / 2, 0);
    c.lineTo(-w / 2 + 0.5, -h);
    c.quadraticCurveTo(-1.2, -h - 0.4, 0.4, -h + 0.2);
    c.quadraticCurveTo(w / 2 - 0.4, -h * 0.5, w / 2, -0.9);
    c.quadraticCurveTo(w / 2 - 0.2, 0, -w / 2, 0);
    c.closePath(); c.fill();
    c.fillStyle = PAL.pink;
    rr(c, -w / 2, -0.95, w, 1.0, 0.42); c.fill();
    c.strokeStyle = '#FF8FB8'; c.lineWidth = 0.42; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-1.6, -h * 0.62);
    c.quadraticCurveTo(0.6, -h * 0.32, 2.0, -h * 0.55);
    c.stroke();
    c.strokeStyle = '#D8D8E4'; c.lineWidth = 0.3;
    c.beginPath(); c.moveTo(-2.4, -h * 0.72); c.lineTo(-0.4, -h * 0.72); c.stroke();
  }

  function drawNoteObstacle(c, w, h, t) {
    c.fillStyle = '#B49BFF';
    var wob = Math.sin(t * 4) * 0.25;
    c.save();
    c.translate(0, wob);
    c.beginPath();
    c.ellipse(-w * 0.18, h * 0.28 - h, w * 0.28, w * 0.22, -0.4, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(w * 0.2, h * 0.42 - h, w * 0.26, w * 0.2, -0.4, 0, Math.PI * 2);
    c.fill();
    c.fillRect(w * 0.02, -h, 0.55, h * 0.75);
    c.fillRect(w * 0.36, -h + 0.5, 0.55, h * 0.7);
    c.fillRect(w * 0.02, -h, w * 0.4, 0.75);
    c.restore();
  }

  function drawBall(c, w, h) {
    c.fillStyle = '#DDF58C';
    circle(c, 0, -h / 2, w / 2); c.fill();
    c.strokeStyle = '#C4E070'; c.lineWidth = 0.34;
    c.beginPath(); c.arc(0, -h / 2, w / 2, -1.0, -0.2); c.stroke();
    c.beginPath(); c.arc(0, -h / 2, w / 2, 0.2, 1.0); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.7)';
    circle(c, -w * 0.18, -h * 0.66, w * 0.14); c.fill();
  }

  function drawBook(c, w, h) {
    c.fillStyle = '#9BC7F0';
    rr(c, -w / 2, -h, w, h, 0.4); c.fill();
    c.fillStyle = '#FFFFFF';
    rr(c, -w / 2 + 0.35, -h + 0.35, w - 0.7, h - 0.7, 0.25); c.fill();
    c.fillStyle = '#4E7FB0';
    c.font = 'bold 2.0px -apple-system, system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('РУ', 0, -h / 2);
    c.fillStyle = '#9BC7F0';
    c.fillRect(-w / 2, -h * 0.18, w, 0.3);
  }

  function drawBird(c, w, h, t) {
    var flap = Math.sin(t * 9) * 0.5;
    c.fillStyle = '#9FD2F5';
    c.beginPath();
    c.ellipse(0, -h * 0.5, w * 0.34, h * 0.36, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#84BEE8';
    c.beginPath();
    c.moveTo(-w * 0.1, -h * 0.6);
    c.quadraticCurveTo(-w * 0.6, -h * (1.1 + flap), -w * 0.05, -h * 0.35);
    c.closePath(); c.fill();
    c.fillStyle = '#FFFFFF';
    circle(c, w * 0.18, -h * 0.62, 0.4); c.fill();
    c.fillStyle = '#5B3A45';
    circle(c, w * 0.2, -h * 0.62, 0.22); c.fill();
    c.fillStyle = '#FFC9A8';
    c.beginPath();
    c.moveTo(w * 0.34, -h * 0.56);
    c.lineTo(w * 0.5, -h * 0.48);
    c.lineTo(w * 0.34, -h * 0.42);
    c.closePath(); c.fill();
  }

  function drawObstacle(c, o, t) {
    c.save();
    c.translate(o.x + o.w / 2, o.y);
    var w = o.w, h = o.h;
    // 所有障碍都带一层柔和投影 —— 粉底上的粉障碍才不会糊在一起
    c.shadowColor = o.fly ? 'rgba(150,70,110,0.55)' : 'rgba(150,70,110,0.42)';
    c.shadowBlur = o.fly ? 2.6 : 2.0;
    c.shadowOffsetY = 0.5;
    switch (o.kind) {
      case 'piano': drawPiano(c, w, h); break;
      case 'basket': drawBasket(c, w, h); break;
      case 'suitcase': drawSuitcase(c, w, h); break;
      case 'noodle': drawNoodle(c, w, h, t + o.wobble); break;
      case 'tripod': drawTripod(c, w, h, t + o.wobble); break;
      case 'shoe': drawShoe(c, w, h); break;
      case 'note': drawNoteObstacle(c, w, h, t + o.wobble); break;
      case 'ball': drawBall(c, w, h); break;
      case 'book': drawBook(c, w, h); break;
      case 'bird': drawBird(c, w, h, t + o.wobble); break;
      default: c.fillStyle = PAL.pink; rr(c, -w / 2, -h, w, h, 0.8); c.fill();
    }
    c.restore();
  }

  /* ============================ 道具 ============================ */

  function drawHeart(c, s, color) {
    c.fillStyle = color || PAL.pink;
    c.beginPath();
    c.moveTo(0, s * 0.32);
    c.bezierCurveTo(-s * 0.6, -s * 0.25, -s * 0.36, -s * 0.8, 0, -s * 0.34);
    c.bezierCurveTo(s * 0.36, -s * 0.8, s * 0.6, -s * 0.25, 0, s * 0.32);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.75)';
    circle(c, -s * 0.2, -s * 0.28, s * 0.1); c.fill();
  }

  var glowCache = {};

  function glowGradient(c, r) {
    var key = r.toFixed(2);
    if (!glowCache[key]) {
      var g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      glowCache[key] = g;
    }
    return glowCache[key];
  }

  function drawPickup(c, pk, t) {
    var bob = Math.sin(pk.bob) * 0.5;
    c.save();
    c.translate(pk.x + pk.w / 2, pk.y - pk.h / 2 + bob);
    c.scale(1.18, 1.18);
    // 光晕（缓存渐变，避免每帧新建对象）
    c.fillStyle = glowGradient(c, pk.w * 1.5);
    circle(c, 0, 0, pk.w * 1.5); c.fill();
    // 白色光圈，让道具在粉色背景上更醒目
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 0.42;
    circle(c, 0, 0, pk.w * 0.82); c.stroke();

    if (pk.kind === 'heart') {
      drawHeart(c, pk.w * 0.95, '#FF6FA5');
    } else if (pk.kind === 'noodle') {
      c.fillStyle = '#FFFFFF';
      c.beginPath();
      c.moveTo(-2.1, -0.6); c.quadraticCurveTo(0, 2.3, 2.1, -0.6); c.closePath(); c.fill();
      c.strokeStyle = PAL.pink; c.lineWidth = 0.34;   // 粉边，白碗在粉跑道上才看得清
      c.beginPath();
      c.moveTo(-2.1, -0.6); c.quadraticCurveTo(0, 2.3, 2.1, -0.6); c.closePath(); c.stroke();
      c.fillStyle = '#F6D9A8';
      c.beginPath(); c.ellipse(0, -0.6, 2.0, 0.75, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#FFF0CE'; c.lineWidth = 0.3;
      c.beginPath(); c.arc(-0.7, -0.7, 0.6, 0.2, Math.PI - 0.2); c.stroke();
      c.beginPath(); c.arc(0.7, -0.7, 0.6, 0.2, Math.PI - 0.2); c.stroke();
      c.fillStyle = '#C9736B';
      rr(c, -1.2, -1.1, 1.1, 0.7, 0.25); c.fill();
    } else if (pk.kind === 'letter') {
      c.fillStyle = '#FFFFFF';
      circle(c, 0, 0, pk.w * 0.62); c.fill();
      c.strokeStyle = PAL.lavender; c.lineWidth = 0.3;
      circle(c, 0, 0, pk.w * 0.62); c.stroke();
      c.fillStyle = PAL.pinkDeep;
      c.font = 'bold ' + (pk.w * 0.78) + 'px -apple-system, system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(pk.ch || '?', 0, 0.1);
    } else {
      c.fillStyle = '#FFD98A';
      c.beginPath();
      c.ellipse(-0.9, 0.7, 0.72, 0.55, -0.4, 0, Math.PI * 2); c.fill();
      c.fillRect(-0.35, -1.9, 0.42, 2.6);
      c.fillRect(-0.35, -1.9, 1.5, 0.42);
    }
    c.restore();
  }

  /* ============================ 背景 ============================ */

  function drawBackground(t) {
    var w = view.cssW, h = view.cssH, u = view.u;
    var mood = Core.skyMood(state.level);

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // 太阳光晕
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.scale(u, u);
    ctx.translate(0, 0);

    // 云
    var cSpacing = 34;
    var cScroll = scrollX * 0.09;
    var start = Math.floor((cScroll - 20) / cSpacing);
    for (var i = start; i < start + Math.ceil(view.worldW / cSpacing) + 3; i++) {
      var cx = i * cSpacing - cScroll;
      var cy = 6 + hash(i) * 16;
      var cs = 0.75 + hash(i * 3.1) * 0.75;
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = PAL.cloud;
      circle(ctx, cx, cy, 3.2 * cs); ctx.fill();
      circle(ctx, cx + 3.4 * cs, cy + 0.6 * cs, 2.5 * cs); ctx.fill();
      circle(ctx, cx - 3.2 * cs, cy + 0.9 * cs, 2.2 * cs); ctx.fill();
      ctx.fillStyle = PAL.cloudShade;
      circle(ctx, cx + 0.6 * cs, cy + 1.7 * cs, 2.4 * cs); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 远山
    var hillScroll = scrollX * 0.22;
    ctx.fillStyle = PAL.hillFar;
    ctx.beginPath();
    ctx.moveTo(-2, T.GROUND_Y + 2);
    for (var hx = -2; hx <= view.worldW + 2; hx += 2) {
      var hy = T.GROUND_Y - 12 - Math.sin((hx + hillScroll) * 0.06) * 5
        - Math.sin((hx + hillScroll) * 0.017) * 3.5;
      ctx.lineTo(hx, hy);
    }
    ctx.lineTo(view.worldW + 2, T.GROUND_Y + 2);
    ctx.closePath(); ctx.fill();

    // 樱花树
    var tSpacing = 23;
    var tScroll = scrollX * 0.42;
    var tStart = Math.floor((tScroll - 20) / tSpacing);
    for (var ti = tStart; ti < tStart + Math.ceil(view.worldW / tSpacing) + 3; ti++) {
      var tx = ti * tSpacing - tScroll + hash(ti * 7.7) * 6;
      var scale = 0.8 + hash(ti * 2.3) * 0.5;
      var baseY = T.GROUND_Y - 0.5;
      ctx.save();
      ctx.translate(tx, baseY);
      ctx.scale(scale, scale);
      ctx.fillStyle = '#C79BAE';
      ctx.fillRect(-0.42, -6.5, 0.84, 6.5);
      ctx.fillStyle = hash(ti * 5.1) > 0.5 ? PAL.tree : PAL.treeDark;
      circle(ctx, 0, -8.2, 3.5); ctx.fill();
      circle(ctx, -2.4, -6.8, 2.5); ctx.fill();
      circle(ctx, 2.4, -6.9, 2.6); ctx.fill();
      circle(ctx, 0, -10.6, 2.4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      circle(ctx, -1.1, -9.6, 1.3); ctx.fill();
      ctx.restore();
    }

    // 地面
    ctx.fillStyle = groundGrad;
    ctx.fillRect(-2, T.GROUND_Y, view.worldW + 4, T.WORLD_H - T.GROUND_Y + 2);

    // 跑道
    ctx.fillStyle = trackGrad;
    ctx.fillRect(-2, T.GROUND_Y, view.worldW + 4, 12);
    // 跑道虚线
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    var laneSpacing = 9;
    var laneStart = Math.floor((scrollX - 6) / laneSpacing);
    for (var li = laneStart; li < laneStart + Math.ceil(view.worldW / laneSpacing) + 3; li++) {
      var lx = li * laneSpacing - scrollX;
      rr(ctx, lx, T.GROUND_Y + 5.2, 4.2, 1.0, 0.5); ctx.fill();
    }
    // 跑道边线
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(-2, T.GROUND_Y - 0.35, view.worldW + 4, 0.5);

    // 草地上的小花
    var fSpacing = 5.5;
    var fStart = Math.floor((scrollX * 1.02 - 6) / fSpacing);
    for (var fi = fStart; fi < fStart + Math.ceil(view.worldW / fSpacing) + 3; fi++) {
      var fx = fi * fSpacing - scrollX * 1.02 + hash(fi * 11.3) * 3;
      var fy = T.GROUND_Y + 14 + hash(fi * 3.7) * 10;
      var col = ['#FFFFFF', '#FFD1E2', '#FFF3B0', '#C9B6FF'][Math.floor(hash(fi * 9.1) * 4)];
      ctx.fillStyle = col;
      circle(ctx, fx, fy, 0.42); ctx.fill();
      ctx.fillStyle = 'rgba(169,230,198,0.85)';
      ctx.fillRect(fx - 0.09, fy, 0.18, 1.5);
    }

    ctx.restore();

    // 飘落的花瓣（世界坐标，屏幕空间绘制）
    ctx.save();
    ctx.scale(u, u);
    for (var pi = 0; pi < petals.length; pi++) {
      var p = petals[pi];
      ctx.globalAlpha = p.a;
      ctx.fillStyle = PAL.petal;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.sway * 0.4);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s * 0.62, p.s * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ============================ 渲染 ============================ */

  function render(time) {
    var u = view.u;
    var shakeX = 0, shakeY = 0;
    if (state.shake > 0) {
      shakeX = (Math.random() - 0.5) * state.shake * 14;
      shakeY = (Math.random() - 0.5) * state.shake * 10;
    }

    drawBackground(time);

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.save();
    ctx.translate(shakeX, shakeY);
    ctx.scale(u, u);

    // 影子
    var p = state.player;
    var alt = (T.GROUND_Y - p.y) / 23;
    ctx.fillStyle = 'rgba(196,87,127,' + (0.18 * (1 - Math.min(1, alt))) + ')';
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, T.GROUND_Y + 0.4, p.w * 0.55 * (1 - alt * 0.35), 0.9 * (1 - alt * 0.4), 0, 0, Math.PI * 2);
    ctx.fill();

    // 空中障碍的地面影子（帮助判断高度）
    for (var si = 0; si < state.obstacles.length; si++) {
      var so = state.obstacles[si];
      if (!so.fly) continue;
      ctx.fillStyle = 'rgba(196,87,127,0.14)';
      ctx.beginPath();
      ctx.ellipse(so.x + so.w / 2, T.GROUND_Y + 0.5, so.w * 0.42, 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 障碍
    for (var i = 0; i < state.obstacles.length; i++) drawObstacle(ctx, state.obstacles[i], time);

    // 道具
    for (var j = 0; j < state.pickups.length; j++) drawPickup(ctx, state.pickups[j], time);

    // 玩家
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y);
    drawPlayer(ctx, p, time);
    ctx.restore();

    // 拾取闪光
    for (var s = sparkles.length - 1; s >= 0; s--) {
      var sp = sparkles[s];
      ctx.globalAlpha = Math.max(0, sp.life / sp.max);
      ctx.fillStyle = sp.color;
      circle(ctx, sp.x, sp.y, sp.r * (sp.life / sp.max));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 升级 / 受伤闪光
    if (state.flash > 0) {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.fillStyle = 'rgba(255,255,255,' + (state.flash * 0.5) + ')';
      ctx.fillRect(0, 0, view.cssW, view.cssH);
    }
  }

  /* ============================ HUD ============================ */

  var BANNER_PRIORITY = {
    start: 1, letter: 1, pickup: 1, milestone: 2, shield: 2, hit: 3, heal: 3, level: 4, word: 4
  };
  var bannerPriority = 0;

  /* 高优先级的消息（升级、拼出单词）不会被小消息打断 */
  function setBanner(text, cls, duration) {
    if (!el.banner) return;
    var prio = BANNER_PRIORITY[cls] || 1;
    if (bannerTimer > 0.5 && prio < bannerPriority) return;
    el.banner.textContent = text;
    el.banner.className = 'banner ' + (cls || '');
    void el.banner.offsetWidth;
    el.banner.classList.add('show');
    bannerPriority = prio;
    bannerTimer = duration || (prio >= 3 ? 2.4 : 2.0);
  }

  function showWordCard(ru, zh, msg) {
    if (!el.card) return;
    el.card.innerHTML = '<div class="wc-ru">' + ru + '</div>' +
      '<div class="wc-zh">' + zh + '</div>' +
      '<div class="wc-msg">' + msg + '</div>';
    el.card.classList.add('show');
    setTimeout(function () { el.card.classList.remove('show'); }, 2200);
  }

  function updateHud() {
    var s = state;
    if (s.level !== lastHud.level) {
      lastHud.level = s.level;
      if (el.level) el.level.textContent = 'Lv.' + s.level;
      if (el.levelTitle) el.levelTitle.textContent = Core.levelTitle(s.level);
      buildGradients();
    }
    var dist = Math.floor(s.distance);
    if (dist !== lastHud.dist) {
      lastHud.dist = dist;
      if (el.dist) el.dist.textContent = dist + ' 米';
    }
    if (s.score !== lastHud.score) {
      lastHud.score = s.score;
      if (el.score) el.score.textContent = s.score;
    }
    // 超过自己的最高分时，给一句专属鼓励
    if (!bestBeaten && save.best > 0 && s.score > save.best) {
      bestBeaten = true;
      setBanner('超过你自己的最高分啦！', 'milestone', 2.6);
      Sound.word();
    }

    var xpPct = Math.round((s.xp / s.xpToNext) * 100);
    if (xpPct !== lastHud.xp) {
      lastHud.xp = xpPct;
      if (el.xpFill) el.xpFill.style.width = Math.max(0, Math.min(100, xpPct)) + '%';
    }
    var hp = s.hearts * 10 + s.shield;
    if (hp !== lastHud.hearts) {
      lastHud.hearts = hp;
      if (el.hearts) {
        var out = '';
        for (var i = 0; i < T.HEARTS_MAX; i++) {
          out += '<span class="heart' + (i < s.hearts ? '' : ' off') + '">♥</span>';
        }
        if (s.shield > 0) out += '<span class="shield">🛡' + (s.shield > 1 ? s.shield : '') + '</span>';
        el.hearts.innerHTML = out;
      }
    }
    if (el.wordBar) {
      if (s.word.progress > 0) {
        var shown = '';
        for (var w = 0; w < s.word.ru.length; w++) {
          shown += w < s.word.progress ? s.word.ru.charAt(w) : '·';
        }
        el.wordBar.classList.add('show');
        if (el.wordNow) el.wordNow.textContent = shown;
      } else {
        el.wordBar.classList.remove('show');
      }
    }
  }

  /* ============================ 事件 ============================ */

  var comboStep = 0;

  function handleEvents() {
    for (var i = 0; i < state.events.length; i++) {
      var ev = state.events[i];
      switch (ev.type) {
        case 'jump': Sound.jump(); break;
        case 'land': Sound.land(); break;
        case 'levelup':
          Sound.levelUp();
          setBanner('第 ' + ev.level + ' 关 · ' + ev.title + '　' + ev.message, 'level');
          if (ev.healed) setTimeout(function () { setBanner('回复 1 颗心 ♥', 'heal'); }, 900);
          break;
        case 'milestone':
          setBanner(ev.message, 'milestone');
          break;
        case 'pickup':
          Sound.pickup(comboStep++);
          sparkleAt(state.player.x + state.player.w / 2, state.player.y - 6, 5, '#FFD98A');
          break;
        case 'letter':
          Sound.letter(state.word.progress);
          sparkleAt(state.player.x + state.player.w / 2, state.player.y - 6, 6, '#C9B6FF');
          setBanner('收集：' + ev.ch, 'letter');
          break;
        case 'word':
          Sound.word();
          showWordCard(ev.ru, ev.zh, ev.message + ' +150 XP');
          break;
        case 'shield':
          Sound.pickup(3);
          setBanner(ev.message, 'shield');
          break;
        case 'hit':
          Sound.hit();
          shakeScreen();
          if (!ev.fatal) setBanner(ev.message, 'hit');
          break;
        case 'gameover':
          Sound.over();
          break;
      }
    }
    if (state.events.length) state.events.length = 0;
  }

  function sparkleAt(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 4 + Math.random() * 9;
      sparkles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp * 0.4, vy: Math.sin(a) * sp * 0.4 - 3,
        r: 0.5 + Math.random() * 0.8,
        life: 0.55, max: 0.55, color: color || '#FFFFFF'
      });
    }
  }

  function shakeScreen() { /* state.shake 由 core 设置 */ }

  function updateSparkles(dt) {
    for (var i = sparkles.length - 1; i >= 0; i--) {
      var sp = sparkles[i];
      sp.life -= dt;
      if (sp.life <= 0) { sparkles.splice(i, 1); continue; }
      sp.x += sp.vx * dt * 6;
      sp.y += sp.vy * dt * 6;
      sp.vy += 14 * dt * 6;
    }
  }

  /* ============================ 主循环 ============================ */

  var last = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    if (!last) last = now;
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (dt <= 0) dt = 1 / 60;

    var wasPlaying = state.phase === 'playing';
    if (!paused && !frozen) {
      if (state.events.length) handleEvents();   // 先处理帧外产生的事件（调试/测试接口）
      Core.step(state, dt, wasPlaying ? input : {});
      if (state.phase === 'playing') {
        scrollX = state.distance;
        handleEvents();
      } else if (wasPlaying) {
        handleEvents();
        endRun();
        input.jump = false;
        input.duck = false;
        pointer.down = false;
        pointer.ducking = false;
      }
      updateSparkles(dt);
    }
    input.jumpPressed = false;

    // 花瓣
    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      p.y += p.vy * dt;
      p.sway += p.spin * dt;
      p.x -= (state.phase === 'playing' ? state.speed * 0.12 : 2) * dt;
      if (p.y > T.WORLD_H + 4 || p.x < -14) {
        p.x = view.worldW + 4 + Math.random() * 12;
        p.y = -6 - Math.random() * 30;
        p.s = 0.35 + Math.random() * 0.55;
      }
    }

    render(now / 1000);
    updateHud();
    Sound.tick();

    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) {
        bannerPriority = 0;
        if (el.banner) el.banner.classList.remove('show');
      }
    }
  }

  /* ============================ 流程 ============================ */

  function startRun() {
    Sound.unlock();
    Core.resetRun(state, { seed: (Math.random() * 1e9) | 0 });
    scrollX = 0;
    sparkles.length = 0;
    comboStep = 0;
    lastHud = { level: -1, dist: -1, score: -1, hearts: -1, xp: -1, shield: -1 };
    bannerTimer = 0;
    bannerPriority = 0;
    bestBeaten = false;
    if (el.start) el.start.classList.remove('show');
    if (el.over) el.over.classList.remove('show');
    if (el.overlay) el.overlay.classList.remove('show');
    if (el.duck) el.duck.classList.add('show');
    if (el.hint) {
      el.hint.classList.remove('hide');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { el.hint.classList.add('hide'); }, 4500);
    }
    buildGradients();
    setBanner(Core.pickMessage(state, 'start'), 'start');
  }

  function endRun() {
    if (el.duck) el.duck.classList.remove('show');
    if (el.hint) el.hint.classList.add('hide');
    var dist = Math.floor(state.distance);
    var prevBest = save.best;
    var isBest = state.score > save.best;
    save.runs++;
    save.totalDistance += dist;
    if (isBest) save.best = state.score;
    if (state.level > save.bestLevel) save.bestLevel = state.level;
    if (dist > save.bestDistance) save.bestDistance = dist;
    save.wordsCollected = (save.wordsCollected || 0) + state.stats.words;
    persist();

    if (el.overTitle) el.overTitle.textContent = isBest ? '新纪录！' : '这一趟结束啦';
    if (el.overStats) {
      el.overStats.innerHTML =
        '<div class="stat"><b>' + state.score + '</b><span>分数</span></div>' +
        '<div class="stat"><b>' + dist + '</b><span>米</span></div>' +
        '<div class="stat"><b>' + state.level + '</b><span>关卡</span></div>' +
        '<div class="stat"><b>' + state.stats.pickups + '</b><span>道具</span></div>' +
        '<div class="stat"><b>' + state.stats.words + '</b><span>俄语词</span></div>' +
        '<div class="stat"><b>' + save.best + '</b><span>最高分</span></div>';
    }
    if (el.overMsg) {
      var msg = Core.pickMessage(state, 'gameover');
      if (isBest && prevBest > 0) {
        msg = '比最好成绩多了 ' + (state.score - prevBest) + ' 分！' + msg;
      } else if (isBest && prevBest === 0) {
        msg = '第一次就跑了 ' + state.score + ' 分，' + msg;
      } else if (prevBest > 0) {
        msg += '　距离纪录还差 ' + Math.max(0, prevBest - state.score) + ' 分';
      }
      el.overMsg.textContent = msg;
    }
    if (el.over) el.over.classList.add('show');
    if (el.overlay) el.overlay.classList.add('show');
  }

  function refreshStartScreen() {
    if (el.greeting) {
      el.greeting.textContent = Core.pickMessage(state, 'greeting');
    }
    if (el.best) {
      el.best.innerHTML = save.best > 0
        ? '最高分 <b>' + save.best + '</b> · 最远 <b>' + save.bestDistance + '</b> 米 · 最高 <b>Lv.' + save.bestLevel + '</b>'
        : '第一次玩的话，慢慢来就好 ♥';
    }
  }

  /* ============================ 输入 ============================ */

  var pointer = { down: false, id: null, startY: 0, startX: 0, ducking: false };

  function onDown(e) {
    if (state.phase !== 'playing') return;
    if (e.target && e.target.closest && e.target.closest('button')) return;
    if (pointer.down && pointer.id !== e.pointerId) return;   // 第二根手指不要触发额外跳跃
    pointer.down = true;
    pointer.id = e.pointerId;
    pointer.startY = e.clientY;
    pointer.startX = e.clientX;
    pointer.ducking = false;
    input.jump = true;
    input.jumpPressed = true;
    if (stage.setPointerCapture && e.pointerId != null) {
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    }
  }

  function onMove(e) {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    var dy = e.clientY - pointer.startY;
    if (dy > 26) { pointer.ducking = true; input.duck = true; }
    else if (dy < 12 && pointer.ducking) { pointer.ducking = false; input.duck = false; }
  }

  function onUp(e) {
    if (e.pointerId != null && pointer.id != null && e.pointerId !== pointer.id) return;
    pointer.down = false;
    pointer.id = null;
    input.jump = false;
    if (pointer.ducking) { pointer.ducking = false; input.duck = false; }
  }

  function bindInput() {
    stage.addEventListener('pointerdown', onDown, { passive: true });
    stage.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });

    if (el.duck) {
      el.duck.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        input.duck = true;
      }, { passive: true });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
        el.duck.addEventListener(evt, function (e) {
          e.stopPropagation();
          input.duck = false;
        }, { passive: true });
      });
    }

    window.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        if (state.phase === 'ready') startRun();
        else if (state.phase === 'over') startRun();
        else { input.jump = true; input.jumpPressed = true; }
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        input.duck = true;
      } else if (e.code === 'Enter') {
        if (state.phase !== 'playing') startRun();
      } else if (e.code === 'KeyM') {
        toggleMute();
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') input.jump = false;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') input.duck = false;
    });

    // 防止双击缩放 / 长按菜单
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  }

  /* ============================ 按钮 ============================ */

  function toggleMute() {
    Sound.setMuted(!save.muted);
    if (el.mute) {
      el.mute.classList.toggle('muted', save.muted);
      el.mute.textContent = save.muted ? '🔇' : '🔊';
    }
    persist();
  }

  function bindButtons() {
    if (el.startBtn) el.startBtn.addEventListener('click', function () { startRun(); });
    if (el.againBtn) el.againBtn.addEventListener('click', function () { startRun(); });
    if (el.mute) el.mute.addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });
    if (el.howBtn) {
      el.howBtn.addEventListener('click', function () {
        if (el.how) el.how.classList.toggle('show');
      });
    }
    if (el.shareBtn) {
      el.shareBtn.addEventListener('click', function () {
        var text = '我在《自怡向前冲》跑了 ' + Math.floor(state.distance) + ' 米，第 ' +
          state.level + ' 关，拿了 ' + state.score + ' 分！';
        if (navigator.share) {
          navigator.share({ title: '自怡向前冲', text: text }).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(function () {
            el.shareBtn.textContent = '已复制 ✓';
            setTimeout(function () { el.shareBtn.textContent = '分享成绩'; }, 1500);
          }).catch(function () {});
        }
      });
    }
    // 点卡片以外的地方也能开始 / 重来
    [el.start, el.over].forEach(function (screen) {
      if (!screen) return;
      screen.addEventListener('click', function (e) {
        if (e.target.closest('.card')) return;
        if (state.phase === 'over' || state.phase === 'ready') startRun();
      });
    });
    document.addEventListener('visibilitychange', function () {
      paused = document.hidden;
      last = 0;
    });
  }

  /* ============================ 启动 ============================ */

  function boot() {
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
    bindInput();
    bindButtons();
    if (el.mute) {
      el.mute.classList.toggle('muted', save.muted);
      el.mute.textContent = save.muted ? '🔇' : '🔊';
    }
    refreshStartScreen();
    if (el.start) el.start.classList.add('show');

    // 给自动化测试用的调试接口（不影响正常游玩）
    window.__ZIYI__ = {
      version: '1.0.0',
      get state() { return state; },
      get view() { return view; },
      input: input,
      startRun: startRun,
      endRun: endRun,
      setBanner: setBanner,
      showWordCard: showWordCard,
      Core: Core,
      resize: resize,
      audio: function () { return Sound.debug(); },
      setFrozen: function (v) { frozen = !!v; },
      isFrozen: function () { return frozen; }
    };

    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
