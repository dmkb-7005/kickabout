'use strict';
// ---------- Constants (world units; d = depth across the pitch, z = height) ----------
const FW = 1000, FD = 600, K = 0.35;          // pitch length, depth, depth squash for side view
const GOAL_HALF = 75, GOAL_H = 95, GOAL_DEPTH = 35;
const PR = 16, BR = 9;                          // player / ball radius
const HUMAN_MAX = 270, AI_MAX = 200;            // run speeds
const DRIBBLE_R = 28, KICK_R = 44, FULL_SPEED_DIST = 220;
const GRAVITY = 900, MATCH_GOALS = 5;

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
let W, H, S, OX, OY;
const btnK = { r: 70, label: 'KICK', col: '#ffd23f' };
const btnT = { r: 52, label: 'TACKLE', col: '#ff8c42' };

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S = Math.min((W - 100) / (FW + 2 * GOAL_DEPTH), (H - 90) / (FD * K + GOAL_H));
  OX = (W - FW * S) / 2;
  OY = 70 + GOAL_H * S + ((H - 90) - (FD * K + GOAL_H) * S) / 2;
  btnK.x = 40 + btnK.r; btnK.y = H - 30 - btnK.r;
  btnT.x = btnK.x + btnK.r + 30 + btnT.r; btnT.y = H - 22 - btnT.r;
}
addEventListener('resize', resize); resize();

const toS = (x, d, z = 0) => [OX + x * S, OY + (d * K - z) * S];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Game state ----------
let me, cpu, ball, owner = null, score = [0, 0], running = false;
let pause = 0, msg = '', kickCharge = -1;

function mkPlayer(x, col, ai) {
  return { x, d: FD / 2, vx: 0, vd: 0, fx: ai ? -1 : 1, fd: 0, col, ai,
    stun: 0, slide: 0, recover: 0, tcd: 0, ng: 0, run: 0, spd: 0, aim: 0 };
}
function kickoff() {
  me = mkPlayer(FW * 0.32, '#e63946', false);
  cpu = mkPlayer(FW * 0.68, '#1d6fe0', true);
  ball = { x: FW / 2, d: FD / 2, z: 0, vx: 0, vd: 0, vz: 0 };
  owner = null;
}
kickoff();

// ---------- Audio ----------
let AC = null;
function beep(f, t = 0.08, type = 'square', vol = 0.15) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + t);
  o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + t);
}

// ---------- Input (multi-touch via pointer events) ----------
const ptr = { move: null, mx: 0, my: 0, kick: null };
const hit = (b, e) => Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r + 14;

cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!running) return;
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  if (hit(btnK, e)) { ptr.kick = e.pointerId; kickCharge = 0; }
  else if (hit(btnT, e)) { doTackle(me); }
  else if (ptr.move === null) { ptr.move = e.pointerId; ptr.mx = e.clientX; ptr.my = e.clientY; }
});
cv.addEventListener('pointermove', e => {
  if (e.pointerId === ptr.move) { ptr.mx = e.clientX; ptr.my = e.clientY; }
});
function release(e) {
  if (e.pointerId === ptr.move) ptr.move = null;
  if (e.pointerId === ptr.kick) { doKick(me, kickCharge); kickCharge = -1; ptr.kick = null; }
}
cv.addEventListener('pointerup', release);
cv.addEventListener('pointercancel', release);
cv.addEventListener('contextmenu', e => e.preventDefault());

document.getElementById('go').addEventListener('click', async () => {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume(); } catch (_) {}
  try { await document.documentElement.requestFullscreen(); } catch (_) {}
  try { await screen.orientation.lock('landscape'); } catch (_) {}
  document.getElementById('start').style.display = 'none';
  score = [0, 0]; kickoff(); running = true; pause = 1; msg = 'Kick-off!';
});

