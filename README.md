# GGCoder Metronome

A drummer's metronome for the web with Tama Rhythm Watch-style controls and local setlist management.

## Features

- **Tempo:** 30 to 260 BPM with slider, step buttons, tap tempo, and beat-by-beat accents
- **Subdivision mixer:** independent quarter, eighth, sixteenth, and triplet levels
- **Voices:** synthesized click, woodblock, and beep sounds with no sample downloads
- **Trainers:** configurable silent gaps and automatic BPM ramps
- **Setlists:** ordered song references with current/next transport and previous/next controls
- **Song library:** save duplicate titles as separate songs, update only the explicitly loaded song, and reuse saved songs across setlists
- **Backup:** export or validate and restore the complete library, setlists, metronome settings, and interface preferences
- **Responsive transport:** compact BPM, Start/Stop, and song controls remain available below 960px
- **Keyboard:** `Space` starts/stops, `↑`/`↓` changes 1 BPM, and `←`/`→` changes 5 BPM. Optional single-key shortcuts use `T` for tap and `N`/`P` for song navigation.

## Library and local data

**Save new song** always creates a new library entry and adds it to the active setlist. **Update loaded song** changes the selected library entry everywhere it is referenced. Removing a song row removes only that setlist reference; **Remove unused songs** deletes only library entries referenced by no setlist.

All application data stays in this browser's `localStorage`. There is no account, cloud synchronization, or remote backup. Export a JSON backup before clearing browser data or moving to another browser.

Restoring a backup validates the complete file first, asks before replacing current local data, and rolls back storage writes if replacement fails.

## Timing limitation

Audio uses a Web Audio lookahead scheduler and places clicks about 100 ms ahead on the audio clock. When a hidden tab is throttled and later becomes visible, the scheduler discards stale visual events and re-anchors ahead of the current audio time instead of firing a catch-up burst.

This does **not** guarantee uninterrupted playback while the tab is hidden. Keep the metronome visible when continuous timing is critical.

## Develop and verify

```sh
npm install
npm run dev              # Vite development server
npm test                 # unit tests
npm run build            # TypeScript check and production build
npm run verify:browser   # self-contained Playwright responsive/workflow assertions
```

The browser verification starts and stops its own Vite server on port 5199 and writes representative screenshots under `.gg/screenshots/layout/`.

Automated checks cover Chromium layout and keyboard behavior. Screen-reader output, forced-colors rendering, and full WCAG conformance have not been verified with assistive technologies.