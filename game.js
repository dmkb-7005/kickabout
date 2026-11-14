'use strict';
// =====================================================================
//  Kick-About – prototype v2
//  World units: x = along the pitch, d = depth (0 = far touchline,
//  FD = near touchline), z = height. Rendered with a perspective camera
//  placed above/behind the near touchline that scrolls with the play.
// =====================================================================
const FW = 1300, FD = 400;
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
const AIM_SHAKE_MAX = 0.95;             // radians of aim-line shake at the worst point (~54°)
const AIM_SHAKE_TIME = 4;               // seconds of holding until the shake is at its maximum

// --- feints ---
const FEINT_WINDOW = 1.6;               // the 3 joystick flicks must happen within this many seconds
const FEINT_CD = 2;                     // seconds before another feint can be done
const DAZZLE_TIME = 1.0, DAZZLE_IMMUNE = 2.5;

// --- goal frame ---
const POST_R = 4;

// --- boxes: hands are allowed in your own penalty area ---
const PA_DEPTH = 190, PA_HALF = 160;    // penalty area (= goalkeeper zone)
const GA_DEPTH = 75, GA_HALF = 100;     // goal area (6-yard box), drawn only
const PEN_SPOT = 125;                   // penalty spot distance from the goal line
const CATCH_SPEED = 680;                // slower shots than this are caught
const PARRY_SPEED = 920;                // shots up to this speed can be parried (60% chance)
const KEEP_REACH = 60, HOLD_T = 6.0;    // reach of the hands; how long the keeper holds the ball

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
const btnK = { r: 90, label: 'SCHUSS', col: '#ffd23f' };
const btnS = { r: 54, label: 'SPRINT', col: '#7ee081' };
const btnP = { w: 70 };                                        // pause (whiteboard square, top right)
const NAMES = { human: 'Du', cpu: 'Onkel' };          // a skin pack can rename both (pack.json)
const UI_FONT = "'Baloo 2', system-ui, sans-serif", MARKER_FONT = "'Permanent Marker', 'Comic Sans MS', 'Baloo 2', system-ui, sans-serif";
const ICONS = {};
for (const n of ['kick', 'tackle', 'bolt', 'bolt_on', 'nervous', 'skip']) { const im = new Image(); im.src = `img/icon_${n}.svg`; ICONS[n] = im; }
let paused = false;
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };
const joy = { r: 110 };

let themeReady = false;                  // set once the backyard theme has loaded
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const nearY = H + 10, farY = Math.max(150, H * (themeReady ? 0.33 : 0.24));   // more sky for the backyard backdrop
  A = (nearY - farY) / (1 / D0 - 1 / (D0 + FD));
  HY = nearY - A / D0;
  F = (D0 + FD / 2) * W / VIEW_W;
  btnK.x = 40 + btnK.r; btnK.y = H - 36 - btnK.r;
  btnS.x = btnK.x; btnS.y = btnK.y - btnK.r - 34 - btnS.r;
  btnP.x = W - 24 - btnP.w; btnP.y = 14;
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

// ---------- Skins (big cartoon heads) ----------
// Human player's head comes from skin/<expression>.png; if missing, a drawn cartoon face is used.
const EXPRESSIONS = ['neutral', 'determined', 'celebrate', 'shocked', 'dizzy', 'sad', 'cheeky'];
// Faces come from a private "skin pack" (a ZIP) that is loaded once on the start screen and kept
// in the browser (IndexedDB). Nothing personal lives in the public repo. Without a pack the game
// draws cartoon faces. ZIP layout (folder names are flexible, see SKIN_DIRS):
//   onkel/neutral.png … cheeky.png   (the CPU)      mark/neutral.png …   (the human player)
//   pack.json (optional): {"human": "Mark", "cpu": "Onkel"}
const SKINS = { cpu: {}, human: {} };
const SKIN_DIRS = { cpu: ['onkel', 'uncle', 'cpu'], human: ['nephew', 'neffe', 'spieler', 'player', 'human', 'mark'] };
const SKIN_DB = 'kickabout-skins', SKIN_STORE = 'pack';
function skinDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(SKIN_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(SKIN_STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function skinDbDo(mode, fn) {
  const db = await skinDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(SKIN_STORE, mode), st = tx.objectStore(SKIN_STORE), out = fn(st);
    tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error);
  });
}
function blobToImage(blob) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(blob); });
}
async function applySkinPack(pack) {                    // pack = { names, cpu: {mood: Blob}, human: {…} }
  for (const who of ['cpu', 'human']) {
    SKINS[who] = {};
    for (const [mood, blob] of Object.entries(pack[who] || {})) { try { SKINS[who][mood] = await blobToImage(blob); } catch (_) {} }
  }
  if (pack.names) { if (pack.names.human) NAMES.human = pack.names.human; if (pack.names.cpu) NAMES.cpu = pack.names.cpu; }
}
function parseSkinZip(buf) {
  const files = fflate.unzipSync(new Uint8Array(buf));
  const pack = { cpu: {}, human: {}, names: null };
  for (const [path, data] of Object.entries(files)) {
    const parts = path.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
    if (!parts.length || parts.some(x => x.startsWith('__macosx') || x.startsWith('.'))) continue;
    const file = parts[parts.length - 1];
    if (file === 'pack.json') { try { pack.names = JSON.parse(new TextDecoder().decode(data)); } catch (_) {} continue; }
    const m = file.match(/^([a-z]+)\.(png|webp|jpe?g)$/);
    if (!m || !EXPRESSIONS.includes(m[1])) continue;
    const who = Object.keys(SKIN_DIRS).find(w => parts.slice(0, -1).some(dir => SKIN_DIRS[w].some(n => dir.startsWith(n))));
    if (!who) continue;
    const big = parts.some(x => /^\d{3,4}x\d{3,4}$/.test(x) && parseInt(x) > 500);   // prefer the 400x560 versions
    if (pack[who][m[1]] && big) continue;
    pack[who][m[1]] = new Blob([data], { type: 'image/' + (m[2] === 'jpg' ? 'jpeg' : m[2]) });
  }
  if (!Object.keys(pack.cpu).length && !Object.keys(pack.human).length) throw new Error('Keine passenden Bilder im ZIP gefunden.');
  return pack;
}
async function loadSkinZip(file) {
  const pack = parseSkinZip(await file.arrayBuffer());
  await applySkinPack(pack);
  try { await skinDbDo('readwrite', st => st.put(pack, 'current')); } catch (_) {}
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}
  return pack;
}
async function clearSkins() {
  SKINS.cpu = {}; SKINS.human = {}; NAMES.human = 'Du'; NAMES.cpu = 'Onkel';
  try { await skinDbDo('readwrite', st => st.delete('current')); } catch (_) {}
}
const skinsReady = (async () => {
  try { const pack = await skinDbDo('readonly', st => st.get('current')); if (pack) await applySkinPack(pack); } catch (_) {}
})();
const HEAD_W = 52, HEAD_H = 73;
const HEAD_SCALE = { human: 0.8, cpu: 1 };          // Mark's head is 20 % smaller than Onkel's
const headK = p => HEAD_SCALE[p.ai ? 'cpu' : 'human'];          // world units – deliberately big so expressions read on a tablet

function setMood(p, m, t) { p.mood = m; p.moodT = t; }
function moodOf(p) {
  if (p.stun > 0 || p.dazzle > 0) return 'dizzy';
  if (p.moodT > 0) return p.mood;
  if (p.glasses != null) return 'celebrate';
  if ((p === me && aim.active) || p.slide > 0 || p.kickT > 0 || (sprinting(p) && p.spd > 30)) return 'determined';
  return 'neutral';
}

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
    col, ai, stam, mood: 'neutral', moodT: 0, kickT: 0, dazzle: 0, dazImm: 0, stun: 0, slide: 0, recover: 0, tcd: 0, ng: 0, run: 0, spd: 0, aim: 0 };
}
function setupKickoff(humanKicks) {
  const sm = me ? Math.min(1, me.stam + 0.3) : 1, sc = cpu ? Math.min(1, cpu.stam + 0.3) : 1;
  const c = FW / 2;
  me = mkPlayer(humanKicks ? c - PR - BR - 2 : c - 230, '#e63946', false, sm);
  me.shorts = '#1f5a2e';                        // dark green shorts
  cpu = mkPlayer(humanKicks ? c + 230 : c + PR + BR + 2, '#1d6fe0', true, sc);
  cpu.shorts = '#d8c39a';                       // beige shorts
  ball = { x: c, d: FD / 2, z: 0, vx: 0, vd: 0, vz: 0, held: null, holdT: 0 };
  owner = null; aim.active = false; feint.tokens.length = 0;
  kicker = humanKicks ? me : cpu; kickoffLock = true; kickoffT = 0;
  cpu.calm = humanKicks ? 0 : 2.5;           // CPU starts its kick-off slowly
  sprint.active = false;
  phase = 'ready'; phaseT = 1.4;
  msg = humanKicks ? 'Dein Anstoß!' : 'Onkel hat Anstoß!';
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

// =====================================================================
//  Achievements ("Erfolge") – stored in the browser (localStorage)
// =====================================================================
const M_PER_UNIT = 14 / FW;                                   // the pitch is roughly 14 m long
const ACH_KEY = 'kickabout.achievements.v1';
const ACHS = [
  { id: 'firstWin',  icon: '🏆', name: 'Erster Sieg',         desc: 'Gewinne dein erstes Spiel' },
  { id: 'streak5',   icon: '🔥', name: '5 Siege in Folge',     desc: 'Fünf Spiele hintereinander gewinnen', prog: s => [Math.min(s.streak, 5), 5] },
  { id: 'longGoal',  icon: '📏', name: 'Weitestes Tor',        desc: 'Dein weitestes Tor', value: s => s.bestDist ? `${s.bestDist.toFixed(1).replace('.', ',')} m` : '–' },
  { id: 'celebs',    icon: '🎉', name: 'Jubel-Sammler',        desc: 'Alle Torjubel gezeigt', prog: s => [s.celebs.length, 5] },
  { id: 'cleanSheet',icon: '🧱', name: 'Zu Null gewonnen',     desc: 'Gewinnen ohne Gegentor', value: s => `${s.cleanSheets}×` },
  { id: 'trick',     icon: '🌀', name: 'Ausgetrickst!',        desc: 'Tor nach einem Trick (hoch-runter-hoch)' },
  { id: 'chip',      icon: '🪂', name: 'Lupfer-König',         desc: 'Tor nach einem Lupfer über den Gegner' },
  { id: 'hattrick',  icon: '🎩', name: 'Hattrick',             desc: 'Drei Tore hintereinander ohne Gegentor' },
  { id: 'keeper',    icon: '🧤', name: 'Super-Torwart',        desc: '10 Bälle gefangen oder gehalten', prog: s => [Math.min(s.saves, 10), 10] },
  { id: 'tackles',   icon: '🦵', name: 'Grätschen-Profi',      desc: '10 Bälle mit Grätschen erobert', prog: s => [Math.min(s.tackles, 10), 10] },
  { id: 'secret',    icon: '🚗', name: 'Scherben bringen Glück', desc: 'Onkel hat sein eigenes Auto getroffen', secret: true },
];
const freshAch = () => ({ unlocked: {}, stats: { wins: 0, streak: 0, bestStreak: 0, bestDist: 0, celebs: [], cleanSheets: 0, saves: 0, tackles: 0 } });
let ACH = freshAch();
try { const raw = localStorage.getItem(ACH_KEY); if (raw) { const o = JSON.parse(raw); ACH = { unlocked: o.unlocked || {}, stats: Object.assign(freshAch().stats, o.stats || {}) }; } } catch (_) {}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}
function saveAch() { try { localStorage.setItem(ACH_KEY, JSON.stringify(ACH)); } catch (_) {} }
const toasts = [];
function toast(icon, title, text) { toasts.push({ icon, title, text, t: 0 }); }
function unlock(id) {
  if (ACH.unlocked[id]) return;
  ACH.unlocked[id] = Date.now(); saveAch();
  const a = ACHS.find(x => x.id === id);
  toast(a.icon, 'Erfolg freigeschaltet!', a.name);
  [784, 988, 1175].forEach((f, i) => setTimeout(() => beep(f, 0.12, 'triangle', 0.15), 600 + i * 90));
}
// per-match tracking
let matchStats = { run: 0 }, gameClock = 0, lastShot = null, trickMark = null;
function achGoal(team) {
  const S = ACH.stats;
  if (team === 0) {
    matchStats.run++;
    if (matchStats.run >= 3) unlock('hattrick');
    if (lastShot && lastShot.by === me) {
      const dist = Math.hypot(FW - lastShot.x, FD / 2 - lastShot.d) * M_PER_UNIT;
      if (dist > S.bestDist + 0.05) {
        const first = !S.bestDist; S.bestDist = dist; saveAch();
        if (first) unlock('longGoal'); else toast('📏', 'Neuer Rekord!', `Weitestes Tor: ${dist.toFixed(1).replace('.', ',')} m`);
      }
    }
    if (trickMark && trickMark.clean && gameClock - trickMark.t < 6) unlock(trickMark.type === 'chip' ? 'chip' : 'trick');
  } else matchStats.run = 0;
  trickMark = null; lastShot = null;
}
function achMatchEnd(humanWon) {
  const S = ACH.stats;
  if (humanWon) {
    S.wins++; S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak);
    unlock('firstWin');
    if (S.streak >= 5) unlock('streak5');
    if (score[1] === 0) { S.cleanSheets++; if (ACH.unlocked.cleanSheet) toast('🧱', 'Zu Null gewonnen!', `Schon ${S.cleanSheets}×`); else unlock('cleanSheet'); }
  } else S.streak = 0;
  saveAch();
}
function achCeleb(move) {
  const S = ACH.stats;
  if (!S.celebs.includes(move)) { S.celebs.push(move); saveAch(); if (S.celebs.length >= 5) unlock('celebs'); }
}
function achCount(key, id, n) { ACH.stats[key]++; saveAch(); if (ACH.stats[key] >= n) unlock(id); }

