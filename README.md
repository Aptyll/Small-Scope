# Emberfrost

A cozy winter survival game. Gather by day, build your camp, keep the fire
burning — frost imps prowl the dark, and so does the cold.

## Run

```
node serve.js
```

Then open http://localhost:8471 (any static file server works; there is no
build step and there are no dependencies).

## How to play

- **WASD / arrows** — move
- **Click** — chop trees, mine rocks, pick berries, fight imps (slot 1),
  or place the selected building (slots 2–5)
- **1–5 / mouse wheel** — select axe, wall, spikes, torch, campfire
- **Q** — eat a berry (+20 hp)
- **M** — mute, **P** — pause

Survive the night: darkness brings frost imps and creeping cold. Firelight
keeps the cold away and slowly heals you. Walls hold imps back, spikes hurt
them, and every night is a little harder than the last. If you fall, you wake
by your campfire, minus a share of your supplies.

## Code layout

- `js/sprites.js` — every sprite as a hand-editable character grid, baked to
  canvases at load
- `js/font.js` — 3×5 bitmap pixel font
- `js/audio.js` — WebAudio synth sound effects + wind ambience
- `js/game.js` — world gen, day/night cycle, combat, building, lighting, UI
