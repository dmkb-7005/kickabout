'use strict';
// =====================================================================
//  Kick-About – prototype v2
//  World units: x = along the pitch, d = depth (0 = far touchline,
//  FD = near touchline), z = height. Rendered with a perspective camera
//  placed above/behind the near touchline that scrolls with the play.
// =====================================================================
const FW = 1100, FD = 400;
const GOAL_HALF = 75, GOAL_H = 95, GOAL_DEPTH = 40;
const PR = 16, BR = 9;
const DRIBBLE_R = 28, KICK_R = 44;
const GRAVITY = 900, MATCH_GOALS = 5;
const CIRCLE_R = 75;                    // centre circle radius (kick-off exclusion zone)

// --- sprint (human only) ---
const SPRINT_MULT = 1.5, SPRINT_TIME = 3, SPRINT_CD = 10;

// --- shooting accuracy: spread grows with distance to goal ---
const SHOT_SPREAD_NEAR = 0.03;          // radians of error right in front of goal
const SHOT_SPREAD_FAR = 0.22;           // extra radians at a full pitch length away

// --- aiming (hold KICK) ---
const SLOWMO = 0.25;                    // game speed while aiming
const AIM_SHAKE_MAX = 0.75;             // radians of aim-line shake at the worst point (~43°)
const AIM_SHAKE_TIME = 8;               // seconds of holding until the shake is at its maximum

// --- feints ---
const FEINT_WINDOW = 1.1;               // the 3 joystick flicks must happen within this many seconds
const FEINT_CD = 2;                     // seconds before another feint can be done
const DAZZLE_TIME = 1.0, DAZZLE_IMMUNE = 2.5;

// --- goal frame ---
const POST_R = 4;

// --- movement / fatigue tuning ---
const HUMAN_TOP = 280, AI_TOP = 255;   // top speed when fresh
const ACCEL = 380, BRAKE = 620;        // units/s² (speeding up vs. slowing/turning)
const DRAIN = 0.17;                    // stamina lost per second at full sprint
const RECOVER = 0.13;                  // stamina regained per second when walking/standing
const WALK_FRAC = 0.45;                // below this fraction of top speed you don't get tired

// --- camera ---
const D0 = 520;        // distance from camera to near touchline
const VIEW_W = 640;    // roughly how much pitch length is visible at mid-depth

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
let W, H, F, A, HY, camX = FW / 2;
const btnK = { r: 70, label: 'KICK', col: '#ffd23f' };
const btnT = { r: 52, label: 'TACKLE', col: '#ff8c42' };
const btnS = { r: 52, label: 'SPRINT', col: '#7ee081' };
const joy = { r: 110 };

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const nearY = H + 10, farY = Math.max(150, H * 0.24);
  A = (nearY - farY) / (1 / D0 - 1 / (D0 + FD));
  HY = nearY - A / D0;
  F = (D0 + FD / 2) * W / VIEW_W;
  btnK.x = 40 + btnK.r; btnK.y = H - 30 - btnK.r;
  btnT.x = btnK.x + btnK.r + 30 + btnT.r; btnT.y = H - 22 - btnT.r;
  btnS.x = btnK.x; btnS.y = btnK.y - btnK.r - 34 - btnS.r;
  joy.r = Math.min(120, H * 0.15);
  joy.x = W - 50 - joy.r; joy.y = H - 50 - joy.r;
}
addEventListener('resize', resize); resize();

const camDist = d => D0 + FD - d;
const scaleAt = d => F / camDist(d);
function P(x, d, z = 0) {
  const k = F / camDist(d);
  return [W / 2 + (x - camX) * k, HY + A / camDist(d) - z * k];
}
function screenToWorld(sx, sy) {
  const dist = A / Math.max(1, sy - HY);
  return [camX + (sx - W / 2) * dist / F, D0 + FD - dist];
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.d - b.d);

// ---------- State ----------
let me, cpu, ball, owner = null, score = [0, 0];
let phase = 'menu', phaseT = 0, msg = '', kickCharge = -1, nextHumanKicks = true;
let kickoffLock = false, kickoffT = 0, kicker = null;
const sprint = { active: false, t: 0, cd: 0 };
const aim = { active: false, t0: 0, ang: 0, power: 0.5, lvx: 0, lvd: 0 };
const feint = { tokens: [], cd: 0 };
const popups = [];
const nowS = () => performance.now() / 1000;
// Rubber-banding: >1 makes the CPU stronger (you're leading), <1 weaker (CPU is leading)
const aiSkill = () => clamp(1 + 0.07 * (score[0] - score[1]), 0.86, 1.14);
function popup(txt, x, d, col = '#fff') { popups.push({ txt, x, d, t: 1.3, col }); }

function mkPlayer(x, col, ai, stam = 1) {
  return { x, d: FD / 2, vx: 0, vd: 0, fx: ai ? -1 : 1, fd: 0, hx: ai ? -1 : 1, want: 0,
    col, ai, stam, dazzle: 0, dazImm: 0, stun: 0, slide: 0, recover: 0, tcd: 0, ng: 0, run: 0, spd: 0, aim: 0 };
}
function setupKickoff(humanKicks) {
  const sm = me ? Math.min(1, me.stam + 0.3) : 1, sc = cpu ? Math.min(1, cpu.stam + 0.3) : 1;
  const c = FW / 2;
  me = mkPlayer(humanKicks ? c - PR - BR - 2 : c - 140, '#e63946', false, sm);
  cpu = mkPlayer(humanKicks ? c + 140 : c + PR + BR + 2, '#1d6fe0', true, sc);
  ball = { x: c, d: FD / 2, z: 0, vx: 0, vd: 0, vz: 0 };
  owner = null; aim.active = false; feint.tokens.length = 0;
  kicker = humanKicks ? me : cpu; kickoffLock = true; kickoffT = 0;
  sprint.active = false;
  phase = 'ready'; phaseT = 1.4;
  msg = humanKicks ? 'Your kick-off!' : 'CPU kick-off!';
}

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

