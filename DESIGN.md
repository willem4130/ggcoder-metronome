# GGCoder Metronome design system

## Design read

- **Surface:** low-light performance console with a primary tempo deck and timing-analysis workspace.
- **Audience:** drummers practicing with a laptop, tablet, or phone using pointer, touch, keyboard, and microphone input.
- **Primary jobs:** establish a reliable pulse, measure repeated percussive timing honestly, and move through an active set without losing transport context.
- **Risk:** transport actions are frequent and time-sensitive; microphone permissions and calibration must be recoverable; destructive history/library actions require explicit confirmation; scores must disappear when evidence is insufficient.
- **Content:** dominant BPM, beat state, selected pulse, signed millisecond metrics, timing trace/distribution, ordered songs with long titles, and a compact tools rack.
- **Platform:** responsive web UI from 320 CSS px through wide desktop, with a safe-area mobile transport below 960 px.
- **Constraints:** preserve the shared Web Audio clock, local-only workflows, native dialogs, semantic forms, orange accent, and existing metronome/library/setlist behavior.

## Evidence and decisions

The application-UI archetype leads: stable placement, concise hierarchy, keyboard-aware density, and visible system state support repeated practice better than marketing-page composition. The low-light theme belongs because rehearsal and practice commonly occur in dim rooms and the product was already dark-first. It is not evidence that dark styling is inherently premium.

Audio architecture was informed by public work from GoogleChromeLabs/web-audio-samples (Apache-2.0), essentia.js (AGPL-3.0), aubio/aubio (GPL-3.0), aubiojs, Meyda (MIT), web-audio-beat-detector (MIT), and cwilso/volume-meter (MIT). Only general architecture and algorithm concepts were adopted. No GPL/AGPL code or dependency is included; full rationale is in `README.md`.

## Design thesis

Build a **drummer’s timing console**, not vintage-hardware simulation and not a generic analytics dashboard.

1. First glance: current BPM, Start/Stop, and live analysis state.
2. Second glance: score availability, played tempo confidence, signed current deviation, raw mean error, and jitter.
3. Third glance: selected pulse, input/calibration trust, history, setlist, and secondary tools.

The rhythm-specific signature is the four-bar beat mark, sequencer beat strip, centered deviation rail, and tabular timing numerals. These remain identifiable without the logo or accent color.

## Semantic tokens

- **Canvas:** `#090c11`; low-light surround.
- **Work surface:** `#121720`; persistent panel containment.
- **Raised surface:** `#171e29`; interactive rows and metric cells.
- **Sunken surface:** `#0b0f15`; BPM, transport, mode, trace, and analysis wells.
- **Text:** `#f4f7fb`; primary information.
- **Muted text:** `#98a4b6`; metadata and helper copy.
- **Accent:** `#ffb52e`; primary transport, active beat, timing center, progress, and live-state marker.
- **Focus:** `#ffd27a`; immediate 2 px `:focus-visible` outline.
- **Danger:** neutral surface with `#ff9c9c` text at rest; solid dark red only on deliberate hover.
- **Geometry:** 18 px panels, 10 px controls, 7–8 px compact data wells; full pills only for short status/count roles.
- **Motion:** 100 ms feedback and 170 ms continuity using named properties. Calibration progress is linear and finite. No hover lift, ambient animation, or `transition: all`.

## Workspace hierarchy

### Tempo deck

The tempo deck remains column 1 and the first task in DOM order. BPM uses large tabular numerals, valid range stays visible, Start/Stop retains a 56 px target, and each beat button exposes accent state by text, border, fill, and accessible name rather than color alone.

### Timing Lab

Timing Lab is a primary workspace, not a settings card. Its anatomy is:

1. heading and explicit state marker;
2. mode contract and session actions;
3. pulse/sensitivity/offset controls plus actual input settings;
4. score/grade, played BPM confidence, signed deviation, mean error, jitter, bias, hit count, and timer;
5. centered trace and three-part distribution with mode-correct language;
6. sparse state announcement, privacy/limitations/scoring help, then recent normalized sessions.

The metric cells belong because every value has a source, unit, and practice consequence. Score is visually prominent but never replaces raw milliseconds. Missing evidence renders `--` and `Collecting`, not a fabricated zero or perfect score.

### Setlist and tools

