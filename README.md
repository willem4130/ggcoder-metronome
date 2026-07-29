# GGCoder Metronome

A drummer's metronome for the web — Tama Rhythm Watch features and then some.

## Features

- **Tempo** 30–260 BPM with slider, ±1 buttons, and tap tempo
- **Beat lamps** — click any beat to cycle accent / normal / mute (1–9 beats per bar)
- **Subdivision mixer** — independent volume faders for quarter, eighth, sixteenth, and triplet layers
- **Voices** — click, woodblock, beep (synthesized, no samples)
- **Gap trainer** — play N bars, mute M bars; keep time through the silence
- **Speed trainer** — auto-ramp BPM toward a target every N bars
- **Presets** — save and recall grooves (localStorage)
- **Keyboard** — `Space` start/stop, `↑↓` ±1 BPM, `←→` ±5 BPM, `T` tap

Timing uses the Web Audio lookahead-scheduler pattern: clicks are scheduled
~100 ms ahead on the sample-accurate audio clock, so tempo stays rock solid.

## Develop

```sh
npm install
npm run dev     # dev server
npm test        # unit tests (vitest)
npm run build   # typecheck + production build
```
