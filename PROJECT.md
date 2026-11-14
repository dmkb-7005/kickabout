# Kick-About – project documentation

*Last updated: 14 Nov 2026 (end of session 2, v19)*

## 1. What this is
A birthday present for my nephew Mark, who is turning 8: a lighthearted **1-on-1 football game** set in **our real backyard**, modelled on the matches we play when he visits. It's single-player: **Mark (human) vs. Onkel (CPU = me)**. It runs on a **tablet in landscape** as a **PWA** (installable, fullscreen, offline). The game is in **German** (we speak German together).

- **Repo:** `github.com/dmkb-7005/kickabout`, which is public. The repo is the source of truth for the code.
- **Live:** `https://dmkb-7005.github.io/kickabout/`
- **Deploy:** GitHub Pages → *Deploy from a branch* → `main` / root. If no deploy run starts, push any commit to trigger one.
- **Stack:** plain HTML5 Canvas + vanilla JS, no build step.
- **Files:**
  - `index.html`: start screen
  - `game.js`: about 2000 lines
  - `sw.js`, `manifest.webmanifest`, `icons/`
  - `img/`: control icons (SVG) and sunglasses
  - `theme/backyard/`: backdrop, wall, gravel tiles, props
  - `lib/fflate.min.js`: unzip library, MIT licence
- **Private, never in the repo:** `kickabout-skins.zip`, the face skin pack, is loaded on the tablet via the start screen.

## 2. Key decisions
| Topic | Decision |
|---|---|
| Personal assets | Faces only come from the private **skin pack ZIP**. It is loaded on the start screen ("📦 Skin-Paket laden"), unzipped in the browser (fflate), stored in **IndexedDB** (`kickabout-skins`) with `navigator.storage.persist()`, and auto-loaded on every start. Without a pack: drawn cartoon faces and names "Du" vs "Onkel". |
| Skin pack format | Folders `onkel/` and `mark/` (also accepted: uncle/cpu and nephew/neffe/spieler/player/human), files named `<mood>.png` for the 7 moods, plus an optional `pack.json` `{"human":"Mark","cpu":"Onkel"}`. Size subfolders like `400x560/` are fine; 400×560 is preferred. Current pack: v2 skins (uncle v2, nephew v2.1), **necks cut off** along the chin, with a fixed vertical offset per character (Onkel 48 px, Mark 80 px) so heads don't jump between moods. |
| Backyard theme | Generic cartoon art (no real houses or text), so it's OK in the public repo. If `theme/backyard/` is missing, the game falls back to a green stadium. |
| View | 2.5D perspective side view (like *NHL Open Ice*). The camera sits high behind the near touchline and scrolls. The ground is a top-down texture drawn in perspective strips, **batched per texture piece** (this fixed a 10 fps lag mid-pitch; now up to 120 fps). |
| Controls | **Right:** joystick (chalk circle; the football is the knob; speed ring). **Left:** one big action button (SCHUSS with the ball / GRÄTSCHE without / ZIELEN… while aiming / WEITER during celebrations) plus SPRINT. **Top:** whiteboard scoreboard and pause. |
| Caching | `sw.js` is network-first with `fetch(e.request, { cache: 'no-cache' })`, falling back to the cache. **Keep this.** Bump the `CACHE` name when shipping (currently `kickabout-v19`). |
| Fonts | Baloo 2 (UI) and Permanent Marker (whiteboard), from Google Fonts. The first start needs internet. |

## 3. Gameplay (v19)
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
  - **basic.**
- **Afterwards:** both walk to the centre line, stopping one arm length on each side, and **fist-bump**. The ball drops from the sky while the non-kicker steps back to the usual distance, then kick-off.
- **Captions** pop up from the bottom, so faces stay visible.
- **For testing:** `?celeb=<name>` forces one celebration.

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
4. **Jubel-Sammler** (x/5 of Mark's celebrations)
5. **Zu Null gewonnen** (counter)
6. **Ausgetrickst!** (goal within 6 s of a dazzle feint, CPU not touching the ball in between)
7. **Lupfer-König** (the same after a chip)
8. **Hattrick** (3 goals in a row in one match)
9. **Super-Torwart** (10 catches or parries)
10. **Grätschen-Profi** (10 tackles that win the ball)
11. **Secret: Scherben bringen Glück** (the car window)

### Screens
- **Start screen:** HTML whiteboard explaining the controls with icons, a skin-pack section (face previews, status, "entfernen"), **📦 Skin-Paket laden**, **Los geht's!**, and the credit "entwickelt von DKO@SPC". It reappears after each match (after the Erfolge board).
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
- **Match flow:** `goal` → `startCelebration` / `partyMove` / `updateCelebration` (party → walk → bump → drop) → `updateCamera` → `update`.
- **Rendering:**
  - Backyard theme (baked ground pieces, backdrop parallax, wall, props, car damage, cones and ghost goal) → pitch lines → players (legs, kit, arms/poses, head/skin, glasses, can) → ball → particles → aim line → foreground props → popups.
  - Then the HUD: whiteboard scoreboard, pause, captions, bubbles, controls, toasts, board.
- **Testing:** in the cloud workspace, run `python3 -m http.server` plus Playwright with `/usr/bin/google-chrome`; set up scenarios via `page.evaluate`, take screenshots. A file chooser can load the skin ZIP.

## 6. Asset sources
- **Backyard:** stitched overcast panorama (7 photos, OpenCV), redrawn by Claude Design: backdrop 4096×900, wall 4096×220, gravel tiles v2 (toon style), props (palm, bush, tree, house corner, car).
- **Sunglasses:** prop by Claude Design.
- **Controls mockup:** a Design canvas "Kick-About – in-game controls mockup".
- **Skins:** avatar sets by Claude Design (uncle v2, nephew v2.1); necks cut in the workspace with a Python script along the chin outline.

## 7. Next ideas / parking lot
- **Sounds:** real samples for kick, whistle, crowd and cheering, plus a mute toggle (only simple beeps so far).
- **Juice:** screen shake or slow-mo on goals, net bulge, commentary lines; **angry reactions** (planned next after the celebrations).
- **More inside jokes:** commentary lines, shouts for Onkel's other celebrations.
- **Penalty shoot-out mode** with its own camera angle and touch challenge.
- **Settings:** difficulty levels, left-handed control swap, control size, a mute toggle, and timed halves or golden goal.
- **Evening match theme** from the sunset photos.
- If the feints prove too hard for an 8-year-old: loosen `FEINT_WINDOW` or the flick threshold.