// ---------- Input ----------
const ptr = { move: null, mx: 0, my: 0, kick: null, sprint: null };
const hit = (b, e) => Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r + 14;
const playing = () => phase === 'play' || phase === 'ready';

cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!playing()) return;
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  if (hit(btnK, e)) { ptr.kick = e.pointerId; startAim(); }
  else if (hit(btnT, e)) { if (phase === 'play') doTackle(me); }
  else if (hit(btnS, e)) { ptr.sprint = e.pointerId; startSprint(); }
  else if (ptr.move === null && Math.hypot(e.clientX - joy.x, e.clientY - joy.y) < joy.r * 1.7) {
    ptr.move = e.pointerId; ptr.mx = e.clientX; ptr.my = e.clientY;
  }
});
cv.addEventListener('pointermove', e => { if (e.pointerId === ptr.move) { ptr.mx = e.clientX; ptr.my = e.clientY; } });
function release(e) {
  if (e.pointerId === ptr.move) ptr.move = null;
  if (e.pointerId === ptr.sprint) { ptr.sprint = null; endSprint(); }
  if (e.pointerId === ptr.kick) { releaseAim(); ptr.kick = null; }
}
cv.addEventListener('pointerup', release);
cv.addEventListener('pointercancel', release);
cv.addEventListener('contextmenu', e => e.preventDefault());

document.getElementById('go').addEventListener('click', async () => {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume(); } catch (_) {}
  try { await document.documentElement.requestFullscreen(); } catch (_) {}
  try { await screen.orientation.lock('landscape'); } catch (_) {}
  document.getElementById('start').style.display = 'none';
  score = [0, 0]; me = cpu = null;
  setupKickoff(Math.random() < 0.5);          // random first possession
  camX = FW / 2;
});

function startSprint() {
  if (phase === 'play' && !sprint.active && sprint.cd <= 0) { sprint.active = true; sprint.t = SPRINT_TIME; beep(660, 0.08, 'triangle', 0.12); }
}
function endSprint() {
  if (sprint.active) { sprint.active = false; sprint.cd = SPRINT_CD; }
}
const sprinting = p => p === me && sprint.active;

// ---------- Movement physics ----------
const topSpeed = p => (p.ai ? AI_TOP * aiSkill() : HUMAN_TOP);
const maxSpeed = p => topSpeed(p) * (0.5 + 0.5 * p.stam) * (owner === p ? 0.9 : 1) * (sprinting(p) ? SPRINT_MULT : 1);

// Accelerate towards a target velocity with limited acceleration -> inertia.
function accelTo(p, tvx, tvd, dt) {
  const dvx = tvx - p.vx, dvd = tvd - p.vd, m = Math.hypot(dvx, dvd);
  if (m < 1e-3) return;
  const braking = tvx * p.vx + tvd * p.vd < 0 || Math.hypot(tvx, tvd) < p.spd - 5;
  const a = (braking ? BRAKE : ACCEL) * (0.6 + 0.4 * p.stam) * (sprinting(p) ? 1.35 : 1) * dt;
  if (m <= a) { p.vx = tvx; p.vd = tvd; } else { p.vx += dvx / m * a; p.vd += dvd / m * a; }
}
const busy = p => p.stun > 0 || p.slide > 0 || p.recover > 0;

function humanInput(dt) {
  const p = me;
  p.want = 0;
  if (busy(p)) return;
  if (aim.active) {
    // While aiming: keep running the way you were going; the joystick now steers the aim line.
    // Direction = joystick direction, power = how far the joystick is pushed.
    if (ptr.move !== null) {
      const dx = ptr.mx - joy.x, dd = ptr.my - joy.y, l = Math.hypot(dx, dd);
      if (l > 10) { aim.ang = Math.atan2(dd, dx); aim.power = clamp((l - 10) / (joy.r - 10), 0.15, 1); }
    }
    accelTo(p, aim.lvx, aim.lvd, dt);
    return;
  }
  if (ptr.move !== null) {
    recordFlick((ptr.mx - joy.x) / joy.r, (ptr.my - joy.y) / joy.r);
    // virtual joystick: direction = finger relative to circle centre, speed = distance from centre
    const dx = ptr.mx - joy.x, dd = ptr.my - joy.y, dist = Math.hypot(dx, dd);
    if (dist > 10) {
      p.want = Math.min(1, (dist - 10) / (joy.r - 10));
      p.fx = dx / dist; p.fd = dd / dist;
      const sp = p.want * maxSpeed(p);
      accelTo(p, p.fx * sp, p.fd * sp, dt);
      return;
    }
  }
  accelTo(p, 0, 0, dt);
}