// ---------- Actions ----------
function doKick(p, charge) {
  if (p.stun > 0 || p.slide > 0 || charge < 0) return;
  if (Math.hypot(ball.x - p.x, ball.d - p.d) > KICK_R || ball.z > 40) return;
  const c = Math.min(1, charge / 0.7), pw = 360 + 540 * c;
  ball.vx = p.fx * pw + p.vx * 0.3;
  ball.vd = p.fd * pw + p.vd * 0.3;
  ball.vz = 90 + 290 * c;
  p.ng = 0.3; owner = null;
  beep(180 + 200 * c, 0.1, 'triangle', 0.3);
}
function doTackle(p) {
  if (p.stun > 0 || p.slide > 0 || p.recover > 0 || p.tcd > 0) return;
  p.slide = 0.35; p.tcd = 1.1;
  if (!p.ai) beep(120, 0.12, 'sawtooth', 0.1);
}

// ---------- Simulation ----------
function steer(p, tvx, tvd, dt) {
  const k = Math.min(1, dt * 10);
  p.vx += (tvx - p.vx) * k; p.vd += (tvd - p.vd) * k;
}

function humanInput(dt) {
  const p = me;
  if (p.stun > 0 || p.slide > 0 || p.recover > 0) return;
  if (ptr.move !== null) {
    const tx = (ptr.mx - OX) / S, td = (ptr.my - OY) / (S * K);
    const dx = tx - p.x, dd = td - p.d, dist = Math.hypot(dx, dd);
    if (dist > 12) {
      const sp = Math.min(1, (dist - 12) / FULL_SPEED_DIST) * HUMAN_MAX;
      p.fx = dx / dist; p.fd = dd / dist;
      steer(p, p.fx * sp, p.fd * sp, dt);
      return;
    }
  }
  steer(p, 0, 0, dt);
}

function aiThink(p, dt) {
  if (p.stun > 0 || p.slide > 0 || p.recover > 0) return;
  const dB = Math.hypot(ball.x - p.x, ball.d - p.d);
  let tx, td, face = null;
  if (owner === p) {                                   // dribble towards your goal (x = 0)
    tx = 0; td = FD / 2 + p.aim;
    if (p.x < 340 && Math.random() < dt * 2.2) {
      const gx = -p.x, gd = FD / 2 + (Math.random() - 0.5) * 100 - p.d, gl = Math.hypot(gx, gd);
      p.fx = gx / gl; p.fd = gd / gl;
      doKick(p, 0.25 + Math.random() * 0.5);
      return;
    }
  } else if (owner === me) {                           // defend: get goal-side, then try a tackle
    tx = ball.x + 34; td = ball.d;
    if (dB < 48 && Math.random() < dt * 1.4) {
      const l = Math.hypot(ball.x - p.x, ball.d - p.d) || 1;
      p.fx = (ball.x - p.x) / l; p.fd = (ball.d - p.d) / l;
      doTackle(p); return;
    }
  } else {                                             // loose ball: chase where it's going
    tx = ball.x + ball.vx * 0.25; td = ball.d + ball.vd * 0.25;
    p.aim = (Math.random() - 0.5) * 120;
  }
  const dx = tx - p.x, dd = td - p.d, dist = Math.hypot(dx, dd);
  if (dist > 4) {
    p.fx = dx / dist; p.fd = dd / dist;
    const sp = Math.min(AI_MAX, dist * 4);
    steer(p, p.fx * sp, p.fd * sp, dt);
  } else steer(p, 0, 0, dt);
}