Songs remain structured rows in one workspace rather than isolated cards. Mixer, sound, and trainer sections share the existing disclosure anatomy and stay secondary to tempo and analysis.

### Dialogs

Library and calibration use native modal `<dialog>`. Both preserve heading, instructions/status, Escape behavior, focus containment, and focus return. Calibration deliberately focuses **Begin 10-click measurement**, transition-locks duplicate submission, exposes progress, and retains actionable failure copy for retry.

### Mobile transport

Below 960 px, a fixed safe-area dock keeps previous, next, Start/Stop, BPM, current song, and next song available. Workspace bottom reservation prevents obscured controls.

## Timing component contracts

### Analysis state

- **Semantic element:** text status with a non-color dot marker.
- **Names:** Mic off, Requesting permission, Warming up, Live, Calibrating, Complete, Unsupported, Permission denied, Mic disconnected, Processing error.
- **Announcement:** state and periodic summary only. Fast level, trace, timer, and per-hit metrics remain outside live regions.
- **Recovery:** denied/disconnected/processing errors retain Start analysis as retry when supported; unsupported disables it; metronome playback is not stopped by microphone failure.

### Pulse and sensitivity

- Native selects preserve keyboard/platform behavior and trailing indicator clearance.
- Pulse is an explicit quarter/eighth/sixteenth contract.
- Sensitivity help states the real tradeoff: higher values catch quieter hits but may add false detections. It is not framed as quality.

### Score and metrics

- Score is null until eight analyzed hits.
- Formula: `round(clamp(100 × (1 − RMS error / (pulse duration × 20%)), 0, 100))`.
- Metronome signed labels: early/on time/late and timing bias.
- Free-play signed labels: shorter/steady/longer and interval bias.
- Played BPM always includes confidence; raw milliseconds remain primary.

### Trace and distribution

- Trace center is the selected target/baseline; recent deviations clamp visually at ±100 ms without changing numeric metrics.
- The graphic is `aria-hidden`; adjacent text metrics and counts are its accessible alternative.
- Position and labels communicate sign; color is not required.

### History

- Native ordered list, newest first, maximum 100 records.
- Each row contains date, mode/pulse, score or Collecting, raw mean/jitter, comparable-session trend, and an explicit Delete button.
- Deletion names the consequence through browser confirmation.
- CSV and JSON backup contain normalized metrics only, never raw audio/onsets.

### Calibration

- Requires stopped playback and no live session.
- Exactly 10 scheduled clicks; first 2 are warm-up.
- Success requires at least 7 of 8 usable matches and median absolute spread ≤12 ms.
- Successful metadata includes offset, ISO date, device ID, measured quality, and stale state.
- Device change marks measured calibration stale. Manual offset becomes estimated. Average performance lateness is never used as calibration.

## State matrix

| State | Primary action | Metrics | Message/recovery |
|---|---|---|---|
| Idle | Start analysis | Empty/previous reset | Explains selected-pulse practice |
| Requesting permission | Disabled | Preserved empty geometry | Browser permission is pending |
| Warming up | Disabled briefly | No score | Detector baseline is settling |
| Live | End and save | Sparse per-hit updates | Mode-correct summary every 15 seconds |
| Calibration | Dialog cancel | Analysis metrics unchanged | Quiet room, speakers, do not play |
| Complete | Start analysis / Reset | Final metrics retained | Saved locally when hits exist |
| Unsupported | Disabled | Empty | Requires HTTPS/localhost, media capture, AudioWorklet |
| Denied | Retry | Empty | Allow permission in browser settings |
| Disconnected | Retry | Last metrics retained | Reconnect input device |
| Processing error | Retry | Last metrics retained | End/retry; metronome remains independent |

## Responsive placement

- **320–759 px:** DOM/visual order tempo → Timing Lab → setlist → tools. Analysis metrics recompose to a two-column grid, score spans both columns, actions remain 44 px minimum, and the fixed transport remains reserved.
- **760–1199 px:** tempo and setlist form row 1; Timing Lab spans row 2; tools span row 3. A media-query listener moves Timing Lab after the setlist in the DOM at this range so keyboard, screen-reader, and visual order agree.
- **1200 px and wider:** tempo stays column 1 across the workspace; Timing Lab spans columns 2–3 in row 1; setlist and tools occupy columns 2 and 3 below. Timing results align to content height instead of creating a decorative empty chart well.
- **Direction/zoom:** layout uses logical insets where placement matters; browser verification checks 320 px reflow, RTL, and 200% text without horizontal overflow or clipped controls.