// ---------- Aiming ----------
function startAim() {
  if (phase !== 'play' || busy(me)) return;
  if (!(owner === me || (dist2(me, ball) < KICK_R * 1.3 && ball.z < 40))) return;
  aim.active = true; aim.t0 = nowS();
  aim.lvx = me.vx; aim.lvd = me.vd;
  aim.ang = Math.atan2(me.fd, me.fx); aim.power = 0.5;
}
const aimShakeFrac = () => Math.min(1, (nowS() - aim.t0) / AIM_SHAKE_TIME);
function aimAngle() {
  const t = nowS() - aim.t0, amp = AIM_SHAKE_MAX * Math.pow(aimShakeFrac(), 1.6);
  return aim.ang + amp * (Math.sin(t * 7.3) * 0.6 + Math.sin(t * 12.9 + 1.3) * 0.4);
}
function releaseAim() {
  if (!aim.active) return;
  const a = aimAngle();
  aim.active = false;
  if (phase !== 'play') return;
  me.fx = Math.cos(a); me.fd = Math.sin(a);
  doKick(me, aim.power);
}

// ---------- Feints (joystick flicks) ----------
// up-down-up (or down-up-down) next to the CPU = dazzle it for a second
// right-left-right with the CPU in front = chip the ball over it
function recordFlick(nx, ny) {
  if (Math.hypot(nx, ny) < 0.45) return;
  let k;
  if (Math.abs(ny) > Math.abs(nx) * 1.2) k = ny < 0 ? 'U' : 'D';
  else if (Math.abs(nx) > Math.abs(ny) * 1.2) k = nx > 0 ? 'R' : 'L';
  else return;
  const T = feint.tokens, t = nowS();
  if (T.length && T[T.length - 1].k === k) return;
  T.push({ k, t }); while (T.length > 3) T.shift();
  if (T.length === 3 && t - T[0].t < FEINT_WINDOW) tryFeint(T.map(o => o.k).join(''));
}
function tryFeint(seq) {
  if (feint.cd > 0 || owner !== me || phase !== 'play') return;
  const o = cpu;
  if ((seq === 'UDU' || seq === 'DUD') && dist2(me, o) < 170 && o.dazzle <= 0 && o.dazImm <= 0 && o.stun <= 0) {
    o.dazzle = DAZZLE_TIME * (2 - aiSkill()); o.vx *= 0.3; o.vd *= 0.3;
    feint.cd = FEINT_CD; feint.tokens.length = 0;
    popup('Dazzled!', o.x, o.d, '#ffd23f'); beep(880, 0.08, 'triangle', 0.15); beep(1320, 0.12, 'triangle', 0.1);
  } else if (seq === 'RLR' && o.x > me.x && o.x - me.x < 240 && Math.abs(o.d - me.d) < 100) {
    ball.vx = 300; ball.vd = me.vd * 0.3; ball.vz = 420; ball.z = Math.max(ball.z, 1);
    me.ng = 0.2; owner = null;
    feint.cd = FEINT_CD; feint.tokens.length = 0;
    popup('Over the top!', me.x, me.d, '#7ee081'); beep(500, 0.15, 'triangle', 0.25);
  }
}

// ---------- AI ----------
function aiThink(p, dt) {
  if (busy(p)) return;
  if (p.dazzle > 0) { accelTo(p, 0, 0, dt * 0.7); return; }
  const opp = me, dB = dist2(p, ball);
  let tx, td, frac;
  if (owner === p) {
    // Attack towards x = 0. If the defender blocks the way, swerve to one side.
    const blocking = opp.x < p.x && opp.x > p.x - 140 && Math.abs(opp.d - p.d) < 70;
    if (blocking && Math.abs(p.aim) < 80) p.aim = (opp.d < p.d ? 1 : -1) * (110 + Math.random() * 60);
    tx = 0; td = clamp(p.d + p.aim * 0.6 + (FD / 2 - p.d) * 0.2, 30, FD - 30);
    tx = p.x - 200;
    frac = blocking ? 0.95 : 0.65;
    if (p.stam < 0.25) frac = 0.5;
    const dGoal = Math.hypot(p.x, p.d - FD / 2);
    const shootRate = dGoal < 230 ? 2.5 : dGoal < 330 ? 0.8 : dGoal < 480 ? 0.15 : 0;
    if (Math.random() < dt * shootRate) {
      const gx = -p.x, gd = FD / 2 + (Math.random() - 0.5) * 110 - p.d, gl = Math.hypot(gx, gd);
      p.fx = gx / gl; p.fd = gd / gl;
      doKick(p, 0.3 + Math.random() * 0.5);
      return;
    }
  } else if (owner === opp) {
    // Defend goal at x = FW. Walk in carefully; only sprint if beaten.
    const beaten = opp.x > p.x + 8;
    const dO = dist2(p, opp);
    if (beaten) { tx = opp.x + 45; td = opp.d; frac = 1; }
    else {
      const vx = FW - ball.x, vd = FD / 2 - ball.d, l = Math.hypot(vx, vd) || 1;
      const stand = dO > 220 ? 90 : 50;
      tx = ball.x + vx / l * stand; td = ball.d + vd / l * stand;
      const off = Math.hypot(tx - p.x, td - p.d);
      frac = dO > 300 ? 0.6 : dO > 150 ? 0.42 : 0.32;
      if (off > 70) frac = Math.max(frac, 0.8);
      if (dO < 46 && p.tcd <= 0 && Math.random() < dt * 1.3 * aiSkill()) {
        const l2 = dB || 1; p.fx = (ball.x - p.x) / l2; p.fd = (ball.d - p.d) / l2;
        doTackle(p); return;
      }
    }
  } else {
    // Loose ball: race for it if you can win it, otherwise drop back goal-side.
    const meFirst = dB < dist2(opp, ball) * 1.3 || ball.x > p.x;
    if (meFirst) { tx = ball.x + ball.vx * 0.3; td = ball.d + ball.vd * 0.3; frac = p.stam < 0.3 && dB > 200 ? 0.55 : 1; }
    else { tx = (ball.x + FW) / 2 + 60; td = (ball.d + FD / 2) / 2; frac = 0.6; }
    p.aim = (Math.random() - 0.5) * 100;
  }
  const dx = tx - p.x, dd = td - p.d, dist = Math.hypot(dx, dd);
  if (dist > 4) {
    p.fx = dx / dist; p.fd = dd / dist;
    const sp = Math.min(frac * maxSpeed(p), dist * 3);
    accelTo(p, p.fx * sp, p.fd * sp, dt);
  } else accelTo(p, 0, 0, dt);
  p.aim *= Math.exp(-0.6 * dt);
}

