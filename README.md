# Kick-About – PWA prototype

1-on-1 side-view football for tablets. Plain HTML5 Canvas, no build step, no dependencies.

## Controls

* **Right hand:** hold a finger on the pitch. The avatar runs towards it, and the further away the finger, the faster it runs. The yellow arrow shows the direction and speed.
* **Left hand:** **KICK** (tap = pass, hold up to \~0.7 s = hard, lofted shot) and **TACKLE** (slide; it stuns the opponent if it connects).
* First to 5 goals wins.

## Deploy to GitHub Pages

1. Create a public repo and upload all files (keep the `icons/` folder).
2. Go to Settings → Pages → Deploy from branch → `main` / root.
3. Open `https://<user>.github.io/<repo>/` on the tablet → browser menu → **Install app** / **Add to Home Screen**.

## Test locally

`python3 -m http.server 8000`, then open `http://localhost:8000`. Service workers need HTTPS or localhost.

## Tuning knobs (top of game.js)

`HUMAN\_MAX`, `AI\_MAX` (difficulty), `FULL\_SPEED\_DIST` (finger distance for top speed), `MATCH\_GOALS`.



A POC project

