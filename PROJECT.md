# Kick-About – project documentation

*Last updated: 23 Nov 2026 (v27: fully offline – backyard theme precached, fonts self-hosted; session 3: conceding reactions, Mark's coolHat celebration, penalty shoot-out)*

## 1. What this is
A birthday present for my nephew Mark, who is turning 8: a lighthearted **1-on-1 football game** set in **our real backyard**, modelled on the matches we play when he visits. It's single-player: **Mark (human) vs. Onkel (CPU = me)**. It runs on a **tablet in landscape** as a **PWA** (installable, fullscreen, offline). The game is in **German** (we speak German together).

- **Repo:** `github.com/dmkb-7005/kickabout`, which is public. The repo is the source of truth for the code.
- **Live:** `https://dmkb-7005.github.io/kickabout/`
- **Deploy:** GitHub Pages → *Deploy from a branch* → `main` / root. If no deploy run starts, push any commit to trigger one.
- **Stack:** plain HTML5 Canvas + vanilla JS, no build step.
- **Files:**
  - `index.html`: start screen
  - `game.js`: about 2200 lines
  - `shootout.js`: the penalty shoot-out mode (front view), about 550 lines; shares game.js globals
  - `sw.js`, `manifest.webmanifest`, `icons/`
  - `img/`: control icons (SVG) and sunglasses
  - `theme/backyard/`: backdrop, wall, gravel tiles, props
  - `lib/fflate.min.js`: unzip library, MIT licence
  - `fonts/`: self-hosted Baloo 2 (600/800, OFL) and Permanent Marker (Apache 2.0) from @fontsource, `fonts.css`, licence files
- **Private, never in the repo:** `kickabout-skins.zip`, the face skin pack, is loaded on the tablet via the start screen.

## 2. Key decisions
| Topic | Decision |
|---|---|
| Personal assets | Faces only come from the private **skin pack ZIP**. It is loaded on the start screen ("📦 Skin-Paket laden"), unzipped in the browser (fflate), stored in **IndexedDB** (`kickabout-skins`) with `navigator.storage.persist()`, and auto-loaded on every start. Without a pack: drawn cartoon faces and names "Du" vs "Onkel". |
| Skin pack format | Folders `onkel/` and `mark/` (also accepted: uncle/cpu and nephew/neffe/spieler/player/human), files named `<mood>.png` for the 7 moods, plus an optional `pack.json` `{"human":"Mark","cpu":"Onkel"}`. Size subfolders like `400x560/` are fine; 400×560 is preferred. **Props (optional, v21):** put them next to the faces, e.g. `mark/sunglasses.png` and `mark/hat.png`; any name containing `sunglasses`/`brille` or `hat`/`hut` works (e.g. `prop_kid_hat.png`), and a name containing `kid`/`mark` also works outside the folders. Placement is computed from the face's transparent outline, hair top → chin (the chin is the last row wider than 42 % of the face, so it works with and without a neck). `PROP_FIT` (v22, tuned on Mark v2.1): sunglasses w 0.78 / centre y 0.6 of the face height; hat w 1.35 with its brim just above the top edge of the sunglasses (`gap` −0.005, user: "the brim should almost touch the upper edge of the sunglasses"). Fine-tune in `pack.json`: `{"props": {"human": {"hat": {"w": 1.3, "gap": 0.01}, "sunglasses": {"w": 0.8, "y": 0.58}}}}` (a hat `y` pins the brim to a fixed share of the face height instead). Onkel keeps the public `img/sunglasses.png` at its tuned spot unless the pack gives him his own. Current pack: v2 skins (uncle v2, nephew v2.1), **necks cut off** along the chin, with a fixed vertical offset per character (Onkel 48 px, Mark 80 px) so heads don't jump between moods. |
| Backyard theme | Generic cartoon art (no real houses or text), so it's OK in the public repo. If `theme/backyard/` is missing, the game falls back to a green stadium. |
| View | 2.5D perspective side view (like *NHL Open Ice*). The camera sits high behind the near touchline and scrolls. The ground is a top-down texture drawn in perspective strips, **batched per texture piece** (this fixed a 10 fps lag mid-pitch; now up to 120 fps). |
| Controls | **Right:** joystick (chalk circle; the football is the knob; speed ring). **Left:** one big action button (SCHUSS with the ball / GRÄTSCHE without / ZIELEN… while aiming / WEITER during celebrations) plus SPRINT. **Top:** whiteboard scoreboard and pause. |
| Caching | `sw.js` is network-first with `fetch(e.request, { cache: 'no-cache' })`, falling back to the cache. **Keep this.** Bump the `CACHE` name when shipping (currently `kickabout-v27`). **Everything the game needs must be in `ASSETS` (precached)** – each bump deletes the old cache, so anything only cached on the fly is gone after an update. Until v26 the `theme/backyard/` files weren't precached: after an update opened offline, the tablet fell back to the green stadium with the birthday banners (bug seen 23 Nov 2026). Error responses (`!res.ok`) are never cached. |
| Theme loading | `loadTheme()` retries with growing pauses (up to 8 tries) and again on the `online` event; the backyard replaces the stadium as soon as it loads. |
| Fonts | Baloo 2 (UI) and Permanent Marker (whiteboard), **self-hosted in `fonts/` since v27** (Latin subset, covers ä ö ü ß) and precached. Before, they came from Google Fonts and fell back to system fonts offline. |
| Offline | Since v27 the game makes **no external requests**: after one start with internet, everything (code, theme, fonts, icons) is in the service-worker cache; skins live in IndexedDB, achievements in localStorage. Tested: offline restart → backyard + fonts + match work. |

## 3. Gameplay (v27)
- **Match:** first to 5 goals. Random first possession; after a goal, the side that conceded kicks off.
- **Kick-off:** the non-kicker stays outside the centre circle until the kicker moves. Onkel paces impatiently around the circle. A CPU kick-off starts slowly.
- **Movement:** inertia, stamina (bar above the head, 💦 when tired). Sprint (human only): ×1.5 for 3 s, then a 10 s cooldown; the legs become a cartoon whirl.
- **Kicking:** hold the button to aim in 0.25× slow motion. The joystick steers the aim line (direction + power). The line shakes more and more (the nerves ring, max after `AIM_SHAKE_TIME`); release to shoot. Long shots get extra random spread.
- **Possession:** lost only through a tackle or a kick; the ball carrier holds their ground with an arm.
- **Tackle:** a slide; it knocks the opponent down. A successful tackle in your **own penalty area** puts the ball in your hands.
- **Feints** (3 quick joystick direction changes with the ball):
  - **up-down-up:** the opponent is dazzled for about 1 s (then immune for 2.5 s).
  - **right-left-right:** chip over the opponent, who is dazzled too.
- **Goalkeeper zone = penalty area:**
  - Slow shots are caught, medium ones parried 60% of the time.
  - The keeper can **carry the ball** inside the box for `HOLD_T`, and kick it out of the hands.
- **Posts and crossbar** rebound the ball ("Pfosten!").
- **Rubber-banding:** the CPU gets ±7% per goal of difference, capped at ±14%.
- **Arms explain the mechanics:** holding off, spread, keeper, swinging, and the celebration poses.
- **Faces / moods:** neutral, determined, celebrate, sad, shocked (the keeper caught your shot), dizzy, cheeky. **Mark's head is 80% of Onkel's** (`HEAD_SCALE`).
- **Kits:** long white stockings and boots. Mark: red shirt, dark green shorts. Onkel: blue shirt, beige shorts.

### Celebrations (random per goal; WEITER skips)
- **Onkel:**
  - **armsUp:** "Jaaaaa!"
  - **shades:** puts on sunglasses and strolls to the centre looking cool; keeps them on until kick-off.
  - **jumpPunch:** a short run and a jump with an arm swing.
  - **vArms:** arms in a V.
  - **basic.**
- **Mark:**
  - **toorRun:** "TOOOOR!" and running around wildly.
  - **ronaldo:** a jump with a half turn in the air, landing in the pose.
  - **kneeSlide.**
  - **runHouse:** "Ma! Maaaaa! Tor! Tooor!", running behind the house.
  - **coolHat** (v21): like Onkel's *shades* – puts on his own sunglasses, then lifts his hat onto his head, strolls to the centre looking cool and keeps both on until kick-off. Props come from the skin pack; without them he uses Onkel's sunglasses and no hat. The stamina bar floats above the hat.
  - **basic.**
- **Afterwards:** both walk to the centre line, stopping one arm length on each side, and **fist-bump**. The ball drops from the sky while the non-kicker steps back to the usual distance, then kick-off.
- **Captions** pop up from the bottom, so faces stay visible.
- **For testing:** `?celeb=<name>` forces one celebration.

### Conceding reactions (v20; the side that conceded, during the scorer's celebration)
- **Usually** the plain reaction: stands still with a sad face.
- **Long-shot goal** (shot from ≥ `LONG_GOAL_M` = 6 m): always **surprised** (shocked face, small startled hop).
- **Otherwise** a custom reaction with `REACT_CHANCE` = 30% (about 15% each), more often than the car easter egg:
  - **Onkel – mann:** "Mann!!!", angry face (`determined`), fists pressed down, one stamp with dust.
  - **Onkel – mist:** "Mist!", sad face, hands on the head.
  - **Mark – zaehltNicht:** "Zählt nicht! Zählt nicht!" / "Zählt nicht!!!", sad face, running around chaotically with flailing arms.
  - **Mark – warAus:** "War aus! War aus!" / "Der Ball war aus!", angry face (`determined`), fists down, stamping his feet (alternating, dust + thud).
- The party stage lasts at least `REACT_MIN[react]` so a reaction isn't cut off by a short celebration; then the usual walk and fist bump. Not used for the car crash scene.
- **For testing:** `?react=mann|mist|zaehltNicht|warAus|surprised` (only applies if it fits the conceding side; `surprised` fits both).

### Penalty shoot-out ("Elfmeterschießen", v23)
- **Unlock:** achievement **Elfmeterschießen** after `PEN_UNLOCK_WINS` = 5 wins in total (older saves with ≥ 5 wins are unlocked silently). The start-screen button shows "🔒 Elfmeterschießen (x/5 Siege)" until then; tapping it while locked shows a hint on the button. Testing: `?penalty` unlocks without saving.
- **Flow:** side view with "Elfmeterschießen!" (Mark at the spot, Onkel in goal) → **pseudo-3D camera turn** (inside-cube rotation by 90°: both views are rendered off-screen and drawn in 6-px column strips with perspective, ~1.25 s) → **front view of the right goal**. 5 kicks each, then sudden death; it ends early when one side can't catch up. Mark kicks first; roles **swap after every kick** (short fade). End: winner caption, tap (or 4.5 s) → start screen.
- **Front view:** own projection `Q(x, d, z)` (camera 200 behind the penalty spot, height 55; `soF = 1.71·H`, horizon `0.41·H`); ground = the baked gravel texture turned 90° once (`soBuildGround`) and drawn in strips; end wall + backdrop behind the goal, the long wall receding on the left, tree prop; chalk lines; goal with net and cones. The keeper is drawn with `drawPlayer` via a screen override (`p.scr`), scaled `SO_KEEPER_K` = 0.75 so the goal looks big enough; dives rotate the body (`p.rot`). Only the keeper is visible.
- **Mark kicks:** the arrow goes straight out of the ball (dashed) to an aim ring on the goal plane. Joystick = direction (sticky when released; full deflection can go wide/over). **Hold SCHUSS to charge** (full after `SO_CHARGE_T` = 1.5 s; ring around the button, black/white tick at 1/3), release to shoot. The harder, the jumpier the aim (`SO_SHAKE` = 30 at full power). **Below 1/3 power the keeper always catches it.** Onkel shows his planned dive with a blue arrow + ring (5 zones: left/right low/high, middle) that changes every 0.45–1.15 s until the kick; at the kick he dives there (reach ±44 sideways / ±46 height). Strong shots (> 0.82) in reach are parried 50 %.
- **Mark keeps:** the left buttons are hidden; the joystick sets direction and length of the dive (red arrow + ring); the CPU's dashed kick arrow wanders (every 0.7–1.4 s) while its power ring around the ball fills; it shoots after 2.4–4.6 s with power 0.5–1.0. Mark dives automatically at the kick (reach ±52 / ±54).
- **Net (v24):** made of opaque white tiles (back 12×6, sides 3×6, roof 12×2; gaps = mesh). On a goal the ball stops at the back net, the tiles flash **green (Mark scores) or red (Onkel scores)** spreading out from the impact point (`NET_FLASH` 0.22 s), then **shatter like glass** (`NET_SHATTER` 0.3 s: shards fly outwards and up, spin and fade, glass noise) and the ball drops through. The net is rebuilt for the next kick.
- **Results:** TOOOR!, Gehalten!, Zu schwach – gefangen!, Abgewehrt!, Daneben!/Drüber!, Pfosten!/Latte!; keeper moods and bubbles ("Mist!", "Mann!!!", "Hab ihn!", "Gehalten!"). Scoreboard: names, a circle per kick (green = goal, red ✗ = no goal, red ring = next kick), totals.

### Onkel specials
- **Soda break:** sometimes, with the ball in Mark's half, Onkel stops and drinks from a can ("*schlürf*", "Ahhh!") for about 3.4 s, so Mark can steal the ball. There's also a 25% chance at an Onkel kick-off, which lifts the kick-off rule.
  - **Settings:** `SIP_RATE`, `SIP_CD` = 20 s, `SIP_DUR`.
  - **For testing:** `?sip`.
- **Car easter egg:** sometimes an Onkel long shot ("Weitschuss!") smashes his own car's rear window.
  - **The scene:** KLIRR!, shards, hazard lights and an alarm. Onkel cries "NEEEIN!", runs to the car, kneels and cries ("Mein Auto!!") with flying tears, while Mark points and laughs ("Hahaha!"). Then the fist bump and Mark's kick-off.
  - The window stays broken for the rest of the match. This unlocks the secret achievement.
  - **Settings:** `LONG_TRY_RATE`, `CRASH_CHANCE`.
  - **For testing:** `?crash`.

### Achievements ("Erfolge") – stored in localStorage (`kickabout.achievements.v1`)
Shown on the whiteboard board when paused and after each match. Locked ones are greyed out, the secret one shows "???". Unlocks appear as a toast card with a jingle. There's a reset button with a confirmation.
1. **Erster Sieg**
2. **5 Siege in Folge** (streak x/5)
3. **Weitestes Tor** (distance in metres; pitch ≈ 14 m, `M_PER_UNIT`; new-record toasts)
4. **Jubel-Sammler** (x/6 of Mark's celebrations, `HUMAN_MOVES.length`)
5. **Zu Null gewonnen** (counter)
6. **Ausgetrickst!** (goal within 6 s of a dazzle feint, CPU not touching the ball in between)
7. **Lupfer-König** (the same after a chip)
8. **Hattrick** (3 goals in a row in one match)
9. **Super-Torwart** (10 catches or parries)
10. **Grätschen-Profi** (10 tackles that win the ball)
11. **Elfmeterschießen** (5 wins in total, x/5 – unlocks the shoot-out)
12. **Secret: Scherben bringen Glück** (the car window)

### Screens
- **Start screen:** HTML whiteboard explaining the controls with icons, a skin-pack section (face previews, status, "entfernen"), **📦 Skin-Paket laden**, **🥅 Elfmeterschießen** (locked until 5 wins), **Los geht's!**, and the credit "entwickelt von DKO@SPC". It reappears after each match (after the Erfolge board).
- **Pause:** whiteboard button at the top right; opens the Erfolge board; tap to continue.

## 4. Tuning constants – **keep these values**
**User-tuned** (don't change without asking):
```
AIM_SHAKE_MAX = 0.95   AIM_SHAKE_TIME = 4
CATCH_SPEED = 680      PARRY_SPEED = 920
KEEP_REACH = 60        HOLD_T = 6.0
```
**Other current values:**
- **Pitch:** FW 1300, FD 400, GOAL_HALF 75, GOAL_H 95
- **Boxes:** PA 190×160, GA 75×100
- **Movement:** HUMAN_TOP 280, AI_TOP 255, ACCEL 380, BRAKE 620, DRAIN 0.17, RECOVER 0.13
- **Sprint:** 1.5×/3 s/10 s
- **Shooting:** SLOWMO 0.25, SHOT_SPREAD 0.03/0.22
- **Feints:** FEINT_WINDOW 1.6, FEINT_CD 2, DAZZLE 1.0/2.5
- **Display:** VIEW_W 640, HEAD 52×73, HEAD_SCALE human 0.8
- **Backyard texture:** TILE_WORLD 170, GPU 2.8
- **Testing:** `?fps` shows the frame counter

## 5. Code map (game.js)
- **Setup and state:** constants → skins (IndexedDB pack) → achievements (ACHS, unlock, board, toasts) → input (joystick, action button, sprint, pause, board taps) → start-screen wiring → aiming and feints.
- **Onkel specials:** soda break, wild shot, car hit, particles.
- **Simulation:** AI (`aiThink`), actions (`doKick`, `doTackle`), `movePlayer`, `dribble`, `ballPhysics` (wild and out-of-pitch modes, `goalFrame`).
- **Match flow:** `goal` (long-shot check) → `startCelebration` (`pickReaction`) / `partyMove` + `reactMove` / `updateCelebration` (party → walk → bump → drop) → `updateCamera` → `update`.
- **Rendering:**
  - Backyard theme (baked ground pieces, backdrop parallax, wall, props, car damage, cones and ghost goal) → pitch lines → players (legs incl. stomp, kit, arms/poses incl. `fistsDown` and hands-on-head, head/skin via `faceGeom`, glasses, hat, can) → ball → particles → aim line → foreground props → popups.
  - Then the HUD: whiteboard scoreboard, pause, captions, bubbles, controls, toasts, board.
- **Shoot-out (`shootout.js`):** `soStart` → `soUpdate` (stages intro → turn → ready → aim → flight → result → swap … end) / `soRender` (`soCubeTurn`, `soWorld`, `soHud`). Hooks in game.js: `SO` state object, `frame()` dispatch, pointer routing, `let ctx` (off-screen rendering), `hudOff`, `p.scr`/`p.rot` in `drawPlayer`.
- **Loop safety (v25):** `frame()` requests the next frame first, so a single error can't freeze the game; after `soUpdate` the shoot-out may have ended in the same frame, so `frame()` re-checks `SO.active` before rendering (this was the "stuck after the shoot-out" bug).
- **Testing:** in the cloud workspace, run `python3 -m http.server` plus Playwright with `/usr/bin/google-chrome`; set up scenarios via `page.evaluate`, take screenshots. A file chooser can load the skin ZIP.

## 6. Asset sources
- **Backyard:** stitched overcast panorama (7 photos, OpenCV), redrawn by Claude Design: backdrop 4096×900, wall 4096×220, gravel tiles v2 (toon style), props (palm, bush, tree, house corner, car).
- **Sunglasses:** prop by Claude Design.
- **Controls mockup:** a Design canvas "Kick-About – in-game controls mockup".
- **Skins:** avatar sets by Claude Design (uncle v2, nephew v2.1); necks cut in the workspace with a Python script along the chin outline.

## 7. Next ideas / parking lot
- **Sounds:** real samples for kick, whistle, crowd and cheering, plus a mute toggle (only simple beeps so far).
- **Juice:** screen shake or slow-mo on goals, net bulge, commentary lines as captions.
- **More inside jokes:** commentary lines, shouts for Onkel's other celebrations.
- **Settings:** difficulty levels, left-handed control swap, control size, a mute toggle, and timed halves or golden goal.
- **Evening match theme** from the sunset photos.
- If the feints prove too hard for an 8-year-old: loosen `FEINT_WINDOW` or the flick threshold.

### Shelved: spoken live commentary (tested 18 Nov 2026)
- **Tried:** Piper TTS offline voices (`de_DE-thorsten-high`, `de_DE-thorsten_emotional-medium` with its mood speakers, `de_DE-pavoque-low`). Voice files are in a local `kickabout-voice` folder on my PC (Hugging Face is not reachable from the cloud workspace; staging >100 MB files works one file per call).
- **Built:** 15 single sample lines, then a simulated ~30 s attack chained from short clips with an excitement level 0–3 (speed/pitch/volume via rubberband), a stretched "Tooor!" shout, and a "live mic" chain (bandpass 300–4000 Hz, compressor, tanh soft clip, short booth echo, wind and hiss, kick thuds).
- **Verdict:** every version sounds like someone reading a book aloud, not live commentary. Piper voices are trained on calm read speech; the chaining/mic tricks don't fix that. Shelved.
- **If revisited:** an expressive voice service (e.g. ElevenLabs-style excited/shouting delivery), generated by the user from a script, or real recordings by Onkel/friends. The event-driven commentary engine idea (play-by-play + filler, priorities/interrupts, excitement level, no repeats) still applies to any voice source.
