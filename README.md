# GGCoder Metronome

A local-first drummer practice console with a sample-ahead Web Audio metronome, setlists, trainers, and live percussive timing analysis.

## Features

- **Tempo:** 30–260 BPM with slider, step buttons, tap tempo, and beat-by-beat accents
- **Subdivision mixer:** independent quarter, eighth, sixteenth, and triplet levels
- **Voices:** synthesized click, woodblock, and beep sounds with no sample downloads
- **Trainers:** configurable silent gaps and automatic BPM ramps
- **Setlists:** ordered song references with current/next transport and previous/next controls
- **Song library:** duplicate titles, explicit loaded-song updates, and reuse across setlists
- **Timing Lab:** microphone onset detection, played BPM/confidence, millisecond error, jitter, bias, timing distribution, trace, score, and duration
- **Calibration:** guided 10-click speaker-loopback measurement plus editable/resettable device offset
- **Session history:** newest 100 normalized sessions, comparable score trends, deletion, and CSV export
- **Backup:** validated version 2 JSON with library, setlists, settings, UI state, analysis preferences, and history; version 1 restore remains supported
- **Responsive transport:** compact BPM, Start/Stop, and song controls remain available below 960 px
- **Keyboard:** `Space` starts/stops, `↑`/`↓` changes 1 BPM, and `←`/`→` changes 5 BPM. Optional single-key shortcuts use `T` for tap and `N`/`P` for song navigation.

## Timing Lab contract

### Supported input

Timing Lab is optimized for repeated percussive attacks from drums, pads, claps, and similar sources captured by a close microphone or built-in microphone. Select the pulse you intend to play: quarter, eighth, or sixteenth notes.

It does not promise arbitrary full-band music analysis, sustained-instrument timing, polyphonic transcription, or groove-note classification. Ambient sound, cymbal wash, device processing, microphone distance, and speaker bleed can create missed or extra detections.

Microphone analysis requires a secure context (`https://` or `localhost`), `getUserMedia`, Web Audio, and `AudioWorklet`. The app requests mono capture with echo cancellation, noise suppression, and automatic gain disabled. Browsers and devices may ignore those requests, so the live panel reports the actual track settings.

### Mode semantics

- **Metronome sync:** each accepted hit is matched to the closest selected-subdivision target on the same `AudioContext` clock as playback. Targets continue through muted gap-trainer bars. Signed deviation is labeled **early**, **on time**, or **late**. Use headphones: audible metronome bleed can look like a perfect hit.
- **Free play:** tempo locks after at least eight confident hits, then interval consistency is measured against a slowly adapting baseline. Signed deviation is labeled **shorter**, **steady**, or **longer**. Free play never claims early/late phase because there is no external timing reference.

Played BPM uses confidence-weighted clustering over the latest 32 accepted onsets and short multi-hit spans. This resists an isolated missed or duplicate onset and applies hysteresis before accepting a half/double-tempo change. A steady selected pulse is still required.

Scores and calibration recommendations are withheld until there are at least eight analyzed hits. `Collecting` is shown instead of fabricated precision when evidence is insufficient.

### Score formula

Raw milliseconds are the primary result. The score is a compact normalized summary:

```text
RMS error = sqrt(mean(each signed deviation²))
Score = round(clamp(100 × (1 − RMS error / (selected pulse duration × 20%)), 0, 100))
```

For a 500 ms quarter-note pulse, 0 ms RMS scores 100, 10 ms scores 90, and 100 ms or more scores 0. A score is not a studio-grade claim; microphone detection and device latency remain part of the measurement.

## Device calibration

1. Stop metronome playback and end any analysis session.
2. Open **Calibrate device** in a quiet room.
3. Use speakers for calibration only, keep the microphone in its normal practice position, and do not play.
4. Start the 10-click measurement.
5. The first two clicks are warm-up. At least 7 of the remaining 8 must match, and median absolute spread must be at most 12 ms.

The measured median speaker-to-microphone round-trip offset is applied before target matching. Before a successful measurement, browser `outputLatency`, `baseLatency`, and reported input latency seed an estimate. A measured calibration stores its date, input-device identifier, quality, and stale state. Device changes mark it stale. Manual edits are treated as estimates; performance lateness is never offered as automatic calibration because that would hide real timing bias.

Use headphones again after calibration for scored metronome practice.

## Privacy, history, and exports

Microphone samples are processed in memory on the device. Raw audio, sample blocks, and onset timestamps are not stored or uploaded.