// ---------- Actions ----------
function doKick(p, power) {
  if (p.stun > 0 || p.slide > 0) return;
  if (dist2(p, ball) > KICK_R || ball.z > 40) return;
  const c = clamp(power, 0, 1);
  const pw = (300 + 600 * c) * (0.75 + 0.25 * p.stam) * (0.92 + Math.random() * 0.16);
  // accuracy: the further from the goal you're attacking, the bigger the random error
  const gx = p.ai ? 0 : FW, dGoal = Math.hypot(gx - p.x, FD / 2 - p.d);
  const spread = (SHOT_SPREAD_NEAR + SHOT_SPREAD_FAR * Math.pow(dGoal / FW, 1.3))
               * (0.8 + 0.5 * c) * (1 + 0.6 * (1 - p.stam)) * (sprinting(p) ? 1.3 : 1) / (p.ai ? aiSkill() : 1);
  const err = (Math.random() + Math.random() + Math.random() - 1.5) * 2 * spread;
  const cs = Math.cos(err), sn = Math.sin(err);
  const kx = p.fx * cs - p.fd * sn, kd = p.fx * sn + p.fd * cs;
  ball.vx = kx * pw + p.vx * 0.3;
  ball.vd = kd * pw + p.vd * 0.3;
  ball.vz = 60 + 300 * c * c;
  p.ng = 0.3; owner = null;
  beep(180 + 200 * c, 0.1, 'triangle', 0.3);
}
function doTackle(p) {
  if (busy(p) || p.tcd > 0 || p.stam < 0.1) return;
  if (kickoffLock && p !== kicker) return;
  if (p.spd > 40) { p.fx = p.vx / p.spd; p.fd = p.vd / p.spd; }
  p.slideV = Math.max(p.spd, 250) + 120 * p.stam;
  p.slide = 0.35; p.tcd = 1.1; p.stam = Math.max(0, p.stam - 0.12);
  if (!p.ai) beep(120, 0.12, 'sawtooth', 0.1);
}

function movePlayer(p, other, dt) {
  if (p.dazzle > 0) { p.dazzle -= dt; if (p.dazzle <= 0) p.dazImm = DAZZLE_IMMUNE; }
  else p.dazImm = Math.max(0, p.dazImm - dt);
  p.stun = Math.max(0, p.stun - dt); p.tcd = Math.max(0, p.tcd - dt); p.ng = Math.max(0, p.ng - dt);
  if (p.recover > 0) { p.recover -= dt; accelTo(p, 0, 0, dt); }
  if (p.stun > 0) accelTo(p, 0, 0, dt * 0.6);
  if (p.slide > 0) {
    p.slide -= dt;
    p.vx = p.fx * p.slideV; p.vd = p.fd * p.slideV;
    if (dist2(p, ball) < 32 && ball.z < 20) {
      ball.vx = p.fx * 300 + (Math.random() - 0.5) * 120;
      ball.vd = p.fd * 300 + (Math.random() - 0.5) * 120;
      ball.vz = 60; p.ng = 0.25; owner = null;
    }
    if (other.stun <= 0 && dist2(other, p) < PR * 2 + 6) {
      other.stun = 0.9; other.ng = 0.9; if (owner === other) owner = null;
      beep(90, 0.15, 'square', 0.15);
    }
    if (p.slide <= 0) { p.recover = 0.4; p.vx *= 0.25; p.vd *= 0.25; }
  }
  p.x = clamp(p.x + p.vx * dt, -20, FW + 20);
  p.d = clamp(p.d + p.vd * dt, 0, FD);
  p.spd = Math.hypot(p.vx, p.vd);
  if (p.spd > 20) p.hx = p.vx / p.spd;
  p.run += p.spd * dt * 0.06;
  // fatigue
  const f = p.spd / topSpeed(p);
  if (f > WALK_FRAC) p.stam -= ((f - WALK_FRAC) / (1 - WALK_FRAC)) * DRAIN * dt;
  else p.stam += RECOVER * (1 - f / WALK_FRAC * 0.7) * dt;
  p.stam = clamp(p.stam, 0, 1);
}