## Anti-default decisions

- No glass cards, purple glow, bento grid, icon medallions, ambient motion, generic hover lift, or tint-on-tint semantic status surfaces.
- Dark theme belongs to the low-light practice environment and established product direction.
- Status/count pills belong because variable short labels benefit from compact enclosure; buttons and fields remain conventional controls.
- Live metric blocks belong because they are auditable session outputs with units and a direct practice decision.
- Mono utility labels/numerals belong because timing values, pulse divisions, and device states benefit from stable tabular scanning.
- The only progress animation is the finite, user-started calibration measurement; reduced motion reduces it to effectively immediate state change.

## Changed-scope production checks

| Area | Status | Evidence |
|---|---|---|
| Native semantics, names, labels | Browser/source verified | Native buttons, fields, meters, details, lists, headings, statuses, and dialogs; visible control labels match accessible names. |
| Reading/focus order | Browser verified | DOM relocation keeps mobile, tablet, and desktop visual/focus order aligned. Calibration/library focus containment and return pass. |
| Keyboard workflow | Browser verified | Primary analysis start/end/reset, dialog operation, existing setlist/library flows, and visible focus are keyboard reachable. |
| Fast-update announcements | Source verified | Fast metrics are not live; only state/message summaries use status/live regions. |
| Text/control contrast | Inherited measured tokens | Primary text 16.72:1, muted text 7.12:1, accent text 10.52:1, meaningful control boundaries ≥3.2:1 against adjacent surfaces. |
| 320 px reflow/long content | Browser verified | 320, 390, 768, 1024, 1280, and 1536 px views pass overlap/overflow assertions with long fixture content. |
| 200% text | Browser verified | 390 px at 200% root text has no page overflow or clipped interactive control. |
| RTL | Browser verified | 390 px RTL has no horizontal overflow. |
| Reduced motion | Browser verified | Emulation activates and all transitions reduce to 0.01 ms. |
| Forced colors | Browser verified at component level | Focus outline and meaningful panel/trace/status boundaries remain visible. |
| Empty/pending/success/error/retry/destructive | Browser verified | Idle, requesting, warming, live, complete, unsupported, denied, disconnected, processing error, calibration success/failure, confirm-delete, and disabled states are asserted. |
| Permission/privacy trust | Source/browser verified | Permission precedes capture; actual settings are reported; local-only/no-raw-audio copy is persistent. |
| Existing workflows | Browser/unit verified | Transport, song create/update/reference removal, library reuse, invalid restore, and shortcuts remain covered. |
| Screen-reader output | **Unverified** | Requires representative assistive-technology testing; no WCAG/ADA conformance claim is made. |
| Firefox/Safari and physical devices | **Unverified** | Mocked Chromium is automated; release hardware/browser matrix remains required. |
| Core Web Vitals | **Unverified in field** | Production bundle is measured during build; no field population exists. |

## Rendered critique

Representative desktop, mobile, collapsed-pillar, live-analysis, and calibration-state screenshots are generated under `.gg/screenshots/layout/`.

### First rendered pass

- Brief specificity 2; hierarchy 2; composition 1; consistency 2; typography 2; material logic 2; state completeness 2; responsive behavior 2; accessibility 1; motion 2; authenticity 2; distinctiveness 2.
- **Score: 22/24.** Accessibility evidence lacked representative screen-reader output. Composition lost one point because the stretched results well created a large bordered empty region below the trace.
- Unnecessary decoration removed: results stretching was removed instead of inventing a decorative chart to fill the space.

### Final rendered pass

- **Score: 23/24.** Composition improved to 2 after timing results aligned to their actual content height. Accessibility remains 1 because screen-reader/device evidence is honestly unverified.
- Desktop scan path is BPM → live score/BPM/deviation → input trust/history → setlist/tools.
- Mobile retains tempo → Timing Lab → setlist → tools and reserves the transport dock.
- Covering the logo and accent still leaves a drummer-specific BPM deck, beat sequencer, pulse selector, signed timing trace, gap-trainer language, and setlist workflow.

Automated evidence does not establish WCAG conformance, ADA compliance, physical-device accuracy, or studio-grade scoring.