function movePlayer(p, other, dt) {
  p.stun = Math.max(0, p.stun - dt); p.tcd = Math.max(0, p.tcd - dt); p.ng = Math.max(0, p.ng - dt);
  if (p.recover > 0) { p.recover -= dt; steer(p, 0, 0, dt); }
  if (p.stun > 0) steer(p, 0, 0, dt * 0.5);
  if (p.slide > 0) {
    p.slide -= dt;
    p.vx = p.fx * 430; p.vd = p.fd * 430;
    if (Math.hypot(ball.x - p.x, ball.d - p.d) < 32 && ball.z < 20) {       // poke the ball away
      ball.vx = p.fx * 300 + (Math.random() - 0.5) * 120;
      ball.vd = p.fd * 300 + (Math.random() - 0.5) * 120;
      ball.vz = 60; p.ng = 0.25; owner = null;
    }
    if (other.stun <= 0 && Math.hypot(other.x - p.x, other.d - p.d) < PR * 2 + 6) {
      other.stun = 0.9; other.ng = 0.9; if (owner === other) owner = null;
      beep(90, 0.15, 'square', 0.15);
    }
    if (p.slide <= 0) { p.recover = 0.35; p.vx *= 0.2; p.vd *= 0.2; }
  }
  p.x = clamp(p.x + p.vx * dt, PR, FW - PR);
  p.d = clamp(p.d + p.vd * dt, 0, FD);
  p.spd = Math.hypot(p.vx, p.vd);
  p.run += p.spd * dt * 0.06;
}

function canControl(p) {
  return p.stun <= 0 && p.ng <= 0 && p.slide <= 0 && ball.z < 14 &&
    Math.hypot(ball.x - p.x, ball.d - p.d) < DRIBBLE_R;
}

function dribble(dt) {
  const a = canControl(me), b = canControl(cpu);
  owner = a && b ? (Math.hypot(ball.x - me.x, ball.d - me.d) < Math.hypot(ball.x - cpu.x, ball.d - cpu.d) ? me : cpu)
        : a ? me : b ? cpu : null;
  if (!owner) return;
  const p = owner, off = PR + BR + 2;
  const tx = p.x + p.fx * off, td = p.d + p.fd * off;
  ball.vx = p.vx + (tx - ball.x) * 12;
  ball.vd = p.vd + (td - ball.d) * 12;
  ball.vz = 0; ball.z = 0;
}

function ballPhysics(dt) {
  ball.x += ball.vx * dt; ball.d += ball.vd * dt; ball.z += ball.vz * dt;
  if (ball.z > 0 || ball.vz > 0) ball.vz -= GRAVITY * dt;
  if (ball.z < 0) { ball.z = 0; ball.vz = ball.vz < -120 ? -ball.vz * 0.5 : 0; }
  const fr = Math.exp(-(ball.z > 0 ? 0.3 : 1.5) * dt);
  ball.vx *= fr; ball.vd *= fr;
  if (ball.d < BR) { ball.d = BR; ball.vd = Math.abs(ball.vd) * 0.6; }
  if (ball.d > FD - BR) { ball.d = FD - BR; ball.vd = -Math.abs(ball.vd) * 0.6; }
  const inMouth = Math.abs(ball.d - FD / 2) < GOAL_HALF - BR && ball.z < GOAL_H;
  if (ball.x < BR && !inMouth) { ball.x = BR; ball.vx = Math.abs(ball.vx) * 0.6; }
  if (ball.x > FW - BR && !inMouth) { ball.x = FW - BR; ball.vx = -Math.abs(ball.vx) * 0.6; }
  if (ball.x < -BR * 2) goal(1);
  else if (ball.x > FW + BR * 2) goal(0);
}

function goal(team) {
  score[team]++;
  const won = score[team] >= MATCH_GOALS;
  msg = won ? (team === 0 ? 'YOU WIN! 🏆' : 'CPU wins – rematch?') : (team === 0 ? 'GOAL! 🎉' : 'CPU scores!');
  pause = won ? 3.5 : 2;
  if (team === 0) [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'square', 0.12), i * 110));
  else beep(150, 0.4, 'sawtooth', 0.1);
  ball.vx = ball.vd = 0;
  if (won) setTimeout(() => { running = false; document.getElementById('start').style.display = 'flex'; }, 3400);
}