Only normalized session metrics are saved in `localStorage`: date, mode, active song/setlist labels, target and played BPM, confidence, score, mean error, jitter, bias, hit count, duration, and selected pulse. The newest 100 records are retained. CSV export contains those same normalized fields.

There is no account, cloud synchronization, billing, or remote backup. Export a JSON backup before clearing browser data or moving browsers. Restore validates the entire payload before writing and rolls back all six storage keys if replacement fails. Restoring a valid version 1 backup migrates Timing Lab data to safe defaults.

## Library and local data

**Save new song** always creates a new library entry and adds it to the active setlist. **Update loaded song** changes the selected library entry everywhere it is referenced. Removing a song row removes only that setlist reference; **Remove unused songs** deletes only library entries referenced by no setlist.

## Audio timing limitation

The metronome uses a Web Audio lookahead scheduler and places clicks about 100 ms ahead on the audio clock. When a hidden tab is throttled and becomes visible, it discards stale visual events and re-anchors ahead of current audio time instead of firing a catch-up burst. Timing Lab references remain tied to newly scheduled audio-clock targets.

This does **not** guarantee uninterrupted playback while a tab is hidden. Keep the app visible when continuous timing is critical.

## Detector implementation and licensing

The live detector is dependency-free TypeScript plus native `BiquadFilterNode`s and `AudioWorklet`. Low, mid, and high filtered energy feeds an allocation-free adaptive positive-flux detector with a silence floor, adaptive noise statistics, local-maximum lookahead, and a 35 ms minimum onset interval. The worklet posts sparse onset events and level updates at no more than 20 Hz; it never sends raw sample blocks to the UI thread.

Research influences:

- [GoogleChromeLabs/web-audio-samples](https://github.com/GoogleChromeLabs/web-audio-samples), Apache-2.0: AudioWorklet render-boundary and preallocated processing patterns
- [MTG/essentia.js](https://github.com/MTG/essentia.js), AGPL-3.0: architectural reference for `getUserMedia` → source → worklet; no code or dependency included
- [aubio/aubio](https://github.com/aubio/aubio), GPL-3.0, and [qiuxiang/aubiojs](https://github.com/qiuxiang/aubiojs): conceptual threshold, silence-floor, minimum-interval, and delay controls; no code or dependency included
- [meyda/meyda](https://github.com/meyda/meyda), MIT: feature-extraction reference; not used because its documented live analyzer relies on deprecated `ScriptProcessorNode`
- [chrisguttandin/web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector), MIT: tempo-candidate clustering reference; not used because its public API analyzes completed buffers
- [cwilso/volume-meter](https://github.com/cwilso/volume-meter), MIT: sparse state/UI rendering principle

No GPL or AGPL implementation is copied or bundled.

## Develop and verify

```sh
npm install
npm run dev
npm test
npm run build
npm run verify:browser
npx vitest run src/onset-detector.benchmark.test.ts
```

- Unit tests cover detector fixtures, timing/session semantics, calibration quality, engine leases/subscriptions, persistence, migrations, backup validation, and rollback.
- The synthetic detector benchmark uses only programmatically generated signals. Current result: 100% recall and 0% extras over 80 clean supported synthetic hits, zero silence/stable-noise detections, bounded changing-noise behavior, and processing below one render quantum in the local Node harness.
- Browser verification starts its own Vite server on port 5199. It mocks media/audio devices and covers six responsive widths, 200% text, RTL, forced colors, reduced motion, focus containment/return, permission retry, disconnect/crash recovery, live/save/reset/delete/CSV history, calibration success/failure, and unchanged setlist/library flows. Screenshots are written under `.gg/screenshots/layout/`.

## Release evidence still required

Synthetic and mocked-browser checks do not establish real microphone accuracy or studio-grade scoring. Before making release claims, test built-in and USB microphones with acoustic drums/pads and speaker bleed in current Chromium, Firefox, and Safari. Record onset recall, false positives per minute, calibrated bias, p95 transient timestamp error, worklet CPU time, and failures.

Target gates are p95 calibrated detector timestamp error ≤15 ms on supported percussive fixtures, no false perfect score in the speaker-bleed test, and worklet processing below one render quantum on target hardware. If those gates are not met, label Timing Lab **beta** and do not market its score as studio-grade.

Representative screen-reader output, real-device/browser testing, and field Core Web Vitals remain unverified. Do not claim WCAG conformance, ADA compliance, or hardware reliability from the automated checks alone.
