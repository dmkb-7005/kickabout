// =====================================================================
//  Kick-About – penalty shoot-out ("Elfmeterschießen")
//  Front view of the right-hand goal. Unlocked after 5 wins in total.
//  Shares the globals of game.js (canvas, skins, players, buttons, joystick …).
// =====================================================================
const SO_KICKS = 5;                         // kicks each, then sudden death
const SO_CHARGE_T = 1.5;                    // seconds of holding the button to reach full power
const SO_MIN_POWER = 1 / 3;                 // weaker kicks are always caught
const SO_SHAKE = 30;                        // wobble of the aim point at full power (world units)
const SO_REACH = { d: 44, z: 46 };          // Onkel's reach around his dive point
const SO_KID_REACH = { d: 52, z: 54 };      // Mark's reach (a little more forgiving)
const SO_SPOT = FW - PEN_SPOT;              // the penalty spot (x)
const SO_GX = FW - 10;                      // the keeper stands just in front of the goal line
const SO_CAM_X = SO_SPOT - 200, SO_CAM_Z = 55;
const SO_C = FD / 2;                        // centre of the goal (d)
// where a keeper can dive: [lateral -1/0/1, hand height]; 0 = stays in the middle
const SO_ZONES = [[-1, 18], [-1, 68], [0, 45], [1, 18], [1, 68]];
const SO_ZONE_D = 58;                       // lateral distance of a dive from the centre
const SO_KEEPER_K = 0.75;                   // keeper drawn a bit smaller up close, so the goal looks big enough
const SO_BALL_R = 7;                        // drawn ball radius (world units) – the side-view ball would look huge up close
const BTN_POWER = Object.assign({}, BTN.kick, { label: 'KRAFT…' });
// The net: opaque white tiles. On a goal they flash green (Mark scores) or red (Onkel scores) and shatter like glass.
const NET_COL = { human: [47, 210, 90], cpu: [232, 52, 58] };
const NET_FLASH = 0.22, NET_SHATTER = 0.3;              // seconds from the ball hitting the net: colour spreads, then it breaks

// ---------- front-view projection ----------
let soF = 1, soHZ = 0;
function soResize() { soF = H * 1.71; soHZ = H * 0.41; }
function Q(x, d, z = 0) {                   // world → screen in the front view: [x, y, scale]
  const depth = Math.max(20, x - SO_CAM_X), k = soF / depth;
  return [W / 2 + (d - SO_C) * k, soHZ + (SO_CAM_Z - z) * k, k];
}

// ---------- state ----------
function soReset() {
  Object.assign(SO, {
    active: true, stage: 'intro', t: 0, turn: 0, fade: 0,
    kicks: [[], []],                        // results per side: true = goal
    kickerHuman: true,                      // Mark starts
    msg: '', msgT: 0,
    power: 0, charging: false, aimD: SO_C, aimZ: 30,
    intent: { i: 2, d: SO_C, z: 45, next: 0 },   // the keeper's (or CPU kicker's) wandering arrow
    cpuKick: null, flight: null, result: null, nextT: 0, ended: false,
  });
}
const soScore = side => SO.kicks[side].filter(Boolean).length;

function soStart() {
  soReset(); soResize();
  score = [0, 0]; particles.length = 0; popups.length = 0; toasts.length = 0;
  me = mkPlayer(SO_SPOT - 40, '#e63946', false); me.shorts = '#1f5a2e';
  cpu = mkPlayer(SO_GX, '#2f6fe0', true); cpu.shorts = '#d8c9a3';
  me.d = SO_C + 12; cpu.d = SO_C; me.hx = 1; cpu.hx = -1;
  ball = { x: SO_SPOT, d: SO_C, z: 0, vx: 0, vd: 0, vz: 0, held: null, wild: false, out: false };
  owner = null; aim.active = false; ptr.move = ptr.kick = ptr.sprint = null;
  phase = 'shootout'; msg = ''; celeb = null;
  updateCamera(1); updateCamera(1);
  soSay('Elfmeterschießen!');
  beep(880, 0.25, 'square', 0.12); setTimeout(() => beep(880, 0.5, 'square', 0.12), 300);   // whistle
}
function soSay(t) { SO.msg = t; SO.msgT = performance.now(); }