function separate() {
  const dx = cpu.x - me.x, dd = cpu.d - me.d, dist = Math.hypot(dx, dd);
  if (dist > 0 && dist < PR * 2) {
    const push = (PR * 2 - dist) / 2, nx = dx / dist, nd = dd / dist;
    me.x -= nx * push; me.d -= nd * push; cpu.x += nx * push; cpu.d += nd * push;
  }
}

function update(dt) {
  if (!running) return;
  if (pause > 0) {
    pause -= dt;
    if (pause <= 0) { if (msg !== 'Kick-off!') kickoff(); msg = ''; }
    if (msg !== 'Kick-off!') ballPhysicsFrozen(dt);
    return;
  }
  if (kickCharge >= 0) kickCharge += dt;
  humanInput(dt); aiThink(cpu, dt);
  movePlayer(me, cpu, dt); movePlayer(cpu, me, dt);
  separate(); dribble(dt); ballPhysics(dt);
}
function ballPhysicsFrozen(dt) { ball.z = Math.max(0, ball.z - 200 * dt); }

// ---------- Rendering ----------
function drawPitch() {
  ctx.fillStyle = '#0d3b1a'; ctx.fillRect(0, 0, W, H);
  const [x0, y0] = toS(0, 0), [x1, y1] = toS(FW, FD);
  const n = 10;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? '#2a9a45' : '#258c3e';
    ctx.fillRect(x0 + (x1 - x0) * i / n, y0, (x1 - x0) / n + 1, y1 - y0);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(2, 2.5 * S);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  const [mx] = toS(FW / 2, 0);
  ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(mx, y1); ctx.stroke();
  const [cx, cy] = toS(FW / 2, FD / 2);
  ctx.beginPath(); ctx.ellipse(cx, cy, 70 * S, 70 * S * K, 0, 0, Math.PI * 2); ctx.stroke();
  for (const side of [0, 1]) {
    const bx = side ? FW - 150 : 0;
    const [a, b] = toS(bx, FD / 2 - 140), [c, d] = toS(bx + 150, FD / 2 + 140);
    ctx.strokeRect(a, b, c - a, d - b);
  }
}

function drawGoal(side, front) {
  const x = side ? FW : 0, bx = side ? FW + GOAL_DEPTH : -GOAL_DEPTH;
  const d1 = FD / 2 - GOAL_HALF, d2 = FD / 2 + GOAL_HALF;
  const P = (xx, dd, zz) => toS(xx, dd, zz);
  ctx.lineWidth = Math.max(2, 3 * S);
  if (!front) {                       // net (drawn behind players)
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    for (const p of [P(x, d1, GOAL_H), P(bx, d1, GOAL_H * 0.8), P(bx, d2, GOAL_H * 0.8), P(x, d2, GOAL_H),
      P(x, d2, 0), P(bx, d2, 0), P(bx, d1, 0), P(x, d1, 0)]) ctx.lineTo(p[0], p[1]);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const dd = d1 + (d2 - d1) * i / 8, a = P(bx, dd, 0), b = P(bx, dd, GOAL_H * 0.8);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.lineWidth = Math.max(2, 3 * S); ctx.strokeStyle = '#fff';
    const a = P(x, d1, 0), b = P(x, d1, GOAL_H);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();      // far post
  } else {
    ctx.strokeStyle = '#fff';
    const a = P(x, d1, GOAL_H), b = P(x, d2, GOAL_H), c = P(x, d2, 0);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); // bar + near post
  }
}

