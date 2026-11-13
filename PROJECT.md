# Kick-About – project documentation

*Last updated: 13 Nov 2026 (end of session 1, prototype v8)*

## 1. What this is
A birthday present for my nephew, who is turning 8: a lighthearted **1-on-1 football game**, modelled on the matches we play in real life when he visits. It's single-player (human vs. CPU), runs on a **tablet in landscape**, and is built as a **PWA** (installable, fullscreen, works offline). The human player wears **my face** as a big cartoon head with expressions; the CPU has a drawn cartoon head.

- **Repo:** `github.com/dmkb-7005/kickabout`, which is public. The repo is the source of truth for the code.
- **Live:** `https://dmkb-7005.github.io/kickabout/`
- **Deploy:** GitHub Pages → *Deploy from a branch* → `main` / root. If no deploy run starts, push any commit to trigger one.
- **Stack:** plain HTML5 Canvas + vanilla JS. No libraries and no build step. Files: `index.html`, `game.js` (~1000 lines), `sw.js`, `manifest.webmanifest`, `icons/`.

## 2. Key decisions so far
| Topic | Decision |
|---|---|
| Platform | PWA on GitHub Pages, aimed at a tablet in landscape |
| Personal assets | Never in the public repo. The plan is an **avatar pack (zip)** loaded on first launch: unzipped in the browser (fflate/JSZip), stored in IndexedDB, with `navigator.storage.persist()`. For quick tests, a `skin/` folder can be pushed temporarily, then removed. |
| View | 2.5D perspective side view (like *NHL Open Ice*): the camera sits high behind the near touchline and scrolls with the play |
| Controls | **Right hand:** a joystick circle (bottom-right); direction = finger relative to the centre, speed = distance from the centre. **Left hand:** one big **action button** (KICK with the ball / TACKLE without it) plus **SPRINT** above it. |
| Caching | `sw.js` is network-first with `fetch(e.request, { cache: 'no-cache' })`, falling back to the cache when offline. **Keep this.** Bump the `CACHE` name when shipping. |

## 3. Current gameplay (v8)
- **Match:** first to 5 goals. Possession at the first kick-off is random; after a goal, the side that conceded kicks off.
- **Kick-off:** the player without the ball stays outside the centre circle until the kicker starts moving. The CPU paces impatiently around the circle edge. A CPU kick-off starts slowly and ramps up over about 2.5 s.
- **Movement:** inertia (separate rates for speeding up and slowing/turning) and stamina. Stamina drains above walking pace and refills when walking or standing; a tired player is slower, accelerates and kicks weaker, and shows a 💦. Each player has a stamina bar above the head.
- **Sprint (human only):** holding SPRINT gives ×1.5 speed for up to 3 s, then a 10 s cooldown. The legs turn into a cartoon blur-loop (runner style) with dust puffs.
- **Kicking:**
  - Holding KICK slows the game to 0.25× speed. The joystick then steers a dashed aim line (direction + power = how far the joystick is pushed) while the player keeps drifting.
  - The aim line shakes more and more, maxing out after `AIM_SHAKE_TIME`; a ring around the button shows how shaky it is.
  - Letting go shoots. A hidden extra spread grows with distance to goal, so long shots are less reliable.
- **Possession:** only lost through a tackle or a kick. Running into the ball carrier does nothing; the carrier holds their ground.
- **Tackle:** a slide in the movement direction. It pokes the ball loose and knocks the opponent down if it connects. The ball carrier can't tackle.
- **Feints:** three quick joystick direction changes while holding the ball.
  - **Up-down-up** (or down-up-down) next to the CPU: it is dazzled for about 1 s (spinning stars), then immune for 2.5 s.
  - **Right-left-right** with the CPU in front: the ball is chipped over it, and the CPU is dazzled too.
- **Goalkeeper zone = penalty area:**
  - Slow shots are **caught**, medium-speed shots are **parried** 60% of the time, and hard shots go in.
  - A successful tackle inside your own box puts the ball in your hands.
  - The keeper can **carry the ball** within the box for `HOLD_T`, then drops it to the feet; KICK kicks it out of the hands.
- **Goal frame:** posts and crossbar are solid, so the ball rebounds ("Clang!").
- **Arms explain the mechanics:**
  - One arm out when holding off an opponent in front, both arms out when the opponent is behind (~70° from the body).
  - Arms level when defending in the box; arms forward when holding the ball.
  - Otherwise they swing while running.