function canControl(p) {
  return p.stun <= 0 && p.ng <= 0 && p.slide <= 0 && ball.z < 14 && dist2(p, ball) < DRIBBLE_R;
}
function dribble() {
  const prev = owner;
  if (!(owner && canControl(owner))) {            // the current owner keeps the ball until tackled or it's kicked
    const a = canControl(me), b = canControl(cpu);
    owner = a && b ? (dist2(me, ball) < dist2(cpu, ball) ? me : cpu) : a ? me : b ? cpu : null;
  }
  if (!owner) return;
  const p = owner;
  if (prev !== p && p.ai) p.aim = (Math.random() - 0.5) * 100;
  // ball sits in front of the direction you're actually moving (or facing when slow)
  let hx = p.fx, hd = p.fd;
  if (p.spd > 40) { hx = p.vx / p.spd; hd = p.vd / p.spd; }
  const off = PR + BR + 2;
  const tx = p.x + hx * off, td = p.d + hd * off;
  ball.vx = p.vx + (tx - ball.x) * 12;
  ball.vd = p.vd + (td - ball.d) * 12;
  ball.vz = 0; ball.z = 0;
}

function ballPhysics(dt, detectGoals) {
  for (let i = 0; i < 3; i++) ballStep(dt / 3, detectGoals);
}
function clang(vn) {
  if (Math.abs(vn) < 60) return;
  beep(1250, 0.12, 'square', 0.1); beep(880, 0.25, 'triangle', 0.12);
  if (Math.abs(vn) > 200) popup('Clang!', ball.x, ball.d, '#ddd');
}
function goalFrame() {
  const m = BR + POST_R;
  for (const gx of [0, FW]) {
    for (const pd of [FD / 2 - GOAL_HALF, FD / 2 + GOAL_HALF]) {          // posts
      if (ball.z + BR > GOAL_H) continue;
      const dx = ball.x - gx, dd = ball.d - pd, l = Math.hypot(dx, dd);
      if (l < m && l > 0) {
        const nx = dx / l, nd = dd / l, vn = ball.vx * nx + ball.vd * nd;
        if (vn < 0) { ball.vx -= 1.7 * vn * nx; ball.vd -= 1.7 * vn * nd; clang(vn); }
        ball.x = gx + nx * m; ball.d = pd + nd * m;
      }
    }
    if (Math.abs(ball.d - FD / 2) < GOAL_HALF) {                         // crossbar
      const dx = ball.x - gx, dz = ball.z + BR - GOAL_H, l = Math.hypot(dx, dz);
      if (l < m && l > 0) {
        const nx = dx / l, nz = dz / l, vn = ball.vx * nx + ball.vz * nz;
        if (vn < 0) { ball.vx -= 1.7 * vn * nx; ball.vz -= 1.7 * vn * nz; clang(vn); }
        ball.x = gx + nx * m; ball.z = GOAL_H + nz * m - BR;
      }
    }
  }
}
function ballStep(dt, detectGoals) {
  ball.x += ball.vx * dt; ball.d += ball.vd * dt; ball.z += ball.vz * dt;
  if (ball.z > 0 || ball.vz > 0) ball.vz -= GRAVITY * dt;
  if (ball.z < 0) { ball.z = 0; ball.vz = ball.vz < -120 ? -ball.vz * 0.5 : 0; }
  const fr = Math.exp(-(ball.z > 0 ? 0.3 : 1.5) * dt);
  ball.vx *= fr; ball.vd *= fr;
  if (ball.d < BR) { ball.d = BR; ball.vd = Math.abs(ball.vd) * 0.6; }
  if (ball.d > FD - BR) { ball.d = FD - BR; ball.vd = -Math.abs(ball.vd) * 0.6; }
  goalFrame();
  const inMouth = Math.abs(ball.d - FD / 2) < GOAL_HALF && ball.z + BR < GOAL_H;
  const inGoal = ball.x < 0 || ball.x > FW;
  if (!inGoal) {
    if (ball.x < BR && !inMouth) { ball.x = BR; ball.vx = Math.abs(ball.vx) * 0.6; }
    if (ball.x > FW - BR && !inMouth) { ball.x = FW - BR; ball.vx = -Math.abs(ball.vx) * 0.6; }
  } else {                                            // inside the net: back + side netting
    ball.d = clamp(ball.d, FD / 2 - GOAL_HALF + BR, FD / 2 + GOAL_HALF - BR);
    if (ball.x < -GOAL_DEPTH + BR) { ball.x = -GOAL_DEPTH + BR; ball.vx *= -0.15; }
    if (ball.x > FW + GOAL_DEPTH - BR) { ball.x = FW + GOAL_DEPTH - BR; ball.vx *= -0.15; }
    ball.z = Math.min(ball.z, GOAL_H * 0.8);
  }
  if (detectGoals && phase === 'play') {
    if (ball.x < -BR) goal(1);
    else if (ball.x > FW + BR) goal(0);
  }
}

function goal(team) {
  score[team]++;
  owner = null;
  nextHumanKicks = team === 1;                        // whoever conceded kicks off
  const won = score[team] >= MATCH_GOALS;
  msg = won ? (team === 0 ? 'YOU WIN! 🏆' : 'CPU wins – rematch?') : (team === 0 ? 'GOAL! 🎉' : 'CPU scores!');
  phase = won ? 'over' : 'goal'; phaseT = won ? 3.5 : 2.2;
  if (team === 0) [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'square', 0.12), i * 110));
  else beep(150, 0.4, 'sawtooth', 0.1);
}

function separate() {
  const dx = cpu.x - me.x, dd = cpu.d - me.d, dist = Math.hypot(dx, dd);
  if (dist > 0 && dist < PR * 2) {
    const push = (PR * 2 - dist) / 2, nx = dx / dist, nd = dd / dist;
    me.x -= nx * push; me.d -= nd * push; cpu.x += nx * push; cpu.d += nd * push;
  }
}