// ---------- Achievements board ----------
let boardOpen = null;                                          // null | 'pause' | 'end'
function boardRect() { const w = Math.min(940, W - 60), h = Math.min(660, H - 60); return { x: (W - w) / 2, y: (H - h) / 2, w, h }; }
function resetRect() { const r = boardRect(); return { x: r.x + r.w - 230, y: r.y + r.h - 58, w: 200, h: 40 }; }
function drawBoard() {
  ctx.fillStyle = 'rgba(10,20,30,.6)'; ctx.fillRect(0, 0, W, H);
  const r = boardRect();
  whiteboard(r.x, r.y, r.w, r.h, 10);
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#1f4fd1';
  ctx.textAlign = 'left'; ctx.font = `40px ${MARKER_FONT}`;
  ctx.fillText(boardOpen === 'pause' ? 'PAUSE – Erfolge' : 'Erfolge', r.x + 32, r.y + 46);
  ctx.textAlign = 'right'; ctx.font = `20px ${MARKER_FONT}`;
  const n = ACHS.filter(a => ACH.unlocked[a.id]).length;
  ctx.fillText(`${n} / ${ACHS.length} freigeschaltet`, r.x + r.w - 32, r.y + 48);
  const S = ACH.stats, cols = 2, rows = Math.ceil(ACHS.length / cols);
  const top = r.y + 88, cw = (r.w - 64 - 20) / cols, ch = (r.h - 88 - 74) / rows;
  ACHS.forEach((a, i) => {
    const cx = r.x + 32 + (i % cols) * (cw + 20), cy = top + Math.floor(i / cols) * ch;
    const got = !!ACH.unlocked[a.id], hidden = a.secret && !got;
    ctx.globalAlpha = got ? 1 : 0.38;
    ctx.fillStyle = got ? 'rgba(31,79,209,.08)' : 'rgba(0,0,0,.04)';
    ctx.beginPath(); ctx.roundRect(cx, cy + 3, cw, ch - 8, 10); ctx.fill();
    ctx.font = `${Math.round(ch * 0.5)}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText(hidden ? '❓' : a.icon, cx + ch * 0.48, cy + ch / 2);
    ctx.fillStyle = got ? '#1f4fd1' : '#555'; ctx.textAlign = 'left';
    ctx.font = `${Math.round(Math.min(24, ch * 0.32))}px ${MARKER_FONT}`;
    ctx.fillText(hidden ? '???' : a.name, cx + ch * 0.95, cy + ch * 0.36);
    ctx.font = `600 ${Math.round(Math.min(17, ch * 0.24))}px ${UI_FONT}`; ctx.fillStyle = got ? '#2b3a67' : '#666';
    let sub = hidden ? 'Geheimer Erfolg' : a.desc;
    if (a.value) sub = `${a.desc}: ${a.value(S)}`;
    ctx.fillText(sub, cx + ch * 0.95, cy + ch * 0.66, cw - ch - 90);
    if (a.prog && !hidden) {                                    // progress bar
      const [v, max] = a.prog(S), bw = 70, bx = cx + cw - bw - 12, by = cy + ch * 0.62;
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.beginPath(); ctx.roundRect(bx, by - 6, bw, 12, 6); ctx.fill();
      ctx.fillStyle = got ? '#2fb24c' : '#1f4fd1'; ctx.beginPath(); ctx.roundRect(bx, by - 6, Math.max(12, bw * v / max), 12, 6); ctx.fill();
      ctx.fillStyle = '#1f4fd1'; ctx.textAlign = 'center'; ctx.font = `700 14px ${UI_FONT}`;
      ctx.fillText(`${v}/${max}`, bx + bw / 2, by - 16);
    }
    if (got) { ctx.globalAlpha = 1; ctx.fillStyle = '#2fb24c'; ctx.font = `800 26px ${UI_FONT}`; ctx.textAlign = 'right'; if (!a.prog) ctx.fillText('✓', cx + cw - 14, cy + ch * 0.45); }
    ctx.globalAlpha = 1;
  });
  ctx.textAlign = 'left'; ctx.fillStyle = '#1f4fd1'; ctx.font = `20px ${MARKER_FONT}`;
  ctx.fillText(boardOpen === 'pause' ? 'Tippen zum Weiterspielen' : 'Tippen für ein neues Spiel', r.x + 32, r.y + r.h - 38);
  const rr = resetRect();
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.roundRect(rr.x, rr.y, rr.w, rr.h, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c0392b'; ctx.textAlign = 'center'; ctx.font = `700 16px ${UI_FONT}`;
  ctx.fillText('Erfolge zurücksetzen', rr.x + rr.w / 2, rr.y + rr.h / 2 + 1);
}
function boardTap(e) {
  const rr = resetRect();
  if (e.clientX > rr.x && e.clientX < rr.x + rr.w && e.clientY > rr.y && e.clientY < rr.y + rr.h) {
    if (confirm('Wirklich alle Erfolge löschen?')) { ACH = freshAch(); saveAch(); }
    return;
  }
  if (boardOpen === 'pause') { paused = false; last = performance.now(); }
  else { phase = 'menu'; msg = ''; document.getElementById('start').style.display = 'flex'; }
  boardOpen = null;
}
function drawToasts(dt) {
  if (!toasts.length) return;
  const T = toasts[0]; T.t += dt;
  const life = 3.2, x = 20, w = 360, h = 74;
  const inT = Math.min(1, T.t / 0.35), outT = Math.max(0, (T.t - (life - 0.35)) / 0.35);
  const y = 112 + (1 - inT) * -40 - outT * 30;
  ctx.globalAlpha = Math.min(inT, 1 - outT);
  whiteboard(x, y, w, h, 5);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = '34px system-ui'; ctx.fillStyle = '#000';
  ctx.fillText(T.icon, x + 40, y + h / 2);
  ctx.textAlign = 'left'; ctx.fillStyle = '#2fb24c'; ctx.font = `800 16px ${UI_FONT}`;
  ctx.fillText(T.title, x + 74, y + 24);
  ctx.fillStyle = '#1f4fd1'; ctx.font = `22px ${MARKER_FONT}`;
  ctx.fillText(T.text, x + 74, y + 50, w - 86);
  ctx.globalAlpha = 1;
  if (T.t > life) toasts.shift();
}

// ---------- Input ----------
const ptr = { move: null, mx: 0, my: 0, kick: null, sprint: null };
const hit = (b, e) => Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r + 14;
const playing = () => phase === 'play' || phase === 'ready';

cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  const onPause = phase !== 'menu' && e.clientX > btnP.x - 10 && e.clientY < btnP.y + btnP.w + 10;
  if (boardOpen) { boardTap(e); return; }
  if (onPause) { paused = true; boardOpen = 'pause'; ptr.move = ptr.kick = ptr.sprint = null; aim.active = false; endSprint(); return; }
  if (phase === 'celebrate') { if (hit(btnK, e)) skipCelebration(); return; }
  if (!playing()) return;
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  if (hit(btnK, e)) {                         // one action button: KICK with the ball, TACKLE without
    if (canKickNow()) { ptr.kick = e.pointerId; startAim(); }
    else if (phase === 'play') doTackle(me);
  }
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

// ---------- Start screen (whiteboard): controls, skin pack, start ----------
function updateSkinUI() {
  const faces = document.getElementById('skinFaces'), msgEl = document.getElementById('skinMsg'), clr = document.getElementById('skinClear');
  faces.innerHTML = '';
  const have = ['human', 'cpu'].filter(w => SKINS[w].neutral);
  for (const w of have) { const im = document.createElement('img'); im.src = SKINS[w].neutral.src; im.alt = NAMES[w]; faces.appendChild(im); }
  const nh = Object.keys(SKINS.human).length, nc = Object.keys(SKINS.cpu).length;
  msgEl.textContent = have.length
    ? `Skins geladen: ${NAMES.human} (${nh}/7) gegen ${NAMES.cpu} (${nc}/7) ✓`
    : 'Keine Skins geladen – es wird mit Comic-Gesichtern gespielt.';
  clr.hidden = !have.length;
}
skinsReady.then(updateSkinUI);
document.getElementById('skinBtn').addEventListener('click', () => document.getElementById('skinFile').click());
document.getElementById('skinFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  const msgEl = document.getElementById('skinMsg');
  msgEl.textContent = 'Lade Skin-Paket…';
  try { await loadSkinZip(f); updateSkinUI(); }
  catch (err) { msgEl.textContent = '⚠ ' + (err && err.message ? err.message : 'Das ZIP konnte nicht gelesen werden.'); }
});
document.getElementById('skinClear').addEventListener('click', async () => { await clearSkins(); updateSkinUI(); });

document.getElementById('go').addEventListener('click', async () => {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume(); } catch (_) {}
  try { await document.documentElement.requestFullscreen(); } catch (_) {}
  try { await screen.orientation.lock('landscape'); } catch (_) {}
  document.getElementById('start').style.display = 'none';
  score = [0, 0]; me = cpu = null; carBroken = false; cracks = null; sipCd = 8; particles.length = 0; matchStats = { run: 0 }; trickMark = null; lastShot = null;
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
const maxSpeed = p => topSpeed(p) * (0.5 + 0.5 * p.stam) * (owner === p ? 0.9 : 1) * (sprinting(p) ? SPRINT_MULT : 1) * (p.boost || 1);

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
  if (ball.held === p) {                       // goalkeeper carrying the ball (kept inside the penalty area)
    if (ptr.move !== null) {
      const dx = ptr.mx - joy.x, dd = ptr.my - joy.y, l = Math.hypot(dx, dd);
      if (l > 10) {
        p.fx = dx / l; p.fd = dd / l; p.want = Math.min(1, (l - 10) / (joy.r - 10));
        const sp = p.want * maxSpeed(p) * 0.8;
        accelTo(p, p.fx * sp, p.fd * sp, dt); return;
      }
    }
    accelTo(p, 0, 0, dt); return;
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
const canKickNow = () => phase === 'play' &&
  (owner === me || ball.held === me ||
   (owner === null && !ball.held && dist2(me, ball) < KICK_R * 1.3 && ball.z < 40));
function startAim() {
  if (busy(me) || !canKickNow()) return;
  aim.active = true; aim.t0 = nowS();
  aim.lvx = me.vx; aim.lvd = me.vd;
  aim.ang = Math.atan2(me.fd, me.fx); aim.power = 0.5;
  buzz(10);
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
  if (Math.hypot(nx, ny) < 0.3) return;
  let k;
  if (Math.abs(ny) >= Math.abs(nx)) k = ny < 0 ? 'U' : 'D';
  else k = nx > 0 ? 'R' : 'L';
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
    trickMark = { type: 'dazzle', t: gameClock, clean: true };
    popup('Schwindelig!', o.x, o.d, '#ffd23f'); setMood(me, 'cheeky', 1.5); beep(880, 0.08, 'triangle', 0.15); beep(1320, 0.12, 'triangle', 0.1);
  } else if (seq === 'RLR' && o.x > me.x && o.x - me.x < 240 && Math.abs(o.d - me.d) < 100) {
    ball.vx = 300; ball.vd = me.vd * 0.3; ball.vz = 420; ball.z = Math.max(ball.z, 1);
    me.ng = 0.2; owner = null;
    o.dazzle = DAZZLE_TIME * (2 - aiSkill()); o.vx *= 0.3; o.vd *= 0.3;
    feint.cd = FEINT_CD; feint.tokens.length = 0;
    trickMark = { type: 'chip', t: gameClock, clean: true };
    popup('Drüber!', me.x, me.d, '#7ee081'); setMood(me, 'cheeky', 1.5); beep(500, 0.15, 'triangle', 0.25);
  }
}

// =====================================================================
//  Onkel specials: the soda break and the car-window easter egg
// =====================================================================
const TESTQ = location.search;
const SIP_RATE = /[?&]sip/.test(TESTQ) ? 3 : 0.12;          // chance per second while eligible
const SIP_CD = 20, SIP_DUR = 3.4;
const LONG_TRY_RATE = /[?&]crash/.test(TESTQ) ? 3 : 0.1;    // Onkel trying a long shot (per second, from far out)
const CRASH_CHANCE = /[?&]crash/.test(TESTQ) ? 1 : 0.35;    // …and that long shot going horribly wrong
const CAR_WIN = { x: -180, d: 40, z: 110 };                  // the car's rear window in world coordinates
let carBroken = false, sipCd = 0, alarmT = 0, cracks = null;
const particles = [];

function startSip(p) {
  if (p.sip || sipCd > 0) return;
  p.sip = { t: 0 }; p.pose = 'sip'; sipCd = SIP_CD; p.vx *= 0.3; p.vd *= 0.3;
  if (kickoffLock) kickoffLock = false;                        // a sip at kick-off: the ball is fair game!
}
function updateSip(p, dt) {                                    // returns true while Onkel is busy drinking
  if (!p.sip) return false;
  if (p.stun > 0 || p.dazzle > 0) { p.sip = null; p.pose = null; return false; }
  const S = p.sip; S.t += dt;
  accelTo(p, 0, 0, dt * 2);
  if (S.t > 0.6 && !S.s1) { S.s1 = 1; say(p, '*schlürf*', 1.4); [140, 120, 140].forEach((f, i) => setTimeout(() => beep(f, 0.09, 'sine', 0.2), i * 260)); }
  if (S.t > SIP_DUR - 0.8 && !S.s2) { S.s2 = 1; say(p, 'Ahhh!', 0.9); setMood(p, 'cheeky', 1.2); }
  if (S.t >= SIP_DUR) { p.sip = null; p.pose = null; return false; }
  return true;
}
const sipLift = p => { const t = p.sip ? p.sip.t : 0; return clamp(Math.min(t / 0.5, (SIP_DUR - t) / 0.5), 0, 1); };
function drawCan(p, s, dir) {
  const k = sipLift(p), e = k * k * (3 - 2 * k);
  const x = dir * (14 + 6 * e) * s, y = (-24 - 34 * e) * s, w = 8 * s, h = 13 * s;
  ctx.save(); ctx.translate(x, y); ctx.rotate(-dir * e * 0.9);
  ctx.fillStyle = '#d62828'; ctx.strokeStyle = '#3a0d0d'; ctx.lineWidth = 1.2 * s;
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 2 * s); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillRect(-w / 2, -1.5 * s, w, 3 * s);
  ctx.fillStyle = '#c9ced3'; ctx.fillRect(-w / 2 + 0.6 * s, -h / 2 - 1.5 * s, w - 1.2 * s, 2 * s);
  ctx.restore();
  ctx.fillStyle = '#f2c79b'; ctx.beginPath(); ctx.arc(x - dir * 3 * s, y + 2 * s, 3.6 * s, 0, Math.PI * 2); ctx.fill();   // hand around the can
}

const canCrash = () => themeReady && TH.car && !carBroken && phase === 'play';
// Onkel's "long shot" that flies straight into his own car's back window
function fireWildShot(p) {
  const T = 1.1, k = 0.3;                                     // flight time, air drag
  const dx = CAR_WIN.x - ball.x, dd = CAR_WIN.d - ball.d, f = k / (1 - Math.exp(-k * T));
  ball.vx = dx * f; ball.vd = dd * f;
  ball.vz = (CAR_WIN.z - ball.z + 0.5 * GRAVITY * T * T) / T;
  ball.wild = true; ball.wildT = 0;
  p.fx = Math.sign(dx) || -1; p.fd = 0; p.ng = 0.4; p.kickT = 0.5; owner = null;
  say(p, 'Weitschuss!', 1.1);
  beep(380, 0.1, 'triangle', 0.3);
}
function noise(dur, vol) {
  if (!AC) return;
  const n = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
  const src = AC.createBufferSource(), g = AC.createGain(); g.gain.value = vol;
  src.buffer = buf; src.connect(g).connect(AC.destination); src.start();
}
function carHit() {
  ball.wild = false; ball.out = true; carBroken = true; alarmT = 3.6;
  ball.vx = 140; ball.vd = 20; ball.vz = 120;
  cracks = [];                                                  // fixed crack pattern (normalised to the window)
  for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2 + Math.random() * 0.4; cracks.push([a, 0.55 + Math.random() * 0.6]); }
  for (let i = 0; i < 26; i++) particles.push({ kind: 'shard', x: CAR_WIN.x + (Math.random() - 0.5) * 30, d: CAR_WIN.d + Math.random() * 10, z: CAR_WIN.z + (Math.random() - 0.5) * 20,
    vx: (Math.random() - 0.3) * 160, vd: Math.random() * 90, vz: Math.random() * 160, r: 2 + Math.random() * 3.5, rot: Math.random() * 6, life: 4.5 });
  noise(0.6, 0.6); setTimeout(() => noise(0.25, 0.3), 120);
  for (let i = 0; i < 6; i++) setTimeout(() => beep(i % 2 ? 950 : 700, 0.28, 'square', 0.07), 300 + i * 300);   // car alarm
  popup('KLIRR!', CAR_WIN.x, CAR_WIN.d, '#ff5a4f');
  unlock('secret');
  startCarCrash();
}
function startCarCrash() {
  nextHumanKicks = true;
  celeb = { stage: 'party', t: 0, sc: cpu, ot: me, won: false, move: 'carCrash', k: {} };
  for (const p of [me, cpu]) { resetPose(p); p.slide = 0; p.stun = 0; p.dazzle = 0; p.recover = 0; p.z = 0; p.vz = 0; p.want = 0; p.sip = null; }
  setMood(cpu, 'shocked', 1.2); setMood(me, 'shocked', 0.8);
  ball.held = null; owner = null; aim.active = false; endSprint(); ptr.kick = null;
  msg = 'Oh nein…'; phase = 'celebrate';
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i]; q.life -= dt;
    if (q.z > 0 || q.vz > 0) { q.vz -= GRAVITY * dt; q.z += q.vz * dt; q.x += q.vx * dt; q.d += q.vd * dt; q.rot += dt * 8; }
    if (q.z <= 0) { q.z = 0; q.vz = 0; q.vx *= 0.8; q.vd *= 0.8; }
    if (q.life <= 0) particles.splice(i, 1);
  }
}
function drawParticles() {
  for (const q of particles) {
    const [x, y] = P(q.x, q.d, q.z), s = scaleAt(q.d);
    ctx.globalAlpha = Math.min(1, q.life / 0.6);
    if (q.kind === 'shard') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(q.rot);
      ctx.fillStyle = 'rgba(200,235,255,.9)'; ctx.strokeStyle = 'rgba(60,90,120,.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -q.r * s); ctx.lineTo(q.r * 0.8 * s, q.r * 0.6 * s); ctx.lineTo(-q.r * 0.7 * s, q.r * 0.4 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    } else {                                                    // tear drop
      ctx.fillStyle = '#5fb4ff';
      ctx.beginPath(); ctx.arc(x, y, 2.6 * s, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
// the car's broken window and blinking hazard light, drawn on top of the car prop
function drawCarDamage(sx, sy, pw, ph) {
  if (carBroken && cracks) {
    const x0 = sx - pw / 2 + pw * 945 / 1200, x1 = sx - pw / 2 + pw * 1140 / 1200, y0 = sy - ph + ph * 125 / 600, y1 = sy - ph + ph * 258 / 600;
    const cx = x0 + (x1 - x0) * 0.45, cy = y0 + (y1 - y0) * 0.5, R = (x1 - x0) * 0.55;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.fillStyle = 'rgba(10,12,18,.75)';                      // the hole
    ctx.beginPath();
    cracks.forEach(([a, l], i) => { const px = cx + Math.cos(a) * R * 0.35 * l, py = cy + Math.sin(a) * R * 0.35 * l; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(235,245,255,.95)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const [a, l] of cracks) { ctx.moveTo(cx + Math.cos(a) * R * 0.3 * l, cy + Math.sin(a) * R * 0.3 * l); ctx.lineTo(cx + Math.cos(a + 0.08) * R * 1.4 * l, cy + Math.sin(a + 0.08) * R * 1.4 * l); }
    for (const rr of [0.55, 0.85]) { cracks.forEach(([a, l], i) => { const px = cx + Math.cos(a) * R * rr * l, py = cy + Math.sin(a) * R * rr * l; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); }
    ctx.stroke();
    ctx.restore();
  }
  if (alarmT > 0 && Math.floor(alarmT * 4) % 2 === 0) {        // hazard lights blinking
    const lx = sx - pw / 2 + pw * 0.968, ly = sy - ph + ph * 0.6;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, pw * 0.08);
    g.addColorStop(0, 'rgba(255,180,40,.95)'); g.addColorStop(1, 'rgba(255,140,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, pw * 0.08, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------- AI ----------
function aiThink(p, dt) {
  if (busy(p)) return;
  if (p.dazzle > 0) { accelTo(p, 0, 0, dt * 0.7); return; }
  if (updateSip(p, dt)) return;                                // Onkel is having a drink…
  if (ball.held === p) {                       // walk the ball out towards the edge of the box
    const tx = FW - PA_DEPTH + 40, td = FD / 2, dx = tx - p.x, dd = td - p.d, l = Math.hypot(dx, dd) || 1;
    p.fx = -1; p.fd = 0;
    const sp = Math.min(maxSpeed(p) * 0.35, l * 2);
    accelTo(p, dx / l * sp, dd / l * sp, dt); return;
  }
  if (kickoffLock && kicker !== p) {
    // waiting for your kick-off: pace impatiently around the edge of the circle, never inside
    const t = nowS(), ang = Math.sin(t * 0.7) * 0.9, R = CIRCLE_R + 70 + Math.sin(t * 1.9) * 15;
    const tx = FW / 2 + Math.cos(ang) * R, td = FD / 2 + Math.sin(ang) * R;
    const dx = tx - p.x, dd = td - p.d, l = Math.hypot(dx, dd) || 1;
    p.fx = (me.x - p.x) / (dist2(me, p) || 1); p.fd = (me.d - p.d) / (dist2(me, p) || 1);
    accelTo(p, dx / l * Math.min(70, l * 3), dd / l * Math.min(70, l * 3), dt);
    return;
  }
  if (p.calm > 0) p.calm -= dt;
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
    if (p.calm > 0) frac = Math.min(frac, 0.25 + 0.75 * (1 - p.calm / 2.5));
    const dGoal = Math.hypot(p.x, p.d - FD / 2);
    // a cheeky soda break in Mark's half when nobody is close
    if (p.x < FW / 2 && sipCd <= 0 && dist2(opp, p) > 130 && Math.random() < dt * SIP_RATE) { startSip(p); return; }
    // now and then a long shot from far out… which can end up in his own car
    if (dGoal > 380 && dGoal < 820 && Math.random() < dt * LONG_TRY_RATE) {
      if (canCrash() && Math.random() < CRASH_CHANCE) { fireWildShot(p); return; }
      const gx = -p.x, gd = FD / 2 - p.d, gl = Math.hypot(gx, gd);
      p.fx = gx / gl; p.fd = gd / gl; doKick(p, 0.85 + Math.random() * 0.15); return;
    }
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
  if (ball.held === p) ball.held = null;      // goalkeeper punt
  p.kickT = 0.5;
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
  lastShot = { by: p, x: p.x, d: p.d };
  if (!p.ai) buzz(18);
  beep(180 + 200 * c, 0.1, 'triangle', 0.3);
}
function doTackle(p) {
  if (busy(p) || p.tcd > 0 || p.stam < 0.1) return;
  if (kickoffLock && p !== kicker) return;
  if (p.spd > 40) { p.fx = p.vx / p.spd; p.fd = p.vd / p.spd; }
  p.slideV = Math.max(p.spd, 250) + 120 * p.stam;
  p.slide = 0.35; p.tcd = 1.1; p.stam = Math.max(0, p.stam - 0.12);
  if (!p.ai) { beep(120, 0.12, 'sawtooth', 0.1); buzz(25); }
}

function movePlayer(p, other, dt) {
  if (p.dazzle > 0) { p.dazzle -= dt; if (p.dazzle <= 0) p.dazImm = DAZZLE_IMMUNE; }
  else p.dazImm = Math.max(0, p.dazImm - dt);
  p.moodT = Math.max(0, p.moodT - dt); p.kickT = Math.max(0, p.kickT - dt);
  p.stun = Math.max(0, p.stun - dt); p.tcd = Math.max(0, p.tcd - dt); p.ng = Math.max(0, p.ng - dt);
  if (p.recover > 0) { p.recover -= dt; accelTo(p, 0, 0, dt); }
  if (p.stun > 0) accelTo(p, 0, 0, dt * 0.6);
  if (p.slide > 0) {
    p.slide -= dt;
    p.vx = p.fx * p.slideV; p.vd = p.fd * p.slideV;
    if (inKeeperZone(p) && !ball.held &&
        ((dist2(p, ball) < 32 && ball.z < 40) || (owner === other && dist2(other, p) < PR * 2 + 6))) {
      if (p === me && (owner === other || ball.held === other)) achCount('tackles', 'tackles', 10);
      ball.held = p; ball.holdT = HOLD_T; owner = p; p.slide = 0;
      if (dist2(other, p) < PR * 2 + 10) { other.stun = 0.6; other.ng = 0.8; }
      popup('Gefangen!', p.x, p.d, p.ai ? '#7fb2ff' : '#ff7b84'); beep(300, 0.1, 'triangle', 0.2);
    } else if (dist2(p, ball) < 32 && ball.z < 20) {
      if (p === me && owner === other) achCount('tackles', 'tackles', 10);
      ball.vx = p.fx * 300 + (Math.random() - 0.5) * 120;
      ball.vd = p.fd * 300 + (Math.random() - 0.5) * 120;
      ball.vz = 60; p.ng = 0.25; owner = null;
    }
    if (other.stun <= 0 && ball.held !== other && dist2(other, p) < PR * 2 + 6) {
      if (owner === other) { setMood(p, 'cheeky', 1.2); if (p === me) achCount('tackles', 'tackles', 10); }
      other.stun = 0.9; other.ng = 0.9; if (owner === other) owner = null;
      beep(90, 0.15, 'square', 0.15);
    }
    if (p.slide <= 0) { p.recover = 0.4; p.vx *= 0.25; p.vd *= 0.25; }
  }
  p.x = p.free ? p.x + p.vx * dt : clamp(p.x + p.vx * dt, -20, FW + 20);
  p.d = p.free ? clamp(p.d + p.vd * dt, -30, FD + 20) : clamp(p.d + p.vd * dt, 0, FD);
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
  if (Math.abs(vn) > 200) popup('Pfosten!', ball.x, ball.d, '#ddd');
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
  if (ball.out) {                                              // lying around next to the car: no walls, no goals
    ball.x += ball.vx * dt; ball.d += ball.vd * dt; ball.z += ball.vz * dt;
    if (ball.z > 0 || ball.vz > 0) ball.vz -= GRAVITY * dt;
    if (ball.z < 0) { ball.z = 0; ball.vz = ball.vz < -120 ? -ball.vz * 0.4 : 0; }
    const fr = Math.exp(-(ball.z > 0 ? 0.3 : 2) * dt); ball.vx *= fr; ball.vd *= fr;
    return;
  }
  if (ball.wild) {
    ball.wildT += dt;
    ball.x += ball.vx * dt; ball.d += ball.vd * dt; ball.z += ball.vz * dt; ball.vz -= GRAVITY * dt;
    const fr = Math.exp(-0.3 * dt); ball.vx *= fr; ball.vd *= fr;
    if (ball.x < -150 && ball.x > -235 && Math.abs(ball.d - CAR_WIN.d) < 50 && ball.z > 70 && ball.z < 150) { carHit(); return; }
    if (ball.z <= 0 || ball.wildT > 2.5 || ball.x < -260) { ball.wild = false; ball.x = Math.max(ball.x, BR); ball.z = Math.max(0, ball.z); }
    return;
  }
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
  setMood(team === 0 ? me : cpu, 'celebrate', 4); setMood(team === 0 ? cpu : me, 'sad', 4);
  owner = null;
  nextHumanKicks = team === 1;                        // whoever conceded kicks off
  const won = score[team] >= MATCH_GOALS;
  achGoal(team);
  if (won) achMatchEnd(team === 0);
  msg = won ? (team === 0 ? 'GEWONNEN! 🏆' : 'Onkel gewinnt – Revanche?') : (team === 0 ? 'TOOOR! 🎉' : 'Onkel trifft!');
  startCelebration(team, won);
  if (team === 0) [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'square', 0.12), i * 110));
  else beep(150, 0.4, 'sawtooth', 0.1);
}

function separate() {
  const dx = cpu.x - me.x, dd = cpu.d - me.d, dist = Math.hypot(dx, dd);
  if (dist > 0 && dist < PR * 2) {
    const over = PR * 2 - dist, nx = dx / dist, nd = dd / dist;
    const wMe = owner === me ? 0 : owner === cpu ? 1 : 0.5;   // ball carrier holds their ground
    me.x -= nx * over * wMe; me.d -= nd * over * wMe;
    cpu.x += nx * over * (1 - wMe); cpu.d += nd * over * (1 - wMe);
  }
}

// =====================================================================
//  Goal celebrations → fist bump → walk back → ball drops from the sky
// =====================================================================
const CPU_MOVES = ['armsUp', 'shades', 'jumpPunch', 'vArms', 'basic'];
const SUNGLASSES = new Image(); SUNGLASSES.src = 'img/sunglasses.png';
const HUMAN_MOVES = ['toorRun', 'ronaldo', 'kneeSlide', 'runHouse', 'basic'];
let celeb = null, lastMsg = '', msgStart = 0;

function say(p, txt, t) { p.say = { txt, t }; }
function resetPose(p) { p.cool = false; p.pose = null; p.legs = null; p.spin = null; p.free = false; p.hidden = false; p.kneeSlide = false; p.boost = 1; }
function goTo(p, tx, td, frac, dt) {
  const dx = tx - p.x, dd = td - p.d, l = Math.hypot(dx, dd);
  if (l > 3) {
    p.fx = dx / l; p.fd = dd / l;
    const sp = Math.min(frac * maxSpeed(p), l * 3);
    accelTo(p, p.fx * sp, p.fd * sp, dt);
  } else accelTo(p, 0, 0, dt);
  return l;
}
function jump(p, vz) { if ((p.z || 0) <= 0) { p.vz = vz; p.z = 0.01; } }
const airborne = p => (p.z || 0) > 0;

function startCelebration(team, won) {
  const sc = team === 0 ? me : cpu, ot = sc === me ? cpu : me;
  const list = sc === me ? HUMAN_MOVES : CPU_MOVES;
  celeb = { stage: 'party', t: 0, sc, ot, won, move: list[Math.floor(Math.random() * list.length)], k: {} };
  if (/[?&]celeb=/.test(location.search)) celeb.move = location.search.match(/celeb=(\w+)/)[1];   // testing aid
  if (sc === me && HUMAN_MOVES.includes(celeb.move)) achCeleb(celeb.move);
  for (const p of [me, cpu]) { resetPose(p); p.slide = 0; p.stun = 0; p.dazzle = 0; p.recover = 0; p.z = 0; p.vz = 0; p.want = 0; p.stam = Math.max(p.stam, 0.85); p.sip = null; }
  setMood(sc, 'celebrate', 30); setMood(ot, 'sad', 30);
  ball.held = null; owner = null; aim.active = false; endSprint(); ptr.kick = null;
  phase = 'celebrate';
}
function skipCelebration() {
  if (!celeb || celeb.stage !== 'party') return;
  for (const p of [me, cpu]) { resetPose(p); p.say = null; if (p.x < -20) p.x = -20; }
  setMood(me, 'neutral', 0); setMood(cpu, 'neutral', 0);
  if (celeb.won) { phase = 'over'; phaseT = 2.5; return; }
  celeb.stage = 'walk'; celeb.t = 0; msg = '';
}

// --- the scorer's party moves. Returns true when finished.
function partyMove(p, T, k, dt) {
  const toCentre = Math.sign(FW / 2 - p.x) || 1;
  switch (celeb.move) {
    case 'armsUp':                                              // CPU: arms straight up, "Jaaaaa!"
      if (!k.init) { k.init = 1; p.pose = 'up'; say(p, 'Jaaaaa!', 2.4); }
      accelTo(p, 0, 0, dt);
      if ((T > 0.4 && T < 0.5) || (T > 1.3 && T < 1.4)) jump(p, 220);
      return T > 2.8;
    case 'vArms':                                               // CPU: arms in a V
      p.pose = 'v'; accelTo(p, 0, 0, dt);
      return T > 2.4;
    case 'shades':                                              // CPU: puts on sunglasses, strolls to the centre looking important
      if (!k.init) { k.init = 1; p.glasses = 0; p.pose = 'glasses'; accelTo(p, 0, 0, dt); }
      if (p.glasses < 1) { p.glasses = Math.min(1, p.glasses + dt / 0.9); accelTo(p, 0, 0, dt * 2); if (p.glasses >= 1) { p.pose = null; k.t0 = T; } return false; }
      p.cool = true;
      return goTo(p, FW / 2 + (p.ai ? 90 : -90), FD / 2, 0.26, dt) < 20 || T - k.t0 > 4.5;
    case 'carCrash': {                                          // Onkel's car window… and Mark laughing
      const m = celeb.ot;
      if (!k.init) { k.init = 1; say(p, 'NEEEIN!', 1.2); p.pose = 'up'; }
      if (T < 0.9) { accelTo(p, 0, 0, dt * 2); accelTo(m, 0, 0, dt); return false; }
      if (!k.arrived) {                                         // run to the car, hands on the head
        p.free = true; p.boost = 1.3; p.pose = 'up';
        if (goTo(p, -95, 92, 1, dt) < 18 || T > 3.2) { k.arrived = T; p.vx = p.vd = 0; p.hx = -1; p.legs = 'kneel'; p.pose = 'cry'; setMood(p, 'sad', 10); say(p, 'Mein Auto!!', 1.8); }
      } else {
        accelTo(p, 0, 0, dt * 3);
        if ((k.tear || 0) < T) {                                 // tears
          k.tear = T + 0.09;
          for (const sgn of [-1, 1]) particles.push({ kind: 'tear', x: p.x + sgn * 9, d: p.d + 1, z: 52, vx: sgn * (40 + Math.random() * 50), vd: 0, vz: 60 + Math.random() * 60, rot: 0, life: 1.2 });
        }
        if (T - k.arrived > 2.2 && !k.sob) { k.sob = 1; say(p, '*schnief* 😭', 1.4); }
      }
      // Mark: walks over a bit, points at Onkel and laughs
      if (T > 0.3) {
        if (!k.mArr) { m.boost = 1.2; if (goTo(m, 130, 170, 1, dt) < 25 || T > 5) { k.mArr = T; m.boost = 1; } }
        else {
          accelTo(m, 0, 0, dt * 2); m.hx = Math.sign(p.x - m.x) || -1; m.pose = 'point'; setMood(m, 'celebrate', 2);
          m.shake = true;
          if (!m.say) say(m, ['Hahaha!', 'Hihihi!', 'Hahaha!'][Math.floor(T) % 3], 0.9);
          if (Math.floor(T * 2.5) !== k.hop) { k.hop = Math.floor(T * 2.5); jump(m, 110); }
        }
      }
      if (k.arrived && T - k.arrived > 4 && k.mArr && T - k.mArr > 2.5) {
        m.pose = null; m.shake = false; m.say = null; p.pose = null; p.legs = null; p.boost = 1; p.say = null;
        msg = ''; return true;                                   // (Onkel stays "free" until he is back on the pitch)
      }
      return false;
    }
    case 'jumpPunch':                                           // CPU: run a few metres, jump, swing the arm
      if (!k.init) { k.init = 1; k.tx = clamp(p.x + toCentre * 170, 60, FW - 60); k.td = clamp(p.d + 30, 60, FD - 60); k.st = 0; }
      if (k.st === 0) { if (goTo(p, k.tx, k.td, 1, dt) < 30 || T > 2) { k.st = 1; jump(p, 400); p.pose = 'punch'; k.tl = T; } return false; }
      accelTo(p, 0, 0, dt * 0.5);
      if (k.st === 1 && !airborne(p)) { k.st = 2; k.tl = T; }
      return k.st === 2 && T - k.tl > 0.9;
    case 'toorRun':                                             // human: "TOOOOR!" and run around wildly
      if (!k.init) { k.init = 1; say(p, 'TOOOOR!', 3); p.pose = 'up'; k.next = 0; }
      if (T > k.next) { k.next = T + 0.55 + Math.random() * 0.3; k.tx = clamp(p.x + (Math.random() - 0.5) * 360, 60, FW - 60); k.td = 40 + Math.random() * (FD - 80); }
      goTo(p, k.tx, k.td, 1, dt);
      return T > 3.4;
    case 'ronaldo':                                             // human: sprint, jump, turn 180° in the air, land in the pose
      if (!k.init) { k.init = 1; k.st = 0; k.tx = clamp(p.x + toCentre * 130, 60, FW - 60); k.td = clamp(p.d + 90, 60, FD - 30); }
      if (k.st === 0) { if (goTo(p, k.tx, k.td, 1, dt) < 30 || T > 1.4) { k.st = 1; jump(p, 430); k.air = 2 * 430 / GRAVITY; k.t0 = T; k.dir0 = p.hx >= 0 ? 1 : -1; } return false; }
      if (k.st === 1) {
        accelTo(p, 0, 0, dt * 0.6);
        const pr = clamp((T - k.t0) / k.air, 0, 1);
        p.spin = Math.cos(pr * Math.PI);                         // 1 → -1 : the half turn
        if (!airborne(p) && T - k.t0 > 0.2) { k.st = 2; k.tl = T; p.spin = null; p.hx = -k.dir0; p.vx = p.vd = 0; p.pose = 'siu'; p.legs = 'apart'; }
        return false;
      }
      accelTo(p, 0, 0, dt * 3);
      return T - k.tl > 1.8;
    case 'kneeSlide':                                           // human: sprint, jump, slide on the knees
      if (!k.init) { k.init = 1; k.st = 0; k.tx = clamp(p.x + toCentre * 260, 60, FW - 60); k.td = clamp(p.d + 40, 60, FD - 40); }
      if (k.st === 0) { goTo(p, k.tx, k.td, 1, dt); if (T > 0.9) { k.st = 1; jump(p, 220); } return false; }
      if (k.st === 1) { if (!airborne(p)) { k.st = 2; k.tl = T; p.legs = 'kneel'; p.pose = 'v'; p.kneeSlide = true;
          const sp = Math.max(260, p.spd); p.vx = p.fx * sp; p.vd = p.fd * sp; } return false; }
      if (p.spd < 8) { p.vx = p.vd = 0; if (!k.stopT) k.stopT = T; }
      return k.stopT && T - k.stopT > 1.2;
    case 'runHouse': {                                          // human: run behind the house shouting for Mum
      if (!k.init) { k.init = 1; k.i = 0; p.free = true; p.pose = 'up'; p.boost = 1.4;
        k.path = [[20, 72], [-200, 70], [-445, 80]]; }
      if (k.i < k.path.length) {
        if (!p.say) say(p, 'Ma! Maaaaa! Tor! Tooor!', 1.3);       // keeps shouting while running
        const [tx, td] = k.path[k.i];
        if (goTo(p, tx, td, 1, dt) < 25) k.i++;
        if (k.i === k.path.length) { k.hideT = T; p.hidden = true; }
        return false;
      }
      if (T - k.hideT < 0.9) { accelTo(p, 0, 0, dt); return false; }   // (braking every frame made the return a snail's pace)
      p.hidden = false;                                          // comes back for the fist bump
      if (!k.back) { k.back = 1; k.j = 0; k.path2 = [[-200, 70], [20, 72]]; p.pose = null; }
      if (k.j < k.path2.length) { const [tx, td] = k.path2[k.j]; if (goTo(p, tx, td, 1, dt) < 25) k.j++; return false; }
      p.free = false; return true;
    }
    default:                                                    // 'basic' – the original little celebration
      p.pose = 'v'; accelTo(p, 0, 0, dt);
      if ((T > 0.3 && T < 0.4) || (T > 1.0 && T < 1.1)) jump(p, 200);
      return T > 2.2;
  }
}

function kickoffSpots() {
  const c = FW / 2, near = PR + BR + 2;
  return nextHumanKicks ? { me: [c - near, FD / 2], cpu: [c + 230, FD / 2] } : { me: [c - 230, FD / 2], cpu: [c + near, FD / 2] };
}

function updateCelebration(dt) {
  const C = celeb, sc = C.sc, ot = C.ot;
  C.t += dt;
  // vertical motion (jumps)
  for (const p of [me, cpu]) {
    if (airborne(p) || p.vz > 0) { p.vz -= GRAVITY * dt; p.z += p.vz * dt; if (p.z <= 0) { p.z = 0; p.vz = 0; } }
    if (p.kneeSlide) { const f = Math.exp(-1.3 * dt); p.vx *= f; p.vd *= f; }
  }
  if (C.stage === 'party') {
    if (C.t > 2.2) msg = '';
    if (C.move !== 'carCrash') accelTo(ot, 0, 0, dt);         // the other one stands there, gutted
    if (partyMove(sc, C.t, C.k, dt)) { const fr = sc.free; resetPose(sc); sc.free = fr; sc.z = 0; C.stage = 'walk'; C.t = 0; }
  } else if (C.stage === 'walk') {
    // both head for the centre spot, each stopping just inside his own half
    for (const p of [me, cpu]) if (p.free && p.x > 10 && p.d >= 0) p.free = false;
    const c = FW / 2, arm = 32;                                  // one arm length each side of the line
    const a = goTo(me, c - arm, FD / 2, 0.6, dt), b = goTo(cpu, c + arm, FD / 2, 0.6, dt);
    if ((a < 10 && b < 10) || C.t > 8) {
      for (const p of [me, cpu]) { const o = p === me ? cpu : me; p.hx = Math.sign(o.x - p.x) || 1; p.pose = 'fist'; p.vx = p.vd = 0; }
      popup('👊', c, FD / 2, '#fff'); beep(330, 0.06, 'square', 0.2); beep(260, 0.1, 'triangle', 0.2);
      setMood(me, 'neutral', 0); setMood(cpu, 'neutral', 0);
      C.stage = 'bump'; C.t = 0;
    }
  } else if (C.stage === 'bump') {
    for (const p of [me, cpu]) accelTo(p, 0, 0, dt * 2);
    if (C.t > 0.9) {
      resetPose(me); resetPose(cpu);
      if (C.won) { phase = 'over'; phaseT = 3; msg = score[0] > score[1] ? 'GEWONNEN! 🏆' : 'Onkel gewinnt – Revanche?'; return; }
      Object.assign(ball, { x: FW / 2, d: FD / 2, z: 420, vx: 0, vd: 0, vz: 0, held: null, wild: false, out: false });
      C.stage = 'drop'; C.t = 0;
    }
  } else if (C.stage === 'drop') {
    // the ball falls from the sky; the kicker steps up, the other one backs off to the usual distance
    const sp = kickoffSpots();
    const a = goTo(me, sp.me[0], sp.me[1], 0.5, dt), b = goTo(cpu, sp.cpu[0], sp.cpu[1], 0.5, dt);
    me.hx = 1; cpu.hx = -1;
    const vz0 = ball.vz;
    ballPhysics(dt, false);
    if (vz0 < -150 && ball.vz > 0) beep(160, 0.08, 'triangle', 0.25);   // bounce "tok"
    if ((C.t > 0.5 && ball.z <= 0 && ball.vz === 0 && a < 8 && b < 8) || C.t > 6) {
      celeb = null; setupKickoff(nextHumanKicks); phaseT = 0.8; return;
    }
  }
  if (C.stage !== 'drop') ballPhysics(dt, false);
  for (const p of [me, cpu]) {
    if (p.say) { p.say.t -= dt; if (p.say.t <= 0) p.say = null; }
    movePlayer(p, p === me ? cpu : me, dt);
  }
  if (C.stage === 'bump' || C.stage === 'walk') separate();
}

function updateCamera(dt) {
  const halfNear = (W / 2) / (F / D0);
  const extra = themeReady ? 160 : 0;          // backyard: show a bit more of the yard beside the goals
  const lo = -GOAL_DEPTH - 70 - extra + halfNear, hi = FW + GOAL_DEPTH + 70 + extra - halfNear;
  let focus = ball.x * 0.75 + me.x * 0.25;
  if (phase === 'celebrate' && celeb) focus = celeb.stage === 'party' ? (celeb.move === 'carCrash' ? -60 : celeb.sc.x) : celeb.stage === 'drop' ? FW / 2 : (me.x + cpu.x) / 2;
  const target = clamp(focus, lo, hi);
  camX += ((lo > hi ? FW / 2 : target) - camX) * Math.min(1, dt * 3);
}

function update(dt) {
  if (phase === 'menu' || !me) return;
  if (phase === 'ready') {
    phaseT -= dt;
    if (phaseT <= 0) { phase = 'play'; msg = ''; if (kicker === cpu && sipCd <= 0 && Math.random() < (/[?&]sip/.test(TESTQ) ? 1 : 0.25)) startSip(cpu); }
  } else if (phase === 'play') {
    feint.cd = Math.max(0, feint.cd - dt);
    gameClock += dt; sipCd = Math.max(0, sipCd - dt);
    if (trickMark && (owner === cpu || ball.held === cpu)) trickMark.clean = false;   // the CPU touched it: no longer counts
    if (aim.active && (me.stun > 0 || me.slide > 0 || (owner !== me && dist2(me, ball) > KICK_R * 2))) aim.active = false;
    humanInput(dt); aiThink(cpu, dt);
    movePlayer(me, cpu, dt); movePlayer(cpu, me, dt);
    separate(); enforceKickoff(dt); keeperCheck();
    if (ball.held) heldBall(dt); else { dribble(); ballPhysics(dt, true); }
    if (sprint.active) { sprint.t -= dt; if (sprint.t <= 0) endSprint(); }
  } else if (phase === 'celebrate') {
    updateCelebration(dt);
  } else {                                            // 'over': let things settle
    for (const p of [me, cpu]) { p.slide = 0; p.want = 0; accelTo(p, 0, 0, dt); movePlayer(p, p === me ? cpu : me, dt); }
    ballPhysics(dt, false);
    phaseT -= dt;
    if (phaseT <= 0) {
      { msg = ''; boardOpen = 'end'; phase = 'board'; }
    }
  }
  if (!sprint.active) sprint.cd = Math.max(0, sprint.cd - dt);
  updateParticles(dt); alarmT = Math.max(0, alarmT - dt);
  updateCamera(dt);
}

// ---------- Goalkeeper zone ----------
function inKeeperZone(p) {
  const gx = p.ai ? FW : 0;
  return Math.abs(p.x - gx) < PA_DEPTH && Math.abs(p.d - FD / 2) < PA_HALF;
}
function keeperCheck() {
  if (ball.held || owner || ball.wild) return;
  for (const p of [me, cpu]) {
    if (p.stun > 0 || p.slide > 0 || p.ng > 0 || p.dazzle > 0 || !inKeeperZone(p)) continue;
    if (!(p.ai ? ball.vx > 30 : ball.vx < -30)) continue;          // only shots coming at your goal
    if (dist2(p, ball) > KEEP_REACH || ball.z > 75) continue;
    const sp = Math.hypot(ball.vx, ball.vd, ball.vz), sk = p.ai ? aiSkill() : 1;
    if (sp < CATCH_SPEED * sk) {
      ball.held = p; ball.holdT = HOLD_T; owner = p;
      setMood(p === me ? cpu : me, 'shocked', 1.5);
      if (p === me) achCount('saves', 'keeper', 10);
      popup('Gefangen!', p.x, p.d, '#7fb2ff'); beep(300, 0.1, 'triangle', 0.2);
    } else if (sp < PARRY_SPEED * sk && Math.random() < 0.6 * sk) {
      ball.vx *= -0.35; ball.vd = ball.vd * 0.3 + (Math.random() - 0.5) * 300; ball.vz = 150;
      p.ng = 0.4; if (p === me) achCount('saves', 'keeper', 10); popup('Gehalten!', p.x, p.d, '#7fb2ff'); beep(220, 0.15, 'square', 0.15);
    } else p.ng = 0.5;                                               // beaten – don't check this shot again
    return;
  }
}
function heldBall(dt) {
  const p = ball.held;
  const x0 = p.ai ? FW - PA_DEPTH + PR : PR, x1 = p.ai ? FW - PR : PA_DEPTH - PR;
  const d0 = FD / 2 - PA_HALF + PR, d1 = FD / 2 + PA_HALF - PR;
  if (p.x < x0 || p.x > x1) { p.x = clamp(p.x, x0, x1); p.vx = 0; }
  if (p.d < d0 || p.d > d1) { p.d = clamp(p.d, d0, d1); p.vd = 0; }
  ball.x = p.x + (p.hx >= 0 ? 1 : -1) * 10; ball.d = p.d + 0.5; ball.z = 24;
  ball.vx = ball.vd = ball.vz = 0; owner = p;
  ball.holdT -= dt;
  if (ball.holdT <= 0 && !(p === me && aim.active)) {               // drop it to the feet and play on
    ball.held = null; ball.z = 0;
    ball.x = p.x + p.fx * (PR + BR + 2); ball.d = p.d + p.fd * (PR + BR + 2);
  }
}

// Keep the player without the ball outside the centre circle until the ball leaves it.
function enforceKickoff(dt) {
  if (!kickoffLock) return;
  kickoffT += dt;
  if (Math.hypot(ball.x - FW / 2, ball.d - FD / 2) > CIRCLE_R || kicker.spd > 25) { kickoffLock = false; return; }
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

// =====================================================================
//  Backyard theme (optional): theme/backyard/*. If any required file is
//  missing, the generic stadium is drawn instead.
// =====================================================================
const THEME_DIR = 'theme/backyard/';
const TH = {};
let groundPieces = null, skyCol = '#8cc8ee';
const GX0 = -620, GX1 = FW + 420, GD0 = -45, GD1 = FD + 45;   // world area baked into the ground texture
const GPU = 2.8, GPIECES = 2;                                  // texture px per world unit; split to stay < 4096 px
const TILE_WORLD = 170;                                        // world units covered by one gravel tile
const WALL_D = -40, WALL_H = 62;                               // the stone wall stands just behind the far touchline
const PROPS = [                                                // [image, x, d, height in world units]
  ['car', -300, 40, 165], ['bush', 790, -27, 72], ['bush', 905, -30, 56], ['tree', FW + 150, -22, 240],
  ['palm', -175, 105, 88], ['house', -330, 112, 300],
];                                                             // keep sorted far → near (drawn in this order)
(function loadTheme() {
  const req = { backdrop: 'backdrop.jpg', wall: 'wall.jpg', grey: 'gravel_grey.jpg', brown: 'gravel_brown.jpg' };
  const opt = { palm: 'prop_palm.png', bush: 'prop_bush.png', tree: 'prop_tree.png', house: 'prop_house.png', car: 'prop_car.png' };
  let left = Object.keys(req).length, failed = false;
  for (const [k, f] of Object.entries(req)) {
    const im = new Image();
    im.onload = () => { TH[k] = im; if (--left === 0 && !failed) buildTheme(); };
    im.onerror = () => { failed = true; };
    im.src = THEME_DIR + f;
  }
  for (const [k, f] of Object.entries(opt)) { const im = new Image(); im.onload = () => { TH[k] = im; }; im.src = THEME_DIR + f; }
})();

// Where the dark grey gravel lies (the rest is the finer brown gravel), roughly like the real yard.
function greyArea(g) {
  const X = x => (x - GX0) * GPU, Y = d => (d - GD0) * GPU;
  g.beginPath();
  g.moveTo(X(GX0), Y(GD0));
  for (let d = GD0; d <= GD1; d += 5) {
    const xb = 470 + 0.45 * d + 22 * Math.sin(d * 0.045) + 9 * Math.sin(d * 0.17);
    g.lineTo(X(xb), Y(d));
  }
  g.lineTo(X(GX0), Y(GD1)); g.closePath();
  // grey patch in the brown part
  for (let i = 0; i <= 40; i++) {
    const a = i / 40 * Math.PI * 2, r = 1 + 0.12 * Math.sin(a * 3 + 1) + 0.07 * Math.sin(a * 7);
    const x = 880 + Math.cos(a) * 150 * r, d = 215 + Math.sin(a) * 85 * r;
    i ? g.lineTo(X(x), Y(d)) : g.moveTo(X(x), Y(d));
  }
  g.closePath();
}
function buildTheme() {
  const Wpx = Math.ceil((GX1 - GX0) * GPU), Hpx = Math.ceil((GD1 - GD0) * GPU), pw = Math.ceil(Wpx / GPIECES);
  const tile = TILE_WORLD * GPU;
  const fill = (g, img, ox) => {
    for (let ty = 0; ty < Hpx; ty += tile)
      for (let tx = Math.floor(ox / tile) * tile; tx < ox + pw; tx += tile) g.drawImage(img, tx, ty, tile + 1, tile + 1);
  };
  groundPieces = [];
  for (let i = 0; i < GPIECES; i++) {
    const c = document.createElement('canvas'); c.width = pw; c.height = Hpx;
    const g = c.getContext('2d'), ox = i * pw;
    g.setTransform(1, 0, 0, 1, -ox, 0);
    fill(g, TH.brown, ox);
    g.save(); greyArea(g); g.clip(); fill(g, TH.grey, ox); g.restore();
    g.save(); greyArea(g); g.strokeStyle = 'rgba(40,30,25,.35)'; g.lineWidth = 3; g.stroke(); g.restore();
    const sh = g.createLinearGradient(0, 0, 0, 30 * GPU);                    // soft shade at the foot of the wall
    sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.fillRect(ox, 0, pw, 30 * GPU);
    groundPieces.push({ c, x0: GX0 + ox / GPU, x1: GX0 + (ox + pw) / GPU });
  }
  // GPU-resident, immutable copies draw faster (especially on tablets)
  if (window.createImageBitmap) for (const pc of groundPieces) createImageBitmap(pc.c).then(bm => { pc.c = bm; }).catch(() => {});
  try {                                                                       // sky colour = top of the backdrop
    const t = document.createElement('canvas'); t.width = t.height = 1;
    const tg = t.getContext('2d'); tg.drawImage(TH.backdrop, 0, 0, 40, 4, 0, 0, 1, 1);
    const [r, gg, b] = tg.getImageData(0, 0, 1, 1).data; skyCol = `rgb(${r},${gg},${b})`;
  } catch (_) {}
  themeReady = true; resize();
}

// Ground in perspective: the baked top-down texture is drawn in thin horizontal strips.
function drawGroundTex() {
  // Compute the strips once, then draw them grouped by texture piece: switching between the two big
  // textures for every strip made the GPU thrash (laggy whenever the view spanned both pieces).
  const dAt = y => D0 + FD - A / Math.max(1, y - HY);
  const yTop = Math.max(0, Math.floor(P(0, GD0)[1])), STEP = 4, strips = [];
  for (let y = yTop; y < H; y += STEP) {
    const y1 = Math.min(H, y + STEP);
    const da = Math.max(GD0, dAt(y)), db = Math.min(GD1, dAt(y1));
    if (db > da) strips.push([y, y1, da, db, F / camDist((da + db) / 2)]);
  }
  for (const pc of groundPieces) {
    for (const [y, y1, da, db, k] of strips) {
      const ix0 = Math.max(camX - (W / 2) / k, pc.x0), ix1 = Math.min(camX + (W / 2) / k, pc.x1);
      if (ix1 <= ix0) continue;
      const dx0 = W / 2 + (ix0 - camX) * k, dx1 = W / 2 + (ix1 - camX) * k;
      ctx.drawImage(pc.c, (ix0 - pc.x0) * GPU, (da - GD0) * GPU, (ix1 - ix0) * GPU, Math.max(0.5, (db - da) * GPU),
        dx0, y, dx1 - dx0 + 0.6, y1 - y + 0.6);
    }
  }
}
function drawBackdropAndWall() {
  const k = scaleAt(WALL_D), base = P(0, WALL_D)[1], wallTop = base - WALL_H * k;
  // backdrop with parallax; its bushy bottom hides behind the wall
  const hb = Math.max(250, wallTop + 80), wb = TH.backdrop.width * hb / TH.backdrop.height, yb = wallTop + 45;
  ctx.fillStyle = skyCol; ctx.fillRect(0, 0, W, Math.max(0, yb - hb) + 2);
  const off = ((-camX * k * 0.45) % wb + wb) % wb;
  for (let x = off - wb; x < W; x += wb) ctx.drawImage(TH.backdrop, x, yb - hb, wb + 0.5, hb);
  // the wall (a plane facing the camera, so a plain scaled strip)
  const ww = TH.wall.width * (WALL_H * k) / TH.wall.height;
  const woff = ((W / 2 - camX * k) % ww + ww) % ww;
  for (let x = woff - ww; x < W; x += ww) ctx.drawImage(TH.wall, x, wallTop, ww + 0.5, WALL_H * k + 1);
}
const FOREGROUND_PROPS = ['palm', 'house'];                  // drawn over the players (someone can run behind them)
function drawProps(fg = false) {
  for (const [name, x, d, h] of PROPS) {
    if (FOREGROUND_PROPS.includes(name) !== fg) continue;
    const img = TH[name]; if (!img) continue;
    const s = scaleAt(d), ph = h * s, pw = img.width / img.height * ph, [sx, sy] = P(x, d);
    if (sx + pw < 0 || sx - pw > W) continue;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(sx, sy, pw * 0.35, pw * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(img, sx - pw / 2, sy - ph, pw, ph);
    if (name === 'car') drawCarDamage(sx, sy, pw, ph);
  }
}
// Orange training cones mark the goal posts (the goal frame itself is drawn "ghosted").
function drawCone(x, d) {
  const s = scaleAt(d), [cx, cy] = P(x, d), h = 30 * s, r = 11 * s, t = 2.5 * s;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(cx + 3 * s, cy, r * 1.5, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8650f';                                                  // square base
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.35, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  const body = new Path2D();
  body.moveTo(cx - r, cy); body.lineTo(cx - t, cy - h); body.lineTo(cx + t, cy - h); body.lineTo(cx + r, cy);
  body.quadraticCurveTo(cx, cy + r * 0.35, cx - r, cy); body.closePath();
  const gr = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  gr.addColorStop(0, '#ffa040'); gr.addColorStop(0.45, '#ff7a1a'); gr.addColorStop(1, '#c9500a');
  ctx.fillStyle = gr; ctx.fill(body);
  ctx.save(); ctx.clip(body);                                                 // white reflective band
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(cx - r, cy - h * 0.62, 2 * r, h * 0.16);
  ctx.restore();
  ctx.strokeStyle = '#6b2c05'; ctx.lineWidth = Math.max(1, 1.4 * s); ctx.stroke(body);
}

function drawStadium() {
  if (themeReady) { drawBackdropAndWall(); drawGroundTex(); drawProps(); return; }
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
  const n = themeReady ? 0 : 11;                  // backyard: no grass stripes, chalk lines only
  if (themeReady) ctx.globalAlpha = 0.5;
  for (let i = 0; i < n; i++) {
    const x0 = FW * i / n, x1 = FW * (i + 1) / n + 0.5;
    poly([P(x0, 0), P(x1, 0), P(x1, FD), P(x0, FD)], i % 2 ? '#2fa24b' : '#29943f');
  }
  ctx.strokeStyle = ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
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
    line(x, FD / 2 - PA_HALF, x + s * PA_DEPTH, FD / 2 - PA_HALF);
    line(x + s * PA_DEPTH, FD / 2 - PA_HALF, x + s * PA_DEPTH, FD / 2 + PA_HALF);
    line(x + s * PA_DEPTH, FD / 2 + PA_HALF, x, FD / 2 + PA_HALF);
    // penalty spot + arc ("the D") outside the box
    const ps = P(x + s * PEN_SPOT, FD / 2);
    ctx.beginPath(); ctx.ellipse(ps[0], ps[1], 3, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    let first = true;
    for (let i = 0; i <= 30; i++) {
      const a = -0.93 + 1.86 * i / 30, ax = x + s * (PEN_SPOT + Math.cos(a) * 75), ad = FD / 2 + Math.sin(a) * 75;
      if (Math.abs(ax - x) < PA_DEPTH) continue;
      const q = P(ax, ad); first ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]); first = false;
    }
    ctx.stroke();
    line(x, FD / 2 - GA_HALF, x + s * GA_DEPTH, FD / 2 - GA_HALF);
    line(x + s * GA_DEPTH, FD / 2 - GA_HALF, x + s * GA_DEPTH, FD / 2 + GA_HALF);
    line(x + s * GA_DEPTH, FD / 2 + GA_HALF, x, FD / 2 + GA_HALF);
  }
}

function endPitch() { ctx.globalAlpha = 1; }
function drawGoal(side, front) {
  if (themeReady) { ctx.save(); ctx.globalAlpha = 0.38; drawGoalFrame(side, front); ctx.restore();
    const x = side ? FW : 0;
    drawCone(x, FD / 2 + (front ? GOAL_HALF : -GOAL_HALF));
    return; }
  drawGoalFrame(side, front);
}
function drawGoalFrame(side, front) {
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
  if (p.hidden) return;
  const [sx, sy] = P(p.x, p.d), s = scaleAt(p.d), z = p.z || 0;
  const shrink = 1 / (1 + z / 200);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(sx, sy, PR * s * shrink, PR * s * 0.45 * shrink, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(sx + (p.shake ? Math.sin(performance.now() / 35) * 1.6 * s : 0), sy - z * s);
  const dir = p.hx >= 0 ? 1 : -1;
  if (p.slide > 0) ctx.rotate(dir * 1.1);
  if (p.spin != null) ctx.scale(Math.abs(p.spin) < 0.12 ? 0.12 * Math.sign(p.spin || 1) : p.spin, 1);   // half turn in the air
  if (p.legs === 'kneel') ctx.translate(0, 11 * s);
  const swing = p.spd > 20 ? Math.sin(p.run) * Math.min(p.cool ? 3 : 8, p.spd / 30) : 0;
  const lean = (1 - p.stam) * 4 * dir;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 5 * s; ctx.lineCap = 'round';
  if (sprinting(p) && p.spd > 30) drawWheel(s, p.run * 3, dir);
  else if (p.legs === 'kneel' || p.legs === 'apart') drawSpecialLegs(p, s, dir);
  else {
    for (const [hx, fx] of [[-3, -3 + swing], [3, 3 - swing]]) {           // long white stockings
      ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 6.5 * s;
      ctx.beginPath(); ctx.moveTo(hx * s, -14 * s); ctx.lineTo(fx * s, -1 * s); ctx.stroke();
      ctx.strokeStyle = '#f7f7f2'; ctx.lineWidth = 4.3 * s;
      ctx.beginPath(); ctx.moveTo(hx * s, -14 * s); ctx.lineTo(fx * s, -1 * s); ctx.stroke();
      ctx.fillStyle = '#222';                                               // boots
      ctx.beginPath(); ctx.ellipse((fx + dir * 1.5) * s, -0.5 * s, 4.2 * s, 2.4 * s, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = p.col;
  ctx.beginPath(); ctx.roundRect((-9 + lean * 0.4) * s, -38 * s, 18 * s, 20 * s, 5 * s); ctx.fill();
  ctx.fillStyle = p.shorts || '#333'; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.2 * s;   // shorts
  ctx.beginPath(); ctx.roundRect((-9.5 + lean * 0.3) * s, -21 * s, 19 * s, 9 * s, 3 * s); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 5 * s;
  if (p.pose === 'cry') { drawHead(p, s, dir, lean); drawArms(p, s, dir, swing); }
  else { drawArms(p, s, dir, swing); drawHead(p, s, dir, lean); }
  if (p.sip) drawCan(p, s, dir);
  if (p.pose === 'point') {                                   // the pointing finger
    const sg = Math.sign((p === me ? cpu : me).x - p.x) || dir;
    ctx.strokeStyle = '#f2c79b'; ctx.lineWidth = 2.4 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sg * 38 * s, -40 * s); ctx.lineTo(sg * 45 * s, -41 * s); ctx.stroke();
  }
  ctx.restore();
  // stamina bar above the head
  const bw = 34 * s, by = sy - (HEAD_H * headK(p) + 40 + z) * s;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(sx - bw / 2 - 1, by - 1, bw + 2, 6 * s + 2);
  ctx.fillStyle = p.stam > 0.5 ? '#5ad65a' : p.stam > 0.25 ? '#ffd23f' : '#ff5a4f';
  ctx.fillRect(sx - bw / 2, by, bw * p.stam, 6 * s);
  if (p.dazzle > 0 || p.stun > 0) {
    ctx.font = `${18 * s}px system-ui`; ctx.textAlign = 'center';
    const t = performance.now() / 90;
    for (let i = 0; i < 3; i++) ctx.fillText(p.dazzle > 0 ? '⭐' : '💫', sx + Math.cos(t + i * 2.1) * 18 * s, by - 8 * s + Math.sin(t + i * 2.1) * 5 * s);
  }
  if (p.stam < 0.2 && p.stun <= 0 && p.dazzle <= 0) {
    ctx.font = `${14 * s}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText('💦', sx + 20 * s * dir, by + 14 * s);
  }
}

// Sunglasses: p.glasses goes 0 → 1 while they travel from the hand to the eyes.
function glassesPos(p, s, dir) {
  const lean = (1 - p.stam) * 4 * dir, bob = p.spd > 20 ? Math.abs(Math.sin(p.run)) * 1.5 : 0, bottom = (-32 - bob) * s;
  const skin = SKINS[p.ai ? 'cpu' : 'human'].neutral;
  const hk = headK(p);
  const eye = skin ? { x: lean * s, y: bottom - HEAD_H * s * hk * 0.47, w: HEAD_W * s * hk * 0.66 }
                   : { x: (lean + dir * 3) * s, y: bottom - 27 * s * hk, w: 40 * s * hk };
  const t = clamp(p.glasses || 0, 0, 1), e = t * t * (3 - 2 * t);
  const from = { x: dir * 34 * s, y: -30 * s, w: eye.w * 0.6 };              // starts at hip height in the hand
  return { x: from.x + (eye.x - from.x) * e, y: from.y + (eye.y - from.y) * e, w: from.w + (eye.w - from.w) * e };
}
function drawGlasses(p, s, dir) {
  if (p.glasses == null || !SUNGLASSES.complete || !SUNGLASSES.naturalWidth) return;
  const g = glassesPos(p, s, dir), h = g.w * SUNGLASSES.height / SUNGLASSES.width;
  ctx.drawImage(SUNGLASSES, g.x - g.w / 2, g.y - h / 2, g.w, h);
}
function drawHead(p, s, dir, lean) {
  const sk = SKINS[p.ai ? 'cpu' : 'human'], mood = moodOf(p), img = sk[mood] || sk.neutral || null;
  const bob = p.spd > 20 ? Math.abs(Math.sin(p.run)) * 1.5 : 0;
  const cx = lean * s, bottom = (-32 - bob) * s;              // neck sits on the shoulders
  if (img) {
    const w = HEAD_W * s * headK(p), h = HEAD_H * s * headK(p);
    ctx.drawImage(img, cx - w / 2, bottom - h, w, h);
    drawGlasses(p, s, dir);
    return;
  }
  // drawn cartoon head (CPU, or the human when no skin is present)
  const hk = headK(p); s *= hk;                                  // (scales the drawn cartoon head too)
  const r = 21 * s, cy = bottom - r - 4 * s, fx = cx + dir * 3 * s;
  ctx.fillStyle = '#f2c79b'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#4a2e1a';                                     // hair
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.fillStyle = '#222'; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
  const ey = cy - 2 * s, ex = 6.5 * s;
  for (const sgn of [-1, 1]) {
    const x = fx + sgn * ex;
    if (mood === 'dizzy') {
      ctx.beginPath(); ctx.arc(x, ey, 3.5 * s, 0, Math.PI * 1.6); ctx.stroke();
    } else if (mood === 'celebrate') {
      ctx.beginPath(); ctx.arc(x, ey + 1.5 * s, 3 * s, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    } else if (mood === 'cheeky' && sgn === 1) {
      ctx.beginPath(); ctx.moveTo(x - 3 * s, ey); ctx.lineTo(x + 3 * s, ey); ctx.stroke();
    } else {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, ey, (mood === 'shocked' ? 4.5 : 3.6) * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x + dir * 1.2 * s, ey, 1.8 * s, 0, Math.PI * 2); ctx.fill();
    }
    if (mood === 'determined' || mood === 'sad') {                // eyebrows
      const t = mood === 'determined' ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(x - 4 * s * sgn, ey - 6 * s - t * 1.5 * s); ctx.lineTo(x + 3 * s * sgn, ey - 5 * s + t * 1.5 * s); ctx.stroke();
    }
  }
  const my = cy + 9 * s;                                          // mouth
  ctx.beginPath();
  if (mood === 'celebrate') { ctx.fillStyle = '#7a1f1f'; ctx.arc(fx, my - 2 * s, 7 * s, 0, Math.PI); ctx.fill(); }
  else if (mood === 'sad' || mood === 'dizzy') { ctx.arc(fx, my + 4 * s, 5 * s, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
  else if (mood === 'shocked') { ctx.fillStyle = '#7a1f1f'; ctx.ellipse(fx, my, 3.5 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill(); }
  else if (mood === 'determined') { ctx.moveTo(fx - 5 * s, my); ctx.lineTo(fx + 5 * s, my); ctx.stroke(); }
  else if (mood === 'cheeky') { ctx.arc(fx, my - 2 * s, 5 * s, 0.2, Math.PI - 0.6); ctx.stroke(); }
  else { ctx.arc(fx, my - 3 * s, 5 * s, 0.4, Math.PI - 0.4); ctx.stroke(); }
  drawGlasses(p, s / hk, dir);
}

// Cartoon blur-loop legs while sprinting (classic "legs become a whirl" effect)
function drawWheel(s, rot, dir) {
  const cy = -8 * s;
  ctx.save(); ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {                                   // smeared leg loops
    const a = rot + i * 1.05;
    ctx.strokeStyle = i === 0 ? 'rgba(60,60,60,.5)' : `rgba(250,250,245,${0.75 - i * 0.1})`; ctx.lineWidth = (i === 0 ? 6 : 4.5 - i * 0.4) * s;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 3 * s, cy + Math.sin(a) * 2 * s, (10 + i) * s, (7 + i * 0.5) * s, -dir * 0.35, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(25,25,25,.6)'; ctx.lineWidth = 3.5 * s;  // boot smears
  for (const off of [0, Math.PI]) {
    const a = (rot % (Math.PI * 2)) + off;
    ctx.beginPath(); ctx.ellipse(0, cy + 2 * s, 12 * s, 8 * s, -dir * 0.35, a, a + 1.3); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(230,220,200,.45)';                          // dust puffs behind
  for (let i = 0; i < 3; i++) {
    const t = (rot * 0.5 + i / 3) % 1;
    ctx.beginPath(); ctx.arc(-dir * (18 + t * 26) * s, -(2 + t * 6) * s, (3 + t * 5) * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 5 * s;
}

// Arms explain what's happening: shielding, holding off, goalkeeping
function armMode(p) {
  if (ball.held === p) return 'hold';
  const o = p === me ? cpu : me, d = dist2(p, o);
  if (owner === p && d < PR * 2 + 18) {
    const facing = p.hx >= 0 ? 1 : -1;
    return (o.x - p.x) * facing >= 0 ? 'push' : 'spread';
  }
  if (inKeeperZone(p) && owner !== p && !ball.held && dist2(p, ball) < 320) return 'keeper';
  return 'swing';
}
function drawSpecialLegs(p, s, dir) {
  const legs = p.legs === 'kneel'
    ? [[[-3, -14], [-3 + dir * 4, -11]], [[3, -14], [3 + dir * 4, -11]]]           // thighs down to the knees (body is lowered)
    : [[[-3, -14], [-13, -1]], [[3, -14], [13, -1]]];                                   // legs apart at ~45°
  for (const [[ax, ay], [bx, by]] of legs) {
    const ex = p.legs === 'kneel' ? bx - dir * 13 : bx, ey = by;                         // shins lying behind when kneeling
    for (const [col, w] of [['#3a3a3a', 6.5], ['#f7f7f2', 4.3]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w * s;
      ctx.beginPath(); ctx.moveTo(ax * s, ay * s); ctx.lineTo(bx * s, by * s);
      if (p.legs === 'kneel') ctx.lineTo(ex * s, ey * s);
      ctx.stroke();
    }
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.ellipse((ex + (p.legs === 'kneel' ? -dir * 2 : 0)) * s, (ey - 0.5) * s, 4.2 * s, 2.4 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
}
const POSE_HANDS = {
  up: d => [[-27, -96], [27, -96]],            // long cartoon arms so they show beside the big head
  v: d => [[-44, -82], [44, -82]],
  plane: d => [[-52, -31], [52, -27]],           // wings stick out well past the big head
  punch: d => [[d * 26, -100], [-d * 9, -22]],
  siu: d => [[-19, -17], [19, -17]],
  cry: d => [[-9, -66], [9, -66]],                 // hands over the eyes (drawn over the head)
  sip: d => [[-d * 4, -20], [-d * 4, -20]],
};
function drawArms(p, s, dir, swing) {
  const mode = p.pose || armMode(p), o = p === me ? cpu : me;
  let hands;
  if (POSE_HANDS[mode]) hands = POSE_HANDS[mode](dir);
  else if (mode === 'glasses') { const g = glassesPos(p, s, dir); hands = [[g.x / s - dir * 8, g.y / s + 4], [-dir * 4, -20]]; }
  else if (mode === 'point') { const sg = Math.sign(o.x - p.x) || dir; hands = [[sg * 38, -40], [-sg * 6, -24]]; }
  else if (mode === 'fist') { const sg = Math.sign(o.x - p.x) || dir; hands = [[sg * 32, -30], [-sg * 4, -20]]; }
  else if (mode === 'hold') hands = [[dir * 12, -30], [dir * 12, -25]];
  else if (mode === 'push') { const sg = Math.sign(o.x - p.x) || dir; hands = [[sg * 21, -27], [-sg * 4, -20]]; }
  else if (mode === 'spread') hands = [[-21, -27], [21, -27]];
  else if (mode === 'keeper') hands = [[-33, -31], [33, -31]];
  else hands = [[swing * 0.8, -20], [-swing * 0.8, -20]];
  for (const [hx, hy] of hands) {
    ctx.strokeStyle = p.col; ctx.lineWidth = 5 * s;
    ctx.beginPath(); ctx.moveTo(0, -34 * s); ctx.lineTo(hx * s, hy * s); ctx.stroke();
    ctx.fillStyle = '#f2c79b';
    ctx.beginPath(); ctx.arc(hx * s, hy * s, 3.6 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#222';
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

// ---------- Controls (style: chunky cartoon buttons, German labels) ----------
const BTN = {
  kick:   { top: '#fff1a6', bot: '#ffc928', line: '#3d2c00', shadow: '#a77d00', icon: 'kick',    label: 'SCHUSS',   iw: 1.42, ih: 0.68 },
  tackle: { top: '#ffc79a', bot: '#ff7f2a', line: '#4a1d00', shadow: '#a8480a', icon: 'tackle',  label: 'GRÄTSCHE', iw: 0.98, ih: 0.9 },
  aim:    { top: '#fff1a6', bot: '#ffc928', line: '#3d2c00', shadow: '#a77d00', icon: 'nervous', label: 'ZIELEN…',  iw: 0.62, ih: 0.62 },
  skip:   { top: '#f2f7f9', bot: '#b9cbd2', line: '#2a3a40', shadow: '#6e848c', icon: 'skip',    label: 'WEITER',   iw: 0.6,  ih: 0.4 },
};
const iconReady = n => ICONS[n] && ICONS[n].complete && ICONS[n].naturalWidth;
function roundButton(x, y, r, top, bot, line, shadow, pressed) {
  const sink = pressed ? r * 0.05 : 0, drop = pressed ? r * 0.025 : r * 0.08;
  ctx.fillStyle = 'rgba(0,0,0,.25)';                                      // soft ground shadow
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.95, r * 0.85, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shadow;                                                  // solid "thickness" below the button
  ctx.beginPath(); ctx.arc(x, y + drop + sink, r, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.3 + sink, r * 0.1, x, y + sink, r);
  g.addColorStop(0, top); g.addColorStop(1, bot);
  ctx.fillStyle = g; ctx.strokeStyle = line; ctx.lineWidth = Math.max(3, r * 0.045);
  ctx.beginPath(); ctx.arc(x, y + sink, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  return sink;
}
function ring(x, y, r, frac, colour, width, track = true) {
  ctx.lineCap = 'round'; ctx.lineWidth = width;
  if (track) { ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
  if (frac > 0) { ctx.strokeStyle = colour; ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac)); ctx.stroke(); }
}
const nervesColour = f => f < 0.5 ? `rgb(${Math.round(111 + 144 * f * 2)},${Math.round(220 - 10 * f * 2)},79)` : `rgb(255,${Math.round(210 - 131 * (f - 0.5) * 2)},${Math.round(63 - 5 * (f - 0.5) * 2)})`;
function drawButton(b, st, pressed, nerves = 0) {
  if (nerves > 0) ring(b.x, b.y, b.r + 14, nerves, nervesColour(nerves), 12);
  const sink = roundButton(b.x, b.y, b.r, st.top, st.bot, st.line, st.shadow, pressed);
  const cy = b.y + sink;
  if (iconReady(st.icon)) {
    const w = b.r * st.iw, h = b.r * st.ih;
    ctx.drawImage(ICONS[st.icon], b.x - w / 2, cy - h * 0.62 - b.r * 0.06, w, h);
  }
  ctx.fillStyle = st.line; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(b.r * 0.27)}px ${UI_FONT}`;
  ctx.fillText(st.label, b.x, cy + b.r * 0.5);
}

function render() {
  drawStadium();
  if (!me) return;
  drawPitch(); endPitch();
  drawGoal(0, false); drawGoal(1, false);
  const items = [me, cpu, ball].sort((a, b) => a.d - b.d);
  for (const it of items) {
    if (it === ball) drawBall();
    else { if (!it.ai && !aim.active) drawArrow(it); drawPlayer(it); }
  }
  drawParticles();
  drawAim();
  if (themeReady) drawProps(true);
  drawPopups();
  drawGoal(0, true); drawGoal(1, true);

  if (aim.active) { ctx.fillStyle = 'rgba(10,20,70,.16)'; ctx.fillRect(0, 0, W, H); }
  // HUD
  drawScoreboard();
  if (phase !== 'menu') drawPauseButton();
  if (msg !== lastMsg) { lastMsg = msg; msgStart = performance.now(); }
  if (msg) {
    // pops up from the bottom edge with a little overshoot and stays low, so faces stay visible
    const t = Math.min(1, (performance.now() - msgStart) / 500), c1 = 1.7, c3 = c1 + 1;
    const e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);         // ease-out-back
    const y = H + 50 - (H * 0.16 + 50) * e;
    ctx.font = `800 60px ${UI_FONT}`; ctx.lineWidth = 9; ctx.strokeStyle = '#0d3b1a'; ctx.fillStyle = '#fff'; ctx.lineJoin = 'round';
    ctx.strokeText(msg, W / 2, y); ctx.fillText(msg, W / 2, y);
  }
  drawBubbles();                                  // after the HUD so the scoreboard never covers them
  if (phase === 'celebrate' && celeb && (celeb.stage === 'party' || celeb.stage === 'walk')) drawButton(btnK, BTN.skip, false);
  if (playing()) {
    const kick = canKickNow() || aim.active;
    const style = aim.active ? BTN.aim : kick ? BTN.kick : BTN.tackle;
    drawButton(btnK, style, aim.active || me.slide > 0, aim.active ? aimShakeFrac() : 0);
    drawSprintButton(); drawJoystick();
  }
  drawToasts(Math.min(0.05, (performance.now() - (drawToasts.last || performance.now())) / 1000)); drawToasts.last = performance.now();
  if (boardOpen) drawBoard();
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

function drawBubbles() {
  for (const p of [me, cpu]) {
    if (!p || !p.say) continue;
    const [sx, sy] = P(p.x, p.d), s = scaleAt(p.d);
    const fs = Math.max(18, 22 * s), y = Math.max(fs * 1.7 + 72, sy - ((p.z || 0) + HEAD_H * headK(p) + 62) * s);
    ctx.font = `900 ${fs}px system-ui`;
    const w = ctx.measureText(p.say.txt).width + fs * 1.1, h = fs * 1.7;
    const bx = clamp(sx - w / 2, 8, W - w - 8);
    ctx.globalAlpha = Math.min(1, p.say.t / 0.3);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(bx, y - h, w, h, h / 2);
    ctx.moveTo(clamp(sx - 8, bx + 12, bx + w - 24), y); ctx.lineTo(clamp(sx, bx + 20, bx + w - 16), y + 14); ctx.lineTo(clamp(sx + 10, bx + 28, bx + w - 8), y);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.say.txt, bx + w / 2, y - h / 2);
    ctx.globalAlpha = 1;
  }
}

function drawPopups() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const p of popups) {
    const [sx, sy] = P(p.x, p.d), s = scaleAt(p.d), rise = (1.3 - p.t) * 40;
    ctx.globalAlpha = Math.min(1, p.t / 0.4);
    ctx.font = `900 ${22 * s}px system-ui`; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeText(p.txt, sx, sy - (HEAD_H + 58) * s - rise); ctx.fillStyle = p.col; ctx.fillText(p.txt, sx, sy - (HEAD_H + 58) * s - rise);
  }
  ctx.globalAlpha = 1;
}

function drawFootball(x, y, r, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = r * 0.09;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const pent = i => { const a = -Math.PI / 2 + i * Math.PI * 2 / 5; return [Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38]; };
  ctx.fillStyle = '#111'; ctx.beginPath();
  for (let i = 0; i < 5; i++) { const [px, py] = pent(i); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.closePath(); ctx.fill();
  ctx.lineWidth = r * 0.07; ctx.beginPath();
  for (let i = 0; i < 5; i++) { const [px, py] = pent(i); ctx.moveTo(px, py); ctx.lineTo(px * 2.55, py * 2.55); }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = r * 0.11; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, r * 0.78, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
}
let joyRoll = 0;
function drawJoystick() {
  const on = ptr.move !== null, R = joy.r;
  ctx.save();
  ctx.globalAlpha = on ? 1 : 0.55;
  ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.strokeStyle = 'rgba(255,255,255,.88)'; ctx.lineWidth = 5;
  ctx.setLineDash([14, 8]); ctx.lineCap = 'round';                        // chalk circle
  ctx.beginPath(); ctx.arc(joy.x, joy.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();                                                         // direction ticks
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { ctx.moveTo(joy.x + dx * (R - 12), joy.y + dy * (R - 12)); ctx.lineTo(joy.x + dx * (R - 26), joy.y + dy * (R - 26)); }
  ctx.stroke();
  let kx = joy.x, ky = joy.y;
  if (on) {
    const dx = ptr.mx - joy.x, dy = ptr.my - joy.y, l = Math.hypot(dx, dy), m = Math.min(l, R * 0.55);   // ball stays inside the circle
    if (l > 0) { kx += dx / l * m; ky += dy / l * m; }
    const f = Math.max(0, Math.min(1, (l - 10) / (R - 10)));
    const g = ctx.createLinearGradient(joy.x - R, joy.y - R, joy.x + R, joy.y + R);
    g.addColorStop(0, '#7fe05a'); g.addColorStop(1, '#ff8c2a');
    ring(joy.x, joy.y, R - 14, f, g, 10);                                 // speed ring
    joyRoll += (dx * 0.0008);
  }
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(kx + 4, ky + R * 0.33, R * 0.3, R * 0.09, 0, 0, Math.PI * 2); ctx.fill();
  drawFootball(kx, ky, R * 0.36, joyRoll);                               // the knob is the ball
  ctx.restore();
}

function drawSprintButton() {
  const b = btnS, ready = sprint.cd <= 0 && !sprint.active;
  if (sprint.active) {
    ring(b.x, b.y, b.r + 11, sprint.t / SPRINT_TIME, '#fff', 8, false);
    const sink = roundButton(b.x, b.y, b.r, '#d9ffc4', '#7ee05a', '#1d3b14', '#2f6b1f', true);
    drawSprintFace(b, sink, 'bolt_on');
  } else if (ready) {
    const sink = roundButton(b.x, b.y, b.r, '#a7ef8a', '#5cbf3e', '#1d3b14', '#2f6b1f', false);
    drawSprintFace(b, sink, 'bolt');
  } else {                                                                 // cooldown: grey clock wipe refilling green
    roundButton(b.x, b.y, b.r, '#9a9a9a', '#7c7c7c', '#2e2e2e', '#4a4a4a', false);
    const f = 1 - sprint.cd / SPRINT_CD;
    ctx.fillStyle = '#5cbf3e';
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, b.r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6d6d6d'; ctx.strokeStyle = '#2e2e2e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(b.r * 0.6)}px ${UI_FONT}`;
    ctx.fillText(Math.ceil(sprint.cd), b.x, b.y + 2);
  }
}
function drawSprintFace(b, sink, icon) {
  if (iconReady(icon)) { const w = b.r * 0.72, h = w * 1.1; ctx.drawImage(ICONS[icon], b.x - w / 2, b.y + sink - h * 0.68, w, h); }
  ctx.fillStyle = '#1d3b14'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(b.r * 0.28)}px ${UI_FONT}`;
  ctx.fillText('SPRINT', b.x, b.y + sink + b.r * 0.55);
}

// ---------- Whiteboard scoreboard + pause ----------
function whiteboard(x, y, w, h, frame) {
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.roundRect(x + 2, y + 6, w, h, 10); ctx.fill();
  ctx.fillStyle = '#8f989f'; ctx.beginPath(); ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 12); ctx.fill();
  ctx.fillStyle = '#cfd5da'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#f1f4f6'); g.addColorStop(1, '#ffffff');
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x + frame, y + frame, w - 2 * frame, h - 2 * frame, 5); ctx.fill();
}
function doodleFace(x, y, r, uncle) {
  ctx.strokeStyle = '#1f4fd1'; ctx.fillStyle = '#1f4fd1'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  if (uncle) { ctx.moveTo(x - r * 0.85, y - r * 0.45); for (let i = 1; i <= 6; i++) ctx.lineTo(x - r * 0.85 + i * r * 0.28, y - r * (i % 2 ? 0.9 : 0.55)); }
  else ctx.arc(x, y + r * 0.2, r * 0.95, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(x + sx * r * 0.38, y, r * 0.13, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.arc(x, y + r * 0.25, r * 0.4, 0.3, Math.PI - 0.3); ctx.stroke();
}
function drawScoreboard() {
  const w = 410, h = 84, x = W / 2 - w / 2, y = 10;
  whiteboard(x, y, w, h, 7);
  ctx.fillStyle = '#b8c0c6'; ctx.beginPath(); ctx.roundRect(x + 157, y + h + 2, 96, 8, 3); ctx.fill();        // tray
  ctx.fillStyle = '#1f4fd1'; ctx.beginPath(); ctx.roundRect(x + 178, y + h + 3, 40, 6, 3); ctx.fill();         // marker
  ctx.fillStyle = '#1f4fd1'; ctx.textBaseline = 'middle';
  ctx.font = `24px ${MARKER_FONT}`;
  doodleFace(x + 34, y + h / 2, 15, false);
  ctx.textAlign = 'left'; ctx.fillText(NAMES.human, x + 56, y + h / 2 + 2);
  doodleFace(x + w - 34, y + h / 2, 15, true);
  ctx.textAlign = 'right'; ctx.fillText(NAMES.cpu, x + w - 56, y + h / 2 + 2);
  ctx.textAlign = 'center'; ctx.font = `38px ${MARKER_FONT}`;
  ctx.fillText(`${score[0]} : ${score[1]}`, W / 2, y + h / 2 + 3);
}
function drawPauseButton() {
  const { x, y, w } = btnP;
  whiteboard(x, y, w, w, 6);
  ctx.strokeStyle = '#1f4fd1'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.38, y + w * 0.3); ctx.quadraticCurveTo(x + w * 0.36, y + w / 2, x + w * 0.38, y + w * 0.7);
  ctx.moveTo(x + w * 0.62, y + w * 0.3); ctx.quadraticCurveTo(x + w * 0.64, y + w / 2, x + w * 0.62, y + w * 0.7);
  ctx.stroke();
}
function drawPauseScreen() {
  ctx.fillStyle = 'rgba(10,20,30,.55)'; ctx.fillRect(0, 0, W, H);
  const w = 420, h = 170, x = W / 2 - w / 2, y = H / 2 - h / 2;
  whiteboard(x, y, w, h, 9);
  ctx.fillStyle = '#1f4fd1'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `56px ${MARKER_FONT}`; ctx.fillText('PAUSE', W / 2, y + 68);
  ctx.font = `22px ${MARKER_FONT}`; ctx.fillText('Tippen zum Weiterspielen', W / 2, y + 122);
}

// ---------- Loop ----------
let last = performance.now(), fpsAcc = 16;
const SHOW_FPS = /[?&]fps/.test(location.search);
function frame(t) {
  const raw = t - last, dt = Math.min(1 / 30, raw / 1000); last = t;
  if (SHOW_FPS) { fpsAcc = fpsAcc * 0.95 + Math.max(1, raw) * 0.05; }
  if (!paused) update(dt * (aim.active ? SLOWMO : 1));
  for (let i = popups.length - 1; i >= 0; i--) if ((popups[i].t -= dt) <= 0) popups.splice(i, 1);
  render();
  if (SHOW_FPS) { ctx.font = '700 16px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(6, 8, 70, 24); ctx.fillStyle = '#fff'; ctx.fillText(`${Math.round(1000 / fpsAcc)} fps`, 12, 22); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