function drawPlayer(p) {
  const [sx, sy] = toS(p.x, p.d);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(sx, sy, PR * S, PR * S * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(sx, sy);
  const dir = p.fx >= 0 ? 1 : -1;
  if (p.slide > 0) ctx.rotate(dir * 1.1);
  const s = S, swing = p.spd > 20 ? Math.sin(p.run) * 9 : 0;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 5 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-3 * s, -20 * s); ctx.lineTo((-3 + swing) * s, 0);
  ctx.moveTo(3 * s, -20 * s); ctx.lineTo((3 - swing) * s, 0); ctx.stroke();
  ctx.fillStyle = p.col;
  ctx.beginPath(); ctx.roundRect(-10 * s, -44 * s, 20 * s, 26 * s, 5 * s); ctx.fill();
  ctx.fillStyle = '#f2c79b';
  ctx.beginPath(); ctx.arc(0, -54 * s, 10 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc((dir * 4 + p.fd * 2) * s, -55 * s, 1.8 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (p.stun > 0) {
    ctx.font = `${16 * S}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText('💫', sx + Math.sin(performance.now() / 120) * 8 * S, sy - 72 * S);
  }
}

function drawArrow(p) {
  if (p.stun > 0) return;
  const frac = clamp(p.spd / HUMAN_MAX, 0, 1), len = 22 + 60 * frac;
  const [ax, ay] = toS(p.x + p.fx * (PR + 6), p.d + p.fd * (PR + 6));
  const [bx, by] = toS(p.x + p.fx * (PR + 6 + len), p.d + p.fd * (PR + 6 + len));
  const ang = Math.atan2(by - ay, bx - ax), h = 12 * S;
  ctx.strokeStyle = ctx.fillStyle = `rgba(255,230,60,${0.55 + 0.4 * frac})`;
  ctx.lineWidth = 5 * S; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx + Math.cos(ang) * h, by + Math.sin(ang) * h);
  ctx.lineTo(bx + Math.cos(ang + 2.4) * h, by + Math.sin(ang + 2.4) * h);
  ctx.lineTo(bx + Math.cos(ang - 2.4) * h, by + Math.sin(ang - 2.4) * h); ctx.fill();
}

function drawBall() {
  const [gx, gy] = toS(ball.x, ball.d), [sx, sy] = toS(ball.x, ball.d, ball.z + BR);
  const shrink = 1 / (1 + ball.z / 120);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(gx, gy, BR * S * shrink, BR * S * 0.4 * shrink, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(sx, sy, BR * S, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#222';
  const rot = ball.x / BR;
  ctx.beginPath(); ctx.arc(sx + Math.cos(rot) * BR * S * 0.4, sy + Math.sin(rot) * BR * S * 0.4, BR * S * 0.35, 0, Math.PI * 2); ctx.fill();
}

function drawButton(b, active, charge) {
  ctx.globalAlpha = active ? 0.95 : 0.6;
  ctx.fillStyle = b.col;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  if (charge > 0) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, charge / 0.7)); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#222';
  ctx.font = `800 ${b.r * 0.36}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(b.label, b.x, b.y);
}

function render() {
  drawPitch();
  drawGoal(0, false); drawGoal(1, false);
  const items = [me, cpu, ball].sort((a, b) => a.d - b.d);
  for (const it of items) {
    if (it === ball) drawBall();
    else { if (!it.ai) drawArrow(it); drawPlayer(it); }
  }
  drawGoal(0, true); drawGoal(1, true);
  if (ptr.move !== null) {
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ptr.mx, ptr.my, 26, 0, Math.PI * 2); ctx.stroke();
  }
  // HUD
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  ctx.font = '800 34px system-ui';
  ctx.fillText(`YOU  ${score[0]} : ${score[1]}  CPU`, W / 2, 34);
  ctx.font = '500 14px system-ui'; ctx.globalAlpha = 0.7;
  ctx.fillText(`first to ${MATCH_GOALS}`, W / 2, 60); ctx.globalAlpha = 1;
  if (msg) {
    ctx.font = '900 72px system-ui'; ctx.lineWidth = 8; ctx.strokeStyle = '#0d3b1a';
    ctx.strokeText(msg, W / 2, H / 2); ctx.fillText(msg, W / 2, H / 2);
  }
  if (running) { drawButton(btnK, ptr.kick !== null, kickCharge); drawButton(btnT, me.slide > 0, 0); }
}

// ---------- Loop ----------
let last = performance.now();
function frame(t) {
  const dt = Math.min(1 / 30, (t - last) / 1000); last = t;
  update(dt); render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