function updateCamera(dt) {
  const halfNear = (W / 2) / (F / D0);
  const lo = -GOAL_DEPTH - 70 + halfNear, hi = FW + GOAL_DEPTH + 70 - halfNear;
  const target = clamp(ball.x * 0.75 + me.x * 0.25, lo, hi);
  camX += ((lo > hi ? FW / 2 : target) - camX) * Math.min(1, dt * 3);
}

function update(dt) {
  if (phase === 'menu' || !me) return;
  if (phase === 'ready') {
    phaseT -= dt;
    if (phaseT <= 0) { phase = 'play'; msg = ''; }
  } else if (phase === 'play') {
    feint.cd = Math.max(0, feint.cd - dt);
    if (aim.active && (me.stun > 0 || me.slide > 0 || (owner !== me && dist2(me, ball) > KICK_R * 2))) aim.active = false;
    humanInput(dt); aiThink(cpu, dt);
    movePlayer(me, cpu, dt); movePlayer(cpu, me, dt);
    separate(); enforceKickoff(dt); dribble(); ballPhysics(dt, true);
    if (sprint.active) { sprint.t -= dt; if (sprint.t <= 0) endSprint(); }
  } else {                                            // 'goal' or 'over': let things settle
    for (const p of [me, cpu]) { p.slide = 0; p.want = 0; accelTo(p, 0, 0, dt); movePlayer(p, p === me ? cpu : me, dt); }
    ballPhysics(dt, false);
    phaseT -= dt;
    if (phaseT <= 0) {
      if (phase === 'goal') setupKickoff(nextHumanKicks);
      else { phase = 'menu'; msg = ''; document.getElementById('start').style.display = 'flex'; }
    }
  }
  if (!sprint.active) sprint.cd = Math.max(0, sprint.cd - dt);
  updateCamera(dt);
}

// Keep the player without the ball outside the centre circle until the ball leaves it.
function enforceKickoff(dt) {
  if (!kickoffLock) return;
  kickoffT += dt;
  if (Math.hypot(ball.x - FW / 2, ball.d - FD / 2) > CIRCLE_R || kickoffT > 5) { kickoffLock = false; return; }
  const o = kicker === me ? cpu : me;
  const dx = o.x - FW / 2, dd = o.d - FD / 2, l = Math.hypot(dx, dd) || 1, minR = CIRCLE_R + PR;
  if (l < minR) {
    const nx = dx / l, nd = dd / l;
    o.x = FW / 2 + nx * minR; o.d = FD / 2 + nd * minR;
    const inward = o.vx * nx + o.vd * nd;
    if (inward < 0) { o.vx -= inward * nx; o.vd -= inward * nd; }
  }
}

// ---------- Rendering ----------
function poly(pts, fill, stroke, lw) {
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
}
function line(x1, d1, x2, d2) {
  const a = P(x1, d1), b = P(x2, d2);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}