// ---------- roles ----------
const soKeeper = () => SO.kickerHuman ? cpu : me;
function soBuildNet() {
  const d1 = SO_C - GOAL_HALF, d2 = SO_C + GOAL_HALF, bx = FW + GOAL_DEPTH, bh = GOAL_H * 0.8, tiles = [];
  // a panel = 4 world corners (p00, p10, p01, p11), split into nu × nv tiles
  const panel = (p00, p10, p01, p11, nu, nv, shade) => {
    const at = (u, v) => [0, 1, 2].map(i => (p00[i] * (1 - u) + p10[i] * u) * (1 - v) + (p01[i] * (1 - u) + p11[i] * u) * v);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const c = [at(i / nu, j / nv), at((i + 1) / nu, j / nv), at((i + 1) / nu, (j + 1) / nv), at(i / nu, (j + 1) / nv)];
      const m = [0, 1, 2].map(k => c.reduce((a, p) => a + p[k], 0) / 4);
      tiles.push({ c, m, shade, off: [0, 0, 0], v: null, rot: 0, w: 0 });
    }
  };
  panel([bx, d1, 0], [bx, d2, 0], [bx, d1, bh], [bx, d2, bh], 12, 6, 1);                 // back
  panel([FW, d1, 0], [bx, d1, 0], [FW, d1, GOAL_H], [bx, d1, bh], 3, 6, 0.8);            // left side
  panel([FW, d2, 0], [bx, d2, 0], [FW, d2, GOAL_H], [bx, d2, bh], 3, 6, 0.8);            // right side
  panel([FW, d1, GOAL_H], [FW, d2, GOAL_H], [bx, d1, bh], [bx, d2, bh], 12, 2, 0.9);     // roof
  SO.net = { tiles, hit: null };
}
function soNetHit(d, z) {                               // the ball has hit the net: start the flash
  if (!SO.net || SO.net.hit) return;
  SO.net.hit = { t: 0, d, z, col: SO.kickerHuman ? NET_COL.human : NET_COL.cpu };
}
function soUpdateNet(dt) {
  const N = SO.net; if (!N || !N.hit) return;
  const h = N.hit; h.t += dt;
  for (const T of N.tiles) {
    const delay = Math.hypot(T.m[1] - h.d, T.m[2] - h.z) / 600;   // spreads out from where the ball hit
    if (!T.v && h.t > NET_SHATTER + delay * 0.8) {
      const dd = T.m[1] - h.d, dz = T.m[2] - h.z, l = Math.hypot(dd, dz) || 1;
      T.v = [60 - Math.random() * 170, dd / l * (70 + Math.random() * 170), 90 + dz / l * 120 + Math.random() * 170];   // mostly outwards and up, a few towards us
      T.w = (Math.random() - 0.5) * 14; T.life = 1.1 + Math.random() * 0.5;
      if (!h.sound) { h.sound = 1; noise(0.45, 0.35); beep(2300, 0.05, 'square', 0.06); beep(1700, 0.08, 'triangle', 0.08); }
    }
    if (T.v) {
      T.v[2] -= GRAVITY * 0.7 * dt;
      for (let k = 0; k < 3; k++) T.off[k] += T.v[k] * dt;
      T.rot += T.w * dt; T.life -= dt;
    }
  }
}
// still = the intact net (drawn behind the keeper); flying = the shards (drawn on top of everything)
function soDrawNet(flying) {
  const N = SO.net; if (!N) return;
  const h = N.hit;
  for (const T of N.tiles) {
    if (!!T.v !== flying || (T.v && T.life <= 0) || T.m[0] + T.off[0] < SO_CAM_X + 150) continue;   // (shards right in front of the camera would look huge)
    let f = 0;
    if (h) { const delay = Math.hypot(T.m[1] - h.d, T.m[2] - h.z) / 600; f = clamp((h.t - delay) / NET_FLASH, 0, 1); }
    const col = h ? h.col : [255, 255, 255];
    const r = Math.round(255 + (col[0] - 255) * f), g = Math.round(255 + (col[1] - 255) * f), b = Math.round(255 + (col[2] - 255) * f);
    const pts = T.c.map(p => Q(p[0] + T.off[0], p[1] + T.off[1], p[2] + T.off[2]));
    const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4;
    const cr = Math.cos(T.rot), sr = Math.sin(T.rot), shrink = T.v ? 0.88 : 0.9;      // gaps between tiles = the mesh
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const dx = (x - cx) * shrink, dy = (y - cy) * shrink, X = cx + dx * cr - dy * sr, Y = cy + dx * sr + dy * cr; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath();
    const a = (T.v ? Math.min(1, T.life / 0.4) : 1) * (0.42 + 0.4 * f) * T.shade;
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`; ctx.fill();
    if (f > 0 || T.v) { ctx.strokeStyle = `rgba(255,255,255,${0.7 * a})`; ctx.lineWidth = 1.5; ctx.stroke(); }   // glassy edge
  }
}
function soSetupKick() {
  const K = soKeeper(), Kk = K === me ? cpu : me;
  for (const p of [me, cpu]) { resetPose(p); p.rot = 0; p.z = 0; p.say = null; p.moodT = 0; }
  K.hidden = false; Kk.hidden = true;                 // only the goalkeeper is visible
  K.x = SO_GX; K.d = SO_C; K.pose = 'keeper'; K.hx = 1; setMood(K, 'determined', 99);
  Object.assign(ball, { x: SO_SPOT, d: SO_C, z: 0, held: null });
  SO.power = 0; SO.charging = false; SO.aimD = SO_C; SO.aimZ = 30; SO.flight = null; SO.result = null; SO.dive = null; SO.lastJoy = null;
  soBuildNet();
  SO.intent = { i: 2, d: SO_C, z: 45, next: 0.6 };
  if (!SO.kickerHuman) {                               // the CPU takes the kick
    const zone = Math.random() < 0.15 ? [0, 30 + Math.random() * 40] : [Math.random() < 0.5 ? -1 : 1, 15 + Math.random() * 65];
    SO.cpuKick = { t: 0, at: 2.4 + Math.random() * 2.2, power: 0.5 + Math.random() * 0.5, d: SO_C + zone[0] * (35 + Math.random() * 30), z: zone[1], next: 0.8 };
    SO.intent = { d: SO.cpuKick.d, z: SO.cpuKick.z };  // (used as the CPU's aim; eases towards cpuKick.d/z)
  } else SO.cpuKick = null;
  ptr.kick = null;
  SO.stage = 'ready'; SO.t = 0;
  soSay(SO.kickerHuman ? 'Du schießt!' : 'Du hältst!');
}

// ---------- input ----------
function soPointerDown(e) {
  if (SO.stage === 'end' && SO.t > 1.2) { soFinish(); return; }
  if (SO.stage !== 'aim' && SO.stage !== 'ready') return;
  if (SO.kickerHuman && hit(btnK, e)) {
    if (SO.stage === 'aim' && !SO.charging) { ptr.kick = e.pointerId; SO.charging = true; SO.power = 0; buzz(10); }
  } else if (ptr.move === null && Math.hypot(e.clientX - joy.x, e.clientY - joy.y) < joy.r * 1.7) {
    ptr.move = e.pointerId; ptr.mx = e.clientX; ptr.my = e.clientY;
  }
}
function soPointerUp(e) {
  if (e.pointerId === ptr.kick) { ptr.kick = null; if (SO.charging && SO.stage === 'aim') soHumanShoots(); SO.charging = false; }
}
function soCancelInput() { SO.charging = false; ptr.kick = null; }
function joyVec() {                                     // joystick deflection, length ≤ 1
  if (ptr.move === null) return null;
  const dx = (ptr.mx - joy.x) / joy.r, dy = (ptr.my - joy.y) / joy.r, l = Math.hypot(dx, dy);
  return l > 1 ? [dx / l, dy / l] : [dx, dy];
}

// ---------- aiming ----------
function soShake(power, t) {                             // the harder you kick, the jumpier the aim
  const a = SO_SHAKE * Math.pow(power, 1.5);
  return [a * (Math.sin(t * 9.1) * 0.6 + Math.sin(t * 15.7 + 1.1) * 0.4), a * 0.8 * (Math.sin(t * 8.3 + 2) * 0.6 + Math.sin(t * 13.9) * 0.4)];
}
function soWanderKeeper(dt) {                           // the CPU keeper keeps changing his mind
  const I = SO.intent;
  I.next -= dt;
  if (I.next <= 0) {
    let i; do i = Math.floor(Math.random() * SO_ZONES.length); while (i === I.i);
    I.i = i; I.next = 0.45 + Math.random() * 0.7;
  }
  const [side, z] = SO_ZONES[I.i];
  I.d += (SO_C + side * SO_ZONE_D - I.d) * Math.min(1, dt * 9);
  I.z += (z - I.z) * Math.min(1, dt * 9);
}
function soHumanShoots() {
  const t = performance.now() / 1000, [sd, sz] = soShake(SO.power, t);
  soKick(Math.max(0.05, SO.power), SO.aimD + sd, Math.max(0, SO.aimZ + sz));
}

// ---------- the kick, the dive, the result ----------
function soKick(power, td, tz) {
  const K = soKeeper(), human = K === me;
  let kd, kz;                                            // where the keeper's hands go
  if (human) { [kd, kz] = soMarkTarget(); }
  else { kd = SO.intent.d; kz = SO.intent.z; }
  const inMouth = Math.abs(td - SO_C) < GOAL_HALF - BR * 0.4 && tz < GOAL_H - BR * 0.4;
  const post = Math.abs(Math.abs(td - SO_C) - GOAL_HALF) < BR * 0.9 && tz < GOAL_H + BR;
  const bar = !post && Math.abs(tz - GOAL_H) < BR * 0.9 && Math.abs(td - SO_C) < GOAL_HALF + BR;
  const reach = human ? SO_KID_REACH : SO_REACH;
  let res;
  if (post || bar) res = post ? 'post' : 'bar';
  else if (!inMouth) res = 'miss';
  else if (power < SO_MIN_POWER) { res = 'caught'; kd = td; kz = tz; }          // too slow: the keeper just picks it up
  else if (Math.abs(td - kd) < reach.d && Math.abs(tz - kz) < reach.z) res = power > 0.82 && Math.random() < 0.5 ? 'parried' : 'caught';
  else res = 'goal';
  const T = 0.82 - 0.48 * power;                         // time until the ball reaches the goal line
  SO.flight = { t: 0, T, power, td, tz, res, from: { x: SO_SPOT, d: SO_C, z: 0 }, done: false };
  SO.dive = { t: 0, delay: human ? 0 : 0.06, d0: K.d, kd, kz, slow: power < SO_MIN_POWER };
  SO.charging = false; SO.stage = 'flight'; SO.t = 0;
  beep(150 + 90 * power, 0.07, 'triangle', 0.3); buzz(15);
}
function soMarkTarget() {                               // Mark as keeper: joystick = direction and length of the dive
  const v = joyVec() || SO.lastJoy || [0, 0];
  return [SO_C + v[0] * 88, clamp(45 - v[1] * 58, 8, 100)];
}
function soUpdateDive(dt) {
  const K = soKeeper(), D = SO.dive; if (!D) return;
  D.t += dt;
  const t = D.t - D.delay; if (t < 0) return;
  const dd = D.kd - SO_C, side = Math.sign(dd), far = Math.abs(dd) > 22;
  const p = clamp(t / (D.slow ? 0.6 : 0.42), 0, 1), e = 1 - Math.pow(1 - p, 2);
  if (far) {
    const bodyD = SO_C + dd * 0.78, bodyZ = Math.max(0, D.kz - 38) * 0.9 + 10;
    K.d = D.d0 + (bodyD - D.d0) * e;
    K.rot = side * (1.45 - 0.75 * clamp(D.kz / 95, 0, 1)) * e;
    K.pose = 'up'; K.hx = side;
    if (p < 1) K.z = bodyZ * Math.sin(p * Math.PI * 0.5);
    else { D.fall = (D.fall || 0) + dt; K.z = Math.max(0, bodyZ - 0.5 * GRAVITY * D.fall * D.fall); }
  } else {                                               // middle: a jump straight up, or just crouch
    K.d = D.d0 + (D.kd - D.d0) * e;
    if (D.kz > 62) { K.pose = 'up'; K.z = Math.max(0, Math.sin(clamp(t / 0.55, 0, 1) * Math.PI) * (D.kz - 55)); }
    else K.pose = 'keeper';
  }
}
function soHands(K) {                                    // rough position of the keeper's hands (for a caught ball)
  const L = 60 * SO_KEEPER_K;
  return { d: K.d + Math.sin(K.rot || 0) * L, z: (K.z || 0) + L * Math.cos(K.rot || 0) + 8 };
}
function soUpdateFlight(dt) {
  const F_ = SO.flight; if (!F_) return;
  F_.t += dt;
  const K = soKeeper();
  if (!F_.done) {
    const u = Math.min(1, F_.t / F_.T), arc = 14 * (1 - F_.power) * 4 * u * (1 - u);
    ball.x = F_.from.x + (FW - F_.from.x) * u;
    ball.d = F_.from.d + (F_.td - F_.from.d) * u;
    ball.z = F_.tz * u + arc;
    if (u >= 1) { F_.done = true; soArrive(); }
    return;
  }
  // after the goal line
  const r = F_.res;
  if (r === 'caught') {
    if (!F_.off) { const h = soHands(K); F_.off = { d: ball.d - h.d, z: ball.z - h.z }; }
    const h = soHands(K);
    ball.x = SO_GX - 6; ball.d += (h.d + F_.off.d * 0.3 - ball.d) * Math.min(1, dt * 10); ball.z += (Math.max(BR, h.z) - ball.z) * Math.min(1, dt * 10);
  } else {
    ball.vz -= GRAVITY * dt;
    ball.x += ball.vx * dt; ball.d += ball.vd * dt; ball.z += ball.vz * dt;
    if (r === 'goal' && ball.x > FW + GOAL_DEPTH - BR - 4) {
      soNetHit(ball.d, ball.z);
      if (SO.net && SO.net.hit && SO.net.hit.t < NET_SHATTER) { ball.x = FW + GOAL_DEPTH - BR - 4; ball.vx = 0; ball.vd *= 0.3; ball.vz = Math.min(ball.vz, 0); }
    }
    if (ball.z < 0) { ball.z = 0; ball.vz = Math.abs(ball.vz) * 0.4; ball.vx *= 0.7; ball.vd *= 0.7; }
  }
}
function soArrive() {
  const F_ = SO.flight, K = soKeeper(), sp = 900 + 900 * F_.power;
  const dir = { x: (FW - SO_SPOT), d: F_.td - SO_C, z: F_.tz }, l = Math.hypot(dir.x, dir.d, dir.z);
  switch (F_.res) {
    case 'goal':   ball.vx = sp * dir.x / l * 0.5; ball.vd = sp * dir.d / l * 0.5; ball.vz = 0; beep(200, 0.08, 'triangle', 0.2); break;
    case 'miss':   ball.vx = sp * dir.x / l * 0.8; ball.vd = sp * dir.d / l * 0.8; ball.vz = sp * dir.z / l * 0.8; break;
    case 'post': case 'bar':
      ball.vx = -300; ball.vd = (F_.td > SO_C ? 1 : -1) * (F_.res === 'post' ? 140 : 40); ball.vz = F_.res === 'bar' ? 160 : 60;
      beep(1250, 0.12, 'square', 0.1); beep(880, 0.25, 'triangle', 0.12); break;
    case 'parried': ball.vx = -260; ball.vd = Math.sign(F_.td - K.d || 1) * 260; ball.vz = 180; beep(120, 0.1, 'sawtooth', 0.15); break;
    case 'caught': beep(110, 0.12, 'triangle', 0.3); break;
  }
  SO.nextT = 0.55;
}
function soResolve() {
  const F_ = SO.flight, side = SO.kickerHuman ? 0 : 1, goal = F_.res === 'goal', K = soKeeper();
  SO.kicks[side].push(goal);
  const kickerIsMark = SO.kickerHuman;
  const texts = { goal: 'TOOOR!', miss: F_.tz > GOAL_H ? 'Drüber!' : 'Daneben!', post: 'Pfosten!', bar: 'Latte!',
    caught: F_.power < SO_MIN_POWER ? 'Zu schwach – gefangen!' : 'Gehalten!', parried: 'Abgewehrt!' };
  soSay(texts[F_.res]);
  if (goal) {
    setMood(K, K === me ? 'sad' : (Math.random() < 0.5 ? 'sad' : 'determined'), 99);
    if (K === cpu && Math.random() < 0.6) say(K, Math.random() < 0.5 ? 'Mist!' : 'Mann!!!', 1.6);
    if (kickerIsMark) [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'square', 0.1), i * 100));
  } else {
    const saved = F_.res === 'caught' || F_.res === 'parried';
    setMood(K, saved ? 'celebrate' : 'cheeky', 99);
    if (saved && K === me) { say(K, 'Gehalten!', 1.6); [659, 880].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'square', 0.1), i * 110)); }
    if (saved && K === cpu && Math.random() < 0.5) say(K, 'Hab ihn!', 1.4);
  }
  SO.stage = 'result'; SO.t = 0;
}
function soDecided() {                                  // has someone won?
  const a = SO.kicks[0].length, b = SO.kicks[1].length, sa = soScore(0), sb = soScore(1);
  if (a <= SO_KICKS && b <= SO_KICKS) {
    if (sa + (SO_KICKS - a) < sb) return 1;
    if (sb + (SO_KICKS - b) < sa) return 0;
    if (a < SO_KICKS || b < SO_KICKS) return -1;
  }
  if (a === b && sa !== sb) return sa > sb ? 0 : 1;   // sudden death after equal kicks
  return -1;
}

// ---------- update ----------
function soUpdate(dt) {
  soResize();
  SO.t += dt;
  for (let i = popups.length - 1; i >= 0; i--) if ((popups[i].t -= dt) <= 0) popups.splice(i, 1);
  for (const p of [me, cpu]) { if (p.say) { p.say.t -= dt; if (p.say.t <= 0) p.say = null; } if (p.moodT > 0 && p.moodT < 90) p.moodT -= dt; }
  const v = joyVec(); if (v) SO.lastJoy = v;
  soUpdateNet(dt);
  switch (SO.stage) {
    case 'intro':                                          // side view first …
      if (SO.t > 1.3) { SO.stage = 'turn'; SO.t = 0; soSetupKickSilently(); }
      break;
    case 'turn':                                           // … then the camera turns to face the goal
      SO.turn = Math.min(1, SO.t / 1.25);
      if (SO.t >= 1.25) { SO.turn = 1; soSetupKick(); }
      break;
    case 'ready':
      soAiming(dt);
      if (SO.t > 0.9) { SO.stage = 'aim'; SO.t = 0; }
      break;
    case 'aim':
      soAiming(dt);
      break;
    case 'flight':
      soUpdateDive(dt); soUpdateFlight(dt);
      if (SO.flight.done) { SO.nextT -= dt; if (SO.nextT <= 0 && !SO.result) { SO.result = true; soResolve(); } }
      break;
    case 'result':
      soUpdateDive(dt); soUpdateFlight(dt);
      if (SO.t > 1.9) {
        const w = soDecided();
        if (w >= 0) soEnd(w);
        else { SO.stage = 'swap'; SO.t = 0; }
      }
      break;
    case 'swap':                                           // quick fade, then the other one kicks
      SO.fade = SO.t < 0.35 ? SO.t / 0.35 : Math.max(0, 1 - (SO.t - 0.35) / 0.35);
      if (SO.t >= 0.35 && !SO.swapped) { SO.swapped = true; SO.kickerHuman = !SO.kickerHuman; soSetupKick(); SO.stage = 'swap'; SO.t = 0.35; }
      if (SO.t >= 0.7) { SO.fade = 0; SO.swapped = false; SO.stage = 'ready'; SO.t = 0; }
      break;
    case 'end':
      soUpdateDive(dt); soUpdateFlight(dt);
      if (SO.t > 4.5) soFinish();
      break;
  }
}
function soSetupKickSilently() { const m = SO.msg; soSetupKick(); SO.stage = 'turn'; SO.t = 0; SO.msg = m; }
function soAiming(dt) {
  const K = soKeeper();
  if (SO.kickerHuman) {
    soWanderKeeper(dt);
    const v = SO.lastJoy || [0, 0];                       // the aim stays where the stick left it
    SO.aimD = SO_C + v[0] * 100; SO.aimZ = clamp(30 - v[1] * 85, 0, 125);
    if (SO.charging) SO.power = Math.min(1, SO.power + dt / SO_CHARGE_T);
  } else {
    const C = SO.cpuKick; C.t += dt; C.next -= dt;
    if (C.next <= 0) {                                    // the CPU kicker changes its mind too (a bit slower)
      C.next = 0.7 + Math.random() * 0.7;
      const side = Math.random() < 0.15 ? 0 : (Math.random() < 0.5 ? -1 : 1);
      C.d = SO_C + side * (35 + Math.random() * 32); C.z = side ? 12 + Math.random() * 70 : 30 + Math.random() * 40;
    }
    SO.intent.d += (C.d - SO.intent.d) * Math.min(1, dt * 6); SO.intent.z += (C.z - SO.intent.z) * Math.min(1, dt * 6);
    SO.power = Math.min(C.power, C.power * C.t / C.at);
    if (SO.stage === 'aim' && C.t >= C.at) {
      const [sd, sz] = soShake(SO.power, performance.now() / 1000);
      soKick(SO.power, SO.intent.d + sd, Math.max(0, SO.intent.z + sz));
    }
    const [kd, kz] = soMarkTarget();                      // Mark leans the way he plans to dive
    K.hx = kd >= SO_C ? 1 : -1;
  }
}
function soEnd(w) {
  SO.stage = 'end'; SO.t = 0; SO.winner = w;
  soSay(w === 0 ? `${NAMES.human === 'Du' ? 'Du gewinnst' : NAMES.human + ' gewinnt'}! 🏆` : 'Onkel gewinnt – Revanche?');
  const K = soKeeper();
  SO.dive = null; K.rot = 0; K.z = 0; K.d = SO_C; K.hx = 1;      // back on his feet
  setMood(me, w === 0 ? 'celebrate' : 'sad', 99); setMood(cpu, w === 1 ? 'celebrate' : 'sad', 99);
  if (w === 0) [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'square', 0.12), 400 + i * 110));
  else beep(150, 0.4, 'sawtooth', 0.1);
  K.pose = (K === me) === (w === 0) ? 'v' : null;
}
function soFinish() {
  SO.active = false; phase = 'menu'; msg = ''; hudOff = false;
  for (const p of [me, cpu]) if (p) { p.scr = null; p.rot = 0; p.hidden = false; }
  me = cpu = null;
  document.getElementById('start').style.display = 'flex'; updatePenBtn();
}

// ---------- rendering ----------
let soRot = null, soCanvA = null, soCanvB = null;
function soOffscreen(c) {
  if (!c) c = document.createElement('canvas');
  if (c.width !== cv.width || c.height !== cv.height) { c.width = cv.width; c.height = cv.height; }
  const g = c.getContext('2d'); g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  return c;
}
function soRender() {
  if (SO.stage === 'intro' || SO.stage === 'turn') {
    // the side view (game.js renderer, without HUD) …
    const main = ctx;
    if (SO.stage === 'intro') { hudOff = true; for (const p of [me, cpu]) p.scr = null; render(); hudOff = false; soHud(false); return; }
    soCanvA = soOffscreen(soCanvA); soCanvB = soOffscreen(soCanvB);
    ctx = soCanvA.getContext('2d'); hudOff = true; me.scr = cpu.scr = null; const hm = me.hidden, hc = cpu.hidden; me.hidden = cpu.hidden = false;
    soSideSnapshot(); render(); hudOff = false; me.hidden = hm; cpu.hidden = hc;
    ctx = soCanvB.getContext('2d'); soWorld();
    ctx = main;
    soCubeTurn(soCanvA, soCanvB, SO.turn);
    soHud(false);
    return;
  }
  soWorld();
  soHud(true);
}
function soSideSnapshot() {                             // pose the side view: Mark at the spot, Onkel in goal
  me.x = SO_SPOT - 40; me.d = SO_C + 12; me.z = 0; me.rot = 0; me.pose = null; me.hx = 1;
  cpu.x = FW - 12; cpu.d = SO_C; cpu.z = 0; cpu.rot = 0; cpu.pose = 'keeper'; cpu.hx = -1;
  ball.x = SO_SPOT; ball.d = SO_C; ball.z = 0;
}
// Pseudo-3D: the camera turns 90° to the right inside an imaginary cube – the side view
// slides away to the left while the front view swings in from the right.
function soCubeTurn(a, b, p) {
  const th = (p * p * (3 - 2 * p)) * Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const STEP = 6, sx = a.width / W, sy = a.height / H;
  const face = (img, map) => {
    for (let x = 0; x < W; x += STEP) {
      const u0 = (x - W / 2) / (W / 2), u1 = (Math.min(W, x + STEP) - W / 2) / (W / 2);
      const p0 = map(u0), p1 = map(u1);
      if (p0[1] < 0.03 || p1[1] < 0.03) continue;
      const X0 = W / 2 + (W / 2) * p0[0] / p0[1], X1 = W / 2 + (W / 2) * p1[0] / p1[1];
      if (X1 < -2 || X0 > W + 2 || X1 <= X0) continue;
      const zs = (p0[1] + p1[1]) / 2, h = H / zs;
      ctx.drawImage(img, x * sx, 0, Math.min(STEP, W - x) * sx, a.height, X0, H / 2 - h / 2, X1 - X0 + 0.7, h);
    }
  };
  face(a, u => [u * c - s, u * s + c]);
  face(b, v => [c + v * s, s - v * c]);
  ctx.fillStyle = `rgba(0,0,0,${0.35 * Math.sin(p * Math.PI)})`; ctx.fillRect(0, 0, W, H);   // a touch of motion dimming
}

function soBuildGround() {                              // the baked ground texture, turned for the front view
  if (soRot || !groundPieces) return;
  const X0 = SO_CAM_X + 100, X1 = GX1, C = (X1 - GX0) * GPU;
  const c = document.createElement('canvas'); c.width = Math.ceil((GD1 - GD0) * GPU); c.height = Math.ceil((X1 - X0) * GPU);
  const g = c.getContext('2d');
  g.setTransform(0, -1, 1, 0, 0, C);                     // (u, v) → (v, C − u): pitch length runs up the image
  for (const pc of groundPieces) g.drawImage(pc.c, (pc.x0 - GX0) * GPU, 0);
  soRot = { c, X0, X1 };
}
function soWorld() {
  soResize();
  const sky = themeReady ? skyCol : '#1b2238';
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const endX = themeReady ? GX1 - 20 : FW + 260;
  const [, yEnd, kEnd] = Q(endX, SO_C, 0);
  // backdrop and end wall
  if (themeReady) {
    const wallTop = yEnd - WALL_H * kEnd;
    const hb = Math.max(H * 0.42, wallTop + 40), wb = TH.backdrop.width * hb / TH.backdrop.height, yb = wallTop + 40;
    ctx.fillStyle = skyCol; ctx.fillRect(0, 0, W, yb - hb + 2);
    const off = ((W / 2 - wb * 0.62) % wb + wb) % wb;
    for (let x = off - wb; x < W; x += wb) ctx.drawImage(TH.backdrop, x, yb - hb, wb + 0.5, hb);
  }
  // ground
  ctx.fillStyle = themeReady ? '#8a7560' : '#1f7a36'; ctx.fillRect(0, yEnd - 1, W, H);
  if (themeReady) { soBuildGround(); soGround(endX); }
  if (themeReady) {                                       // wall across the far end
    const ww = TH.wall.width * (WALL_H * kEnd) / TH.wall.height, wallTop = yEnd - WALL_H * kEnd;
    for (let x = ((W / 2) % ww) - ww; x < W; x += ww) ctx.drawImage(TH.wall, x, wallTop, ww + 0.5, WALL_H * kEnd + 1);
    soSideWall(endX);
    soProps();
  }
  soLines();
  // goal, keeper and ball – far to near
  soGoal(false);
  const K = soKeeper();
  const items = [{ x: FW + 0.5, f: () => soGoal(true) }, { x: SO_GX, f: () => soDrawKeeper(K) }, { x: ball.x, f: soDrawBall }];
  items.sort((a, b) => b.x - a.x).forEach(it => it.f());
  soDrawNet(true);
  for (const p of [me, cpu]) if (p.hidden) p.scr = null;
}
function soGround(endX) {
  const R = soRot, STEP = 3;
  const yTop = Math.floor(Q(endX, SO_C)[1]);
  for (let y = Math.max(0, yTop); y < H; y += STEP) {
    const y1 = Math.min(H, y + STEP);
    const xa = SO_CAM_X + SO_CAM_Z * soF / Math.max(1, y - soHZ), xb = SO_CAM_X + SO_CAM_Z * soF / Math.max(1, y1 - soHZ);
    const xA = Math.min(xa, R.X1, endX), xB = Math.max(xb, R.X0);
    if (xA <= xB) continue;
    const k = soF / ((xA + xB) / 2 - SO_CAM_X);
    const dl = Math.max(GD0, SO_C - (W / 2) / k), dr = Math.min(GD1, SO_C + (W / 2) / k);
    const X0 = W / 2 + (dl - SO_C) * k, X1 = W / 2 + (dr - SO_C) * k;
    ctx.drawImage(R.c, (dl - GD0) * GPU, (R.X1 - xA) * GPU, (dr - dl) * GPU, Math.max(0.5, (xA - xB) * GPU), X0, y, X1 - X0 + 0.6, y1 - y + 0.6);
  }
}
function soSideWall(endX) {                             // the long wall along the far touchline, receding on the left
  const ww = WALL_H * TH.wall.width / TH.wall.height;   // world length of one wall image
  for (let x = SO_CAM_X + 120; x < endX; x += 12) {
    const [xa, ya, ka] = Q(x, WALL_D, 0), [xb, yb, kb] = Q(Math.min(endX, x + 12), WALL_D, 0);
    if (xb < -50 && xa < -50) continue;
    const u = ((x % ww) + ww) % ww / ww * TH.wall.width, uw = 12 / ww * TH.wall.width;
    const top = Math.min(ya - WALL_H * ka, yb - WALL_H * kb);
    ctx.drawImage(TH.wall, u, 0, Math.min(uw, TH.wall.width - u), TH.wall.height, Math.min(xa, xb), top, Math.abs(xa - xb) + 0.8, Math.max(ya, yb) - top);
  }
}
function soProps() {
  for (const [name, x, d, h] of PROPS) {
    const img = TH[name]; if (!img || x < SO_CAM_X + 60) continue;
    const [sx, sy, k] = Q(x, d), ph = h * k, pw = img.width / img.height * ph;
    if (sx + pw / 2 < 0 || sx - pw / 2 > W) continue;
    ctx.drawImage(img, sx - pw / 2, sy - ph, pw, ph);
  }
}
function soLine(pts) {
  ctx.beginPath();
  pts.forEach(([x, d], i) => { const [sx, sy] = Q(x, d); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
  ctx.stroke();
}
function soLines() {
  ctx.save(); ctx.globalAlpha = themeReady ? 0.55 : 0.9;
  ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  const near = SO_CAM_X + 150;
  soLine([[near, 0], [FW, 0], [FW, FD], [near, FD]]);                              // touchlines + goal line
  soLine([[FW, SO_C - PA_HALF], [FW - PA_DEPTH, SO_C - PA_HALF], [FW - PA_DEPTH, SO_C + PA_HALF], [FW, SO_C + PA_HALF]]);
  soLine([[FW, SO_C - GA_HALF], [FW - GA_DEPTH, SO_C - GA_HALF], [FW - GA_DEPTH, SO_C + GA_HALF], [FW, SO_C + GA_HALF]]);
  const arc = [];
  for (let i = 0; i <= 30; i++) { const a = -0.93 + 1.86 * i / 30, ax = SO_SPOT - Math.cos(a) * 75; if (FW - ax > PA_DEPTH) arc.push([ax, SO_C + Math.sin(a) * 75]); }
  if (arc.length > 1) soLine(arc);
  const [px, py, pk] = Q(SO_SPOT, SO_C);
  if (ball.x !== SO_SPOT || ball.z > 0) { ctx.beginPath(); ctx.ellipse(px, py, 2.6 * pk, 1.1 * pk, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function soGoal(front) {
  const d1 = SO_C - GOAL_HALF, d2 = SO_C + GOAL_HALF, bx = FW + GOAL_DEPTH, bh = GOAL_H * 0.8;
  const quad = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach(([x, d, z], i) => { const [sx, sy] = Q(x, d, z); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); } };
  if (!front) { soDrawNet(false); return; }
  const [x1, yb1, k1] = Q(FW, d1, 0), [, yt] = Q(FW, d1, GOAL_H), [x2] = Q(FW, d2, 0);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 4.5 * k1 + 3;
  ctx.beginPath(); ctx.moveTo(x1 + 2, yb1); ctx.lineTo(x1 + 2, yt + 2); ctx.lineTo(x2 + 2, yt + 2); ctx.lineTo(x2 + 2, yb1); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4.5 * k1;
  ctx.beginPath(); ctx.moveTo(x1, yb1); ctx.lineTo(x1, yt); ctx.lineTo(x2, yt); ctx.lineTo(x2, yb1); ctx.stroke();
  ctx.restore();
  for (const d of [d1, d2]) soCone(FW, d);
}
function soCone(x, d) {
  const [cx, cy, k] = Q(x, d), h = 30 * k, r = 11 * k;
  ctx.fillStyle = '#e8650f'; ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.35, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - 2.5 * k, cy - h); ctx.lineTo(cx + 2.5 * k, cy - h); ctx.lineTo(cx + r, cy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(cx - r * 0.55, cy - h * 0.62, r * 1.1, h * 0.14);
}
function soDrawKeeper(K) {
  const [sx, sy, k] = Q(SO_GX, K.d, 0);
  K.scr = { x: sx, y: sy, s: k * SO_KEEPER_K };
  drawPlayer(K);
}
function soDrawBall() {
  const [gx, gy, k] = Q(ball.x, ball.d, 0), [bx, by] = Q(ball.x, ball.d, ball.z + SO_BALL_R), r = SO_BALL_R * k;
  const shrink = 1 / (1 + ball.z / 120);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(gx, gy, r * shrink, r * 0.35 * shrink, 0, 0, Math.PI * 2); ctx.fill();
  drawFootball(bx, by, r, (ball.x + ball.d) / 20);
}

// ---------- HUD: arrows, power, scoreboard, captions ----------
function soArrow(from, to, col, wob = 0, dashed = false) {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]), h = 18;
  ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 7;
  if (dashed) ctx.setLineDash([16, 10]);
  ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0] - Math.cos(ang) * h * 0.6, to[1] - Math.sin(ang) * h * 0.6); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(to[0] + Math.cos(ang) * 4, to[1] + Math.sin(ang) * 4);
  ctx.lineTo(to[0] + Math.cos(ang + 2.5) * h, to[1] + Math.sin(ang + 2.5) * h);
  ctx.lineTo(to[0] + Math.cos(ang - 2.5) * h, to[1] + Math.sin(ang - 2.5) * h); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function soHud(controls) {
  const aiming = SO.stage === 'aim' || SO.stage === 'ready';
  if (controls && aiming) {
    const K = soKeeper(), t = performance.now() / 1000;
    const [, , kg] = Q(FW, SO_C);
    // the keeper's planned dive (Onkel: random, changing; Mark: joystick)
    const [kd, kz] = SO.kickerHuman ? [SO.intent.d, SO.intent.z] : soMarkTarget();
    const kcol = SO.kickerHuman ? 'rgba(70,140,255,.95)' : 'rgba(255,70,70,.95)';
    const mid = Math.abs(kd - K.d) < 22 && kz < 62;           // staying in the middle: mark it low, not over his face
    const waist = Q(SO_GX, K.d, 22 * SO_KEEPER_K), tgt = Q(FW, kd, mid ? 14 : kz);
    const dx = tgt[0] - waist[0], dy = tgt[1] - waist[1], L = Math.hypot(dx, dy), off = 34 * kg / 4.2;
    if (L > off + 30) soArrow([waist[0] + dx / L * off, waist[1] + dy / L * off], tgt, kcol);
    ctx.strokeStyle = kcol; ctx.lineWidth = 5;                // the spot he will dive to
    ctx.beginPath(); ctx.arc(tgt[0], tgt[1], 16 * kg / 4.2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = kcol; ctx.font = `${Math.round(18 * kg / 4.2)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🧤', tgt[0], tgt[1] + 1);
    // the kicker's arrow, straight out of the ball
    const [sd, sz] = soShake(SO.power, t);
    const ad = (SO.kickerHuman ? SO.aimD : SO.intent.d) + sd, az = Math.max(0, (SO.kickerHuman ? SO.aimZ : SO.intent.z) + sz);
    const b = Q(ball.x, ball.d, SO_BALL_R), e = Q(FW, ad, az);
    const f = SO.power, col = `rgba(255,${Math.round(240 - 190 * f)},${Math.round(80 - 60 * f)},0.95)`;
    soArrow(b, e, col, 0, true);
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(e[0], e[1], 14 * kg / 4, 14 * kg / 4, 0, 0, Math.PI * 2); ctx.stroke();
    if (!SO.kickerHuman) {                                     // the CPU's power building up around the ball
      const [bx, by, bk] = Q(ball.x, ball.d, SO_BALL_R);
      ring(bx, by, SO_BALL_R * bk + 12, SO.power, nervesColour(SO.power), 8);
    }
  }
  soScoreboard();
  if (phase !== 'menu') drawPauseButton();
  soCaption();
  drawBubbles();
  if (controls && aiming) {
    if (SO.kickerHuman) {
      drawButton(btnK, SO.charging ? BTN_POWER : BTN.kick, SO.charging, SO.charging ? Math.max(0.02, SO.power) : 0);
      // the 1/3 mark on the power ring: weaker kicks get caught
      const a = -Math.PI / 2 + Math.PI * 2 * SO_MIN_POWER, R = btnK.r + 14;
      for (const [c, w] of [['#fff', 8], ['#1d1d1d', 4]]) {
        ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(btnK.x + Math.cos(a) * (R - 11), btnK.y + Math.sin(a) * (R - 11)); ctx.lineTo(btnK.x + Math.cos(a) * (R + 11), btnK.y + Math.sin(a) * (R + 11)); ctx.stroke();
      }
    }
    drawJoystick();
  }
  if (SO.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${SO.fade})`; ctx.fillRect(0, 0, W, H); }
  if (SO.stage === 'end' && SO.t > 1.2) {
    ctx.font = `24px ${MARKER_FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 5;
    ctx.strokeText('Tippen zum Weitermachen', W / 2, H - 30); ctx.fillText('Tippen zum Weitermachen', W / 2, H - 30);
  }
  drawToasts(Math.min(0.05, (performance.now() - (drawToasts.last || performance.now())) / 1000)); drawToasts.last = performance.now();
  if (boardOpen) drawBoard();
}
function soCaption() {
  if (!SO.msg) return;
  const age = (performance.now() - SO.msgT) / 1000;
  if (age > (SO.stage === 'end' ? 99 : 1.9)) return;
  const t = Math.min(1, age / 0.5), c1 = 1.7, c3 = c1 + 1, e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  const y = H + 50 - (H * 0.255 + 50) * e;
  ctx.font = `800 ${Math.round(Math.min(60, H * 0.07))}px ${UI_FONT}`; ctx.lineWidth = 9; ctx.strokeStyle = '#0d3b1a'; ctx.fillStyle = '#fff'; ctx.lineJoin = 'round';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeText(SO.msg, W / 2, y); ctx.fillText(SO.msg, W / 2, y);
}
function soScoreboard() {
  const n = Math.max(SO_KICKS, SO.kicks[0].length, SO.kicks[1].length), w = 470 + Math.max(0, n - SO_KICKS) * 40, h = 96, x = W / 2 - w / 2, y = 10;
  whiteboard(x, y, w, h, 7);
  ctx.fillStyle = '#1f4fd1'; ctx.textBaseline = 'middle';
  ctx.font = `22px ${MARKER_FONT}`;
  doodleFace(x + 30, y + 30, 13, false); ctx.textAlign = 'left'; ctx.fillText(NAMES.human, x + 50, y + 31);
  doodleFace(x + 30, y + 70, 13, true); ctx.fillText(NAMES.cpu, x + 50, y + 71);
  ctx.textAlign = 'right'; ctx.font = `34px ${MARKER_FONT}`;
  ctx.fillText(soScore(0), x + w - 22, y + 31); ctx.fillText(soScore(1), x + w - 22, y + 71);
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < n; i++) {
      const cx = x + 170 + i * 40, cy = y + 30 + side * 40, r = 12, k = SO.kicks[side][i];
      const now = SO.stage !== 'end' && i === SO.kicks[side].length && (side === 0) === SO.kickerHuman;
      ctx.lineWidth = 2.6; ctx.strokeStyle = now ? '#d62828' : '#1f4fd1';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (k === true) { ctx.fillStyle = '#2fb24c'; ctx.fill(); }
      ctx.stroke();
      if (k === false) { ctx.strokeStyle = '#d62828'; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.moveTo(cx - 7, cy - 7); ctx.lineTo(cx + 7, cy + 7); ctx.moveTo(cx + 7, cy - 7); ctx.lineTo(cx - 7, cy + 7); ctx.stroke(); }
    }
  }
}