- **Faces / moods:**
  - **neutral:** idle / running
  - **determined:** kick / aim / tackle / sprint
  - **celebrate:** scored
  - **sad:** conceded
  - **shocked:** the keeper caught your shot
  - **dizzy:** dazzled or knocked down
  - **cheeky:** a feint worked, or you won the ball
- **Skin:** the human player loads `skin/<mood>.png` (200×280, transparent; source set *avatars_285*, 400×560 originals). If the files are missing, a drawn cartoon face is used, which works fine.
- **CPU AI:**
  - Walks in carefully on defence and stays goal-side, sprinting only when beaten.
  - Swerves when blocked and mostly shoots from close range.
  - Chases loose balls only when it can win them.
- **Rubber-banding (hidden):** the CPU gets about ±7% per goal of difference (speed, tackle rate, shot accuracy, dazzle duration), capped at ±14%.
- **Board ads:** "HAPPY BIRTHDAY!" / "⚽ KICK-ABOUT".

## 4. Tuning constants (top of game.js) – **keep these values**
User-tuned (don't change without asking):
```
AIM_SHAKE_MAX = 0.95   AIM_SHAKE_TIME = 4
CATCH_SPEED = 680      PARRY_SPEED = 920
KEEP_REACH = 60        HOLD_T = 6.0
```
Other current values: `FW 1300, FD 400, GOAL_HALF 75, GOAL_H 95, PA_DEPTH 190, PA_HALF 160, GA_DEPTH 75, GA_HALF 100, HUMAN_TOP 280, AI_TOP 255, ACCEL 380, BRAKE 620, DRAIN 0.17, RECOVER 0.13, SPRINT 1.5×/3 s/10 s, SLOWMO 0.25, SHOT_SPREAD 0.03/0.22, FEINT_WINDOW 1.6, FEINT_CD 2, DAZZLE 1.0/2.5, MATCH_GOALS 5, VIEW_W 640, HEAD 52×73`.

## 5. Code map (game.js)
- **Setup:** constants → `resize()` / camera projection `P(x,d,z)` → state (`me`, `cpu`, `ball`, `owner`, `phase`: menu / ready / play / goal / over) → `setupKickoff()`.
- **Input:** pointer events (joystick, action button, sprint) → `startAim` / `releaseAim`, `recordFlick` / `tryFeint`.
- **Simulation:** `humanInput`, `aiThink`, `movePlayer` (inertia, stamina, slides), `dribble`, `keeperCheck` / `heldBall`, `ballPhysics` (3 substeps, `goalFrame` rebounds), `enforceKickoff`, `goal`, `updateCamera`.
- **Rendering:** stadium/boards → pitch → goals → depth-sorted players and ball → aim line, popups → HUD and controls. Player = shadow → legs/whirl → torso → `drawArms(armMode)` → `drawHead(mood)`.
- **Testing:** in the cloud workspace, run `python3 -m http.server` plus Playwright with `/usr/bin/google-chrome`, set up scenarios via `page.evaluate`, and take screenshots.

## 6. Next session – planned work
1. **Graphics:** colour palette, nicer on-screen controls, captions/typography, a game menu, pause/unpause.
2. **Sounds:** kick, tackle, whistle, crowd, cheers/boos, post "clang", UI sounds (mute toggle).
3. **Juice and inside jokes:**
   - Juice: slow-mo and screen shake on goals, net bulge, commentator lines, celebrations (a funny one for the CPU/uncle).
   - Inside jokes: board ads and commentary only the two of us understand.
4. **Leaderboard / rewards:** trophy cabinet in localStorage (wins, streaks, goals), challenges and stickers (long-shot goal, feint goal, keeper catch, …).

## 7. Later / parking lot
- Avatar-pack import screen (zip → IndexedDB) to replace the temporary `skin/` folder.
- Penalty shoot-out mode with its own camera angle and a different touch-coordination challenge.
- Difficulty levels; CPU personalities; timed halves / golden goal; keepy-uppy mini-game.
- Possible adjustment if the feint flicks prove too hard for an 8-year-old: loosen `FEINT_WINDOW` or the flick threshold.