function drawStadium() {
  // crowd / stands
  const g = ctx.createLinearGradient(0, 0, 0, P(0, -40)[1]);
  g.addColorStop(0, '#1b2238'); g.addColorStop(1, '#2d3554');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // simple crowd dots
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  const top = P(0, -40, 34)[1];
  for (let i = 0; i < 160; i++) {
    const x = ((i * 97.3 + camX * 0.6) % (W + 40)) - 20, y = (i * 53.7) % Math.max(10, top - 10);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }
  // grass surround
  const X0 = -260, X1 = FW + 260;
  poly([P(X0, -40), P(X1, -40), P(X1, FD + 200), P(X0, FD + 200)], '#1f7a36');
  // advertising boards along the far side (generic, no brands)
  const seg = 160, cols = ['#ffffff', '#ffd23f', '#3fa7ff', '#ffffff', '#ff6b6b'];
  ctx.font = '800 1px system-ui';
  for (let x = X0, i = 0; x < X1; x += seg, i++) {
    poly([P(x, -40, 0), P(x + seg, -40, 0), P(x + seg, -40, 34), P(x, -40, 34)], cols[i % cols.length], 'rgba(0,0,0,.25)', 1);
    const [cx, cy] = P(x + seg / 2, -40, 17), k = scaleAt(-40);
    ctx.fillStyle = '#1b2238'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${16 * k}px system-ui`;
    ctx.fillText(i % 2 ? '⚽ KICK-ABOUT' : 'HAPPY BIRTHDAY!', cx, cy);
  }
}

function drawPitch() {
  const n = 11;
  for (let i = 0; i < n; i++) {
    const x0 = FW * i / n, x1 = FW * (i + 1) / n + 0.5;
    poly([P(x0, 0), P(x1, 0), P(x1, FD), P(x0, FD)], i % 2 ? '#2fa24b' : '#29943f');
  }
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  line(0, 0, FW, 0); line(FW, 0, FW, FD); line(FW, FD, 0, FD); line(0, FD, 0, 0);
  line(FW / 2, 0, FW / 2, FD);
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = i / 48 * Math.PI * 2, p = P(FW / 2 + Math.cos(a) * 75, FD / 2 + Math.sin(a) * 75);
    i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
  }
  ctx.stroke();
  for (const side of [0, 1]) {
    const x = side ? FW : 0, s = side ? -1 : 1;
    line(x, FD / 2 - 140, x + s * 150, FD / 2 - 140); line(x + s * 150, FD / 2 - 140, x + s * 150, FD / 2 + 140);
    line(x + s * 150, FD / 2 + 140, x, FD / 2 + 140);
    line(x, FD / 2 - 70, x + s * 55, FD / 2 - 70); line(x + s * 55, FD / 2 - 70, x + s * 55, FD / 2 + 70);
    line(x + s * 55, FD / 2 + 70, x, FD / 2 + 70);
  }
}

function drawGoal(side, front) {
  const x = side ? FW : 0, bx = side ? FW + GOAL_DEPTH : -GOAL_DEPTH;
  const d1 = FD / 2 - GOAL_HALF, d2 = FD / 2 + GOAL_HALF, bh = GOAL_H * 0.8;
  const net = 'rgba(255,255,255,.16)', netLine = 'rgba(255,255,255,.4)';
  if (!front) {
    poly([P(bx, d1, 0), P(bx, d2, 0), P(bx, d2, bh), P(bx, d1, bh)], net, netLine, 1);           // back
    poly([P(x, d1, 0), P(bx, d1, 0), P(bx, d1, bh), P(x, d1, GOAL_H)], net, netLine, 1);          // far side
    poly([P(x, d1, GOAL_H), P(bx, d1, bh), P(bx, d2, bh), P(x, d2, GOAL_H)], net, netLine, 1);    // roof
    ctx.strokeStyle = netLine; ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const dd = d1 + (d2 - d1) * i / 8, a = P(bx, dd, 0), b = P(bx, dd, bh), c = P(x, dd, GOAL_H);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, 4 * scaleAt(d1));
    const a = P(x, d1, 0), b = P(x, d1, GOAL_H);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();               // far post
  } else {
    poly([P(x, d2, 0), P(bx, d2, 0), P(bx, d2, bh), P(x, d2, GOAL_H)], net, netLine, 1);          // near side net
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, 4 * scaleAt(d2));
    const a = P(x, d1, GOAL_H), b = P(x, d2, GOAL_H), c = P(x, d2, 0);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
  }
}

function drawPlayer(p) {
  const [sx, sy] = P(p.x, p.d), s = scaleAt(p.d);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(sx, sy, PR * s, PR * s * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(sx, sy);
  const dir = p.hx >= 0 ? 1 : -1;
  if (p.slide > 0) ctx.rotate(dir * 1.1);
  const swing = p.spd > 20 ? Math.sin(p.run) * Math.min(10, p.spd / 25) : 0;
  const tiredLean = (1 - p.stam) * 4 * dir;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 5 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-3 * s, -20 * s); ctx.lineTo((-3 + swing) * s, 0);
  ctx.moveTo(3 * s, -20 * s); ctx.lineTo((3 - swing) * s, 0); ctx.stroke();
  ctx.fillStyle = p.col;
  ctx.beginPath(); ctx.roundRect((-10 + tiredLean * 0.5) * s, -44 * s, 20 * s, 26 * s, 5 * s); ctx.fill();
  ctx.fillStyle = '#f2c79b';
  ctx.beginPath(); ctx.arc(tiredLean * s, -54 * s, 10 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc((tiredLean + dir * 4) * s, -55 * s, 1.8 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // stamina bar
  const bw = 34 * s, by = sy - 74 * s;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(sx - bw / 2 - 1, by - 1, bw + 2, 6 * s + 2);
  ctx.fillStyle = p.stam > 0.5 ? '#5ad65a' : p.stam > 0.25 ? '#ffd23f' : '#ff5a4f';
  ctx.fillRect(sx - bw / 2, by, bw * p.stam, 6 * s);
  if (p.dazzle > 0) {
    ctx.font = `${20 * s}px system-ui`; ctx.textAlign = 'center';
    const t = performance.now() / 90;
    for (let i = 0; i < 3; i++) ctx.fillText('⭐', sx + Math.cos(t + i * 2.1) * 16 * s, by - 8 * s + Math.sin(t + i * 2.1) * 5 * s);
  } else if (p.stun > 0) {
    ctx.font = `${16 * s}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText('💫', sx + Math.sin(performance.now() / 120) * 8 * s, by - 10 * s);
  } else if (p.stam < 0.2) {
    ctx.font = `${14 * s}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText('💦', sx + 16 * s * dir, by - 8 * s);
  }
}

function drawArrow(p) {
  if (p.stun > 0 || p.slide > 0) return;
  const frac = Math.max(p.want, 0), len = 24 + 70 * frac;
  const a = P(p.x + p.fx * (PR + 6), p.d + p.fd * (PR + 6));
  const b = P(p.x + p.fx * (PR + 6 + len), p.d + p.fd * (PR + 6 + len));
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = 13 * scaleAt(p.d);
  ctx.strokeStyle = ctx.fillStyle = `rgba(255,230,60,${0.5 + 0.45 * frac})`;
  ctx.lineWidth = 5 * scaleAt(p.d); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(b[0] + Math.cos(ang) * h, b[1] + Math.sin(ang) * h);
  ctx.lineTo(b[0] + Math.cos(ang + 2.4) * h, b[1] + Math.sin(ang + 2.4) * h);
  ctx.lineTo(b[0] + Math.cos(ang - 2.4) * h, b[1] + Math.sin(ang - 2.4) * h); ctx.fill();
}

function drawBall() {
  const s = scaleAt(ball.d), g = P(ball.x, ball.d), b = P(ball.x, ball.d, ball.z + BR);
  const shrink = 1 / (1 + ball.z / 120);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(g[0], g[1], BR * s * shrink, BR * s * 0.45 * shrink, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(b[0], b[1], BR * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#222';
  const rot = ball.x / BR;
  ctx.beginPath(); ctx.arc(b[0] + Math.cos(rot) * BR * s * 0.4, b[1] + Math.sin(rot) * BR * s * 0.4, BR * s * 0.35, 0, Math.PI * 2); ctx.fill();
}

function drawButton(b, active, charge) {
  ctx.globalAlpha = active ? 0.95 : 0.6;
  ctx.fillStyle = b.col;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  if (charge > 0) {                                      // aim shakiness building up
    ctx.strokeStyle = `rgb(255,${Math.round(230 - 190 * charge)},${Math.round(80 - 60 * charge)})`; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#222';
  ctx.font = `800 ${b.r * 0.36}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(b.label, b.x, b.y);
}

function render() {
  drawStadium();
  if (!me) return;
  drawPitch();
  drawGoal(0, false); drawGoal(1, false);
  const items = [me, cpu, ball].sort((a, b) => a.d - b.d);
  for (const it of items) {
    if (it === ball) drawBall();
    else { if (!it.ai && !aim.active) drawArrow(it); drawPlayer(it); }
  }
  drawAim();
  drawPopups();
  drawGoal(0, true); drawGoal(1, true);

  if (aim.active) { ctx.fillStyle = 'rgba(10,20,70,.16)'; ctx.fillRect(0, 0, W, H); }
  // HUD
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath(); ctx.roundRect(W / 2 - 150, 10, 300, 52, 12); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 30px system-ui';
  ctx.fillStyle = '#ff7b84'; ctx.fillText('YOU', W / 2 - 95, 36);
  ctx.fillStyle = '#7fb2ff'; ctx.fillText('CPU', W / 2 + 95, 36);
  ctx.fillStyle = '#fff'; ctx.fillText(`${score[0]} : ${score[1]}`, W / 2, 36);
  if (msg) {
    ctx.font = '900 68px system-ui'; ctx.lineWidth = 8; ctx.strokeStyle = '#0d3b1a';
    ctx.strokeText(msg, W / 2, H * 0.42); ctx.fillText(msg, W / 2, H * 0.42);
  }
  if (playing()) {
    drawButton(btnK, aim.active, aim.active ? aimShakeFrac() : 0); drawButton(btnT, me.slide > 0, 0);
    drawSprintButton(); drawJoystick();
  }
}

function drawAim() {
  if (!aim.active) return;
  const a = aimAngle(), ax = Math.cos(a), ad = Math.sin(a), len = 80 + 320 * aim.power, k = aimShakeFrac();
  const st = P(ball.x, ball.d), en = P(ball.x + ax * len, ball.d + ad * len);
  const col = `rgba(255,${Math.round(255 - 200 * k)},${Math.round(255 - 220 * k)},0.85)`;
  ctx.save();
  ctx.setLineDash([12, 9]); ctx.lineWidth = 4; ctx.strokeStyle = col;
  ctx.beginPath(); ctx.moveTo(st[0], st[1]); ctx.lineTo(en[0], en[1]); ctx.stroke();
  ctx.setLineDash([]);
  const r = 10 * scaleAt(ball.d + ad * len);
  ctx.beginPath(); ctx.ellipse(en[0], en[1], r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawPopups() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const p of popups) {
    const [sx, sy] = P(p.x, p.d), s = scaleAt(p.d), rise = (1.3 - p.t) * 40;
    ctx.globalAlpha = Math.min(1, p.t / 0.4);
    ctx.font = `900 ${22 * s}px system-ui`; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeText(p.txt, sx, sy - 95 * s - rise); ctx.fillStyle = p.col; ctx.fillText(p.txt, sx, sy - 95 * s - rise);
  }
  ctx.globalAlpha = 1;
}

function drawJoystick() {
  ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(joy.x, joy.y, joy.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(joy.x, joy.y, 10, 0, Math.PI * 2); ctx.stroke();
  let kx = joy.x, ky = joy.y;
  if (ptr.move !== null) {
    const dx = ptr.mx - joy.x, dy = ptr.my - joy.y, l = Math.hypot(dx, dy), m = Math.min(l, joy.r);
    if (l > 0) { kx += dx / l * m; ky += dy / l * m; }
  }
  ctx.fillStyle = ptr.move !== null ? 'rgba(255,230,60,.75)' : 'rgba(255,255,255,.4)';
  ctx.beginPath(); ctx.arc(kx, ky, joy.r * 0.36, 0, Math.PI * 2); ctx.fill();
}

function drawSprintButton() {
  const b = btnS, ready = sprint.cd <= 0 && !sprint.active;
  ctx.globalAlpha = sprint.active ? 0.95 : ready ? 0.65 : 0.3;
  ctx.fillStyle = b.col;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1; ctx.lineWidth = 8;
  if (sprint.active) {                                   // remaining sprint time
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sprint.t / SPRINT_TIME); ctx.stroke();
  } else if (sprint.cd > 0) {                            // cooldown filling up
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - sprint.cd / SPRINT_CD)); ctx.stroke();
  }
  ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${b.r * 0.34}px system-ui`;
  ctx.fillText(sprint.cd > 0 && !sprint.active ? Math.ceil(sprint.cd) + 's' : b.label, b.x, b.y);
}

// ---------- Loop ----------
let last = performance.now();
function frame(t) {
  const dt = Math.min(1 / 30, (t - last) / 1000); last = t;
  update(dt * (aim.active ? SLOWMO : 1));
  for (let i = popups.length - 1; i >= 0; i--) if ((popups[i].t -= dt) <= 0) popups.splice(i, 1);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
