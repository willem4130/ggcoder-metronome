import "./style.css";
import { MetronomeEngine } from "./engine";
import {
  MicrophoneAnalyzer,
  microphoneErrorMessage,
  type MicrophoneInputStatus,
} from "./microphone-analyzer";
import { TimingAnalysisSession, type AnalysisSnapshot } from "./performance-analysis";
import {
  CALIBRATION_CLICK_COUNT,
  CALIBRATION_CLICK_INTERVAL_SECONDS,
  CalibrationController,
  markCalibrationForDevice,
} from "./calibration";
import {
  createBackupPayload,
  defaultAccents,
  deleteAnalysisSession,
  loadAnalysisHistory,
  loadAnalysisPreferences,
  loadLastSettings,
  loadLibrary,
  loadSetlists,
  loadUiState,
  parseBackupPayload,
  resolveSongReferences,
  restoreBackupPayload,
  saveAnalysisPreferences,
  saveAnalysisSession,
  saveLastSettings,
  saveLibrary,
  saveSetlists,
  saveUiState,
  type AnalysisMode,
  type AnalysisSensitivity,
  type AnalysisSessionRecord,
  type AnalysisSubdivision,
  type BeatAccent,
  type LibrarySong,
  type Setlist,
  type Settings,
  type UiState,
  type Voice,
} from "./state";
import { clampBpm, MAX_BPM, MIN_BPM, TapTempo, type Layer } from "./timing";

const settings: Settings = loadLastSettings();
let setlists: Setlist[] = loadSetlists();
const library: LibrarySong[] = loadLibrary();
const ui: UiState = loadUiState();
const engine = new MetronomeEngine(() => settings);
const tapTempo = new TapTempo();
let analysisPreferences = loadAnalysisPreferences();
const analysisSession = new TimingAnalysisSession("free", analysisPreferences);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <div class="shell header-inner">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <div>
          <h1>GGCoder Metronome</h1>
          <p>Practice console</p>
        </div>
      </div>
      <div class="workspace-status" aria-label="Workspace storage status">
        <span class="workspace-status-dot" aria-hidden="true"></span>
        <span><strong>Local workspace</strong><small>Auto-saved in this browser</small></span>
      </div>
    </div>
  </header>
  <main class="shell workspace" id="main-shell">
    <div class="pillar pillar-metronome">
    <section class="panel tempo" aria-labelledby="tempo-heading">
      <div class="tempo-heading">
        <div>
          <p class="section-kicker">Performance engine</p>
          <h2 id="tempo-heading">Tempo</h2>
        </div>
        <span class="engine-state" id="engine-state" aria-live="polite">Ready</span>
      </div>
      <p class="bpm-readout" id="bpm-readout" aria-live="off">
        <span id="bpm-value">${settings.bpm}</span>
        <span class="bpm-unit"><span class="bpm-label" id="bpm-label">BPM</span><small>${MIN_BPM}-${MAX_BPM}</small></span>
      </p>
      <div class="tempo-row">
        <button type="button" id="bpm-down" aria-label="Decrease tempo">&minus;</button>
        <input type="range" id="bpm-slider" min="${MIN_BPM}" max="${MAX_BPM}"
          value="${settings.bpm}" aria-label="Tempo in beats per minute" />
        <button type="button" id="bpm-up" aria-label="Increase tempo">+</button>
        <button type="button" id="tap">Tap</button>
      </div>
      <div class="lamps" id="lamps" role="group" aria-label="Beat accents. Click a beat to cycle accent, normal, mute."></div>
      <div class="tempo-row">
        <div class="field">
          <label for="beats">Beats per bar</label>
          <input type="number" id="beats" min="1" max="9" value="${settings.beatsPerBar}" />
        </div>
      </div>
      <button type="button" class="btn-primary" id="startstop" aria-pressed="false">Start</button>
      <div class="face-transport" id="face-transport" hidden>
        <button type="button" id="song-prev" aria-label="Previous song">&larr;</button>
        <div class="face-transport-info">
          <p class="face-transport-now" id="transport-now"></p>
          <p class="face-transport-next" id="transport-next"></p>
        </div>
        <button type="button" id="song-next" aria-label="Next song">&rarr;</button>
      </div>
      <p class="visually-hidden" role="status" id="sr-status"></p>
    </section>
    </div>

    <section class="panel analysis-panel" id="analysis-panel" aria-labelledby="analysis-heading">
      <div class="analysis-heading">
        <div>
          <p class="section-kicker">Timing lab</p>
          <h2 id="analysis-heading">Performance analysis</h2>
        </div>
        <span class="analysis-state" id="analysis-state" data-state="idle">Mic off</span>
      </div>
      <div class="analysis-layout">
        <div class="analysis-setup">
          <p class="analysis-intro">Measure pulse, timing spread, and early or late bias from live playing.</p>
          <div class="analysis-mode-row">
            <span class="analysis-mode-label">Analysis mode</span>
            <strong id="analysis-mode">Free play</strong>
            <small id="analysis-mode-help">Tempo is inferred from a steady repeated pulse.</small>
          </div>
          <div class="analysis-actions">
            <button type="button" class="btn-primary" id="analysis-toggle">Start analysis</button>
            <button type="button" id="analysis-reset">Reset</button>
            <button type="button" id="analysis-export" disabled>Export CSV</button>
          </div>
          <div class="analysis-preferences">
            <div class="field">
              <label for="analysis-grid">Played pulse</label>
              <select id="analysis-grid">
                <option value="1">Quarter notes</option>
                <option value="2">Eighth notes</option>
                <option value="4">Sixteenth notes</option>
              </select>
            </div>
            <div class="field">
              <label for="analysis-sensitivity">Input sensitivity</label>
              <select id="analysis-sensitivity" aria-describedby="analysis-sensitivity-help">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <small id="analysis-sensitivity-help">Higher catches quieter hits but may add false detections.</small>
            </div>
            <div class="field offset-field">
              <label for="analysis-offset">Input offset (ms)</label>
              <input type="number" id="analysis-offset" min="-250" max="250" step="1" aria-describedby="analysis-calibration-status" />
            </div>
            <button type="button" id="analysis-calibrate">Calibrate device</button>
            <button type="button" id="analysis-calibration-reset">Reset offset</button>
          </div>
          <div class="input-monitor">
            <span>Input</span>
            <meter id="analysis-level" min="0" max="1" value="0">0%</meter>
          </div>
          <p class="analysis-device" id="analysis-device">Microphone details appear when a session starts.</p>
          <p class="analysis-device" id="analysis-calibration-status"></p>
          <p class="analysis-advice"><strong>Use headphones for scored sessions.</strong> Speaker bleed can look like a perfectly timed hit. Free play requires a steady selected pulse; ambient sound can add false hits.</p>
          <p class="analysis-privacy">Microphone audio is processed live on this device. It is not recorded, stored, or uploaded.</p>
          <details class="analysis-help"><summary>How the score works</summary><p>Score = 100 × (1 − RMS timing error ÷ 20% of the selected pulse duration), clamped from 0 to 100. Millisecond error and jitter are the primary results.</p></details>
        </div>

        <div class="analysis-results" aria-label="Live timing results">
          <div class="analysis-hero-metrics">
            <div class="score-card">
              <span>Timing score</span>
              <strong id="analysis-score">--</strong>
              <small id="analysis-grade">Collecting</small>
            </div>
            <div class="metric-card">
              <span>Played tempo</span>
              <strong><span id="analysis-bpm">--</span><small> BPM</small></strong>
              <small id="analysis-confidence">0% confidence</small>
            </div>
            <div class="metric-card">
              <span id="analysis-deviation-label">Interval change</span>
              <strong id="analysis-deviation">--</strong>
            </div>
          </div>
          <div class="analysis-detail-grid">
            <div><span>Mean error</span><strong id="analysis-mean">--</strong></div>
            <div><span>Jitter</span><strong id="analysis-jitter">--</strong></div>
            <div><span id="analysis-bias-label">Interval bias</span><strong id="analysis-bias">--</strong></div>
            <div><span>Analyzed</span><strong id="analysis-hits">0 hits</strong></div>
            <div><span>Session</span><strong id="analysis-duration">0:00</strong></div>
          </div>
          <div class="timing-trace" aria-hidden="true">
            <span class="trace-early" id="trace-low-label">Shorter</span>
            <span class="trace-late" id="trace-high-label">Longer</span>
            <div class="trace-field" id="analysis-trace"><span class="trace-center"></span></div>
          </div>
          <div class="timing-balance" aria-label="Timing distribution">
            <span><strong id="analysis-early">0</strong> <span id="analysis-early-label">shorter</span></span>
            <span><strong id="analysis-ontime">0</strong> <span id="analysis-ontime-label">steady</span></span>
            <span><strong id="analysis-late">0</strong> <span id="analysis-late-label">longer</span></span>
          </div>
        </div>
      </div>
      <p class="analysis-message" id="analysis-message" role="status" aria-live="polite">Start a session, then play a steady pulse near the microphone.</p>
      <section class="analysis-history" aria-labelledby="analysis-history-heading">
        <div class="analysis-history-heading">
          <h3 id="analysis-history-heading">Recent local sessions</h3>
          <span id="analysis-history-count">0 saved</span>
        </div>
        <ol id="analysis-history-list"></ol>
        <p id="analysis-history-empty">No saved sessions yet.</p>
      </section>
    </section>

    <div class="pillar" id="pillar-setlist">
      <button type="button" class="pillar-rail" id="rail-setlist"
        aria-expanded="true" aria-controls="pillar-setlist-body">
        <span class="rail-label">Setlist</span>
        <span class="rail-chevron" aria-hidden="true">&#9662;</span>
      </button>
      <div class="pillar-body" id="pillar-setlist-body">
        <section class="panel setlist-panel" aria-labelledby="setlist-h">
          <div class="panel-heading setlist-heading">
            <div>
              <p class="section-kicker">Current set</p>
              <h2 id="setlist-h">Songs</h2>
            </div>
            <span class="panel-count" id="song-count">0 songs</span>
          </div>
          <div class="field-row">
            <div class="field" style="flex:1">
              <label for="setlist-select">Setlist</label>
              <select id="setlist-select" style="width:100%"></select>
            </div>
          </div>
          <div class="field-row setlist-actions">
            <button type="button" id="setlist-new">New</button>
            <button type="button" id="setlist-rename">Rename</button>
            <button type="button" id="setlist-delete">Delete</button>
            <button type="button" id="library-open">Open library</button>
          </div>
          <ol class="song-list" id="song-list"></ol>
          <p class="empty-note" id="song-empty">No songs yet. Dial in a groove and save it.</p>
          <form class="song-form" id="song-form">
            <div class="field">
              <label for="song-title">Title</label>
              <input type="text" id="song-title" class="text-input" placeholder="e.g. Tom Sawyer" />
            </div>
            <div class="field-row">
              <div class="field" style="flex:1">
                <label for="song-artist">Artist</label>
                <input type="text" id="song-artist" class="text-input" placeholder="e.g. Rush" />
              </div>
              <div class="field" style="flex:1">
                <label for="song-band">Band</label>
                <input type="text" id="song-band" class="text-input" placeholder="e.g. Cover band" />
              </div>
            </div>
            <div class="song-form-actions">
              <button type="submit" id="song-save">Save new song</button>
              <button type="button" id="song-update" disabled>Update loaded song</button>
            </div>
          </form>
        </section>
      </div>
    </div>

    <div class="pillar" id="pillar-satellites">
      <button type="button" class="pillar-rail" id="rail-satellites"
        aria-expanded="true" aria-controls="pillar-satellites-body">
        <span class="rail-label">Tools</span>
        <span class="rail-chevron" aria-hidden="true">&#9662;</span>
      </button>
      <div class="pillar-body" id="pillar-satellites-body">
    <section class="panel rack-panel" aria-labelledby="mixer-h">
      <h2><button type="button" class="panel-toggle" id="toggle-mixer"
        aria-expanded="true" aria-controls="mixer-body">
        <span><span id="mixer-h">Subdivision mixer</span><small>Blend rhythmic layers</small></span>
        <span class="rail-chevron" aria-hidden="true">&#9662;</span>
      </button></h2>
      <div class="panel-body" id="mixer-body">
        <div class="mixer" id="mixer"></div>
      </div>
    </section>

    <section class="panel rack-panel" aria-labelledby="sound-h">
      <h2><button type="button" class="panel-toggle" id="toggle-sound"
        aria-expanded="true" aria-controls="sound-body">
        <span><span id="sound-h">Sound</span><small>Voice and output</small></span>
        <span class="rail-chevron" aria-hidden="true">&#9662;</span>
      </button></h2>
      <div class="panel-body" id="sound-body">
      <div class="field-row">
        <div class="field">
          <label for="voice">Voice</label>
          <select id="voice">
            <option value="click">Click</option>
            <option value="wood">Woodblock</option>
            <option value="beep">Beep</option>
          </select>
        </div>
        <div class="field" style="flex:1">
          <label for="master">Master volume</label>
          <input type="range" id="master" min="0" max="100" value="${Math.round(settings.masterVolume * 100)}" />
        </div>
      </div>
      <div class="toggle-field shortcut-preference">
        <input type="checkbox" id="single-key-shortcuts" ${ui.singleKeyShortcutsEnabled ? "checked" : ""} />
        <label for="single-key-shortcuts">Enable T, N, and P single-key shortcuts</label>
      </div>
      </div>
    </section>

    <section class="panel rack-panel" aria-labelledby="trainers-h">
      <h2><button type="button" class="panel-toggle" id="toggle-trainers"
        aria-expanded="true" aria-controls="trainers-body">
        <span><span id="trainers-h">Trainers</span><small>Practice automation</small></span>
        <span class="rail-chevron" aria-hidden="true">&#9662;</span>
      </button></h2>
      <div class="panel-body" id="trainers-body">
      <div class="field-row">
        <div class="toggle-field">
          <input type="checkbox" id="gap-on" ${settings.gap.enabled ? "checked" : ""} />
          <label for="gap-on">Gap trainer</label>
        </div>
        <div class="field">
          <label for="gap-play">Play bars</label>
          <input type="number" id="gap-play" min="1" max="32" value="${settings.gap.playBars}" />
        </div>
        <div class="field">
          <label for="gap-mute">Mute bars</label>
          <input type="number" id="gap-mute" min="1" max="32" value="${settings.gap.muteBars}" />
        </div>
      </div>
      <div class="field-row">
        <div class="toggle-field">
          <input type="checkbox" id="sp-on" ${settings.speed.enabled ? "checked" : ""} />
          <label for="sp-on">Speed trainer</label>
        </div>
        <div class="field">
          <label for="sp-to">Target BPM</label>
          <input type="number" id="sp-to" min="${MIN_BPM}" max="${MAX_BPM}" value="${settings.speed.toBpm}" />
        </div>
        <div class="field">
          <label for="sp-step">Step</label>
          <input type="number" id="sp-step" min="1" max="20" value="${settings.speed.stepBpm}" />
        </div>
        <div class="field">
          <label for="sp-every">Every bars</label>
          <input type="number" id="sp-every" min="1" max="32" value="${settings.speed.everyBars}" />
        </div>
      </div>
      <p class="trainer-status" id="trainer-status"></p>
      </div>
    </section>
      </div>
    </div>

    <p class="shortcuts">
      <kbd>Space</kbd> start/stop &nbsp; <kbd>&uarr;</kbd><kbd>&darr;</kbd> &plusmn;1 BPM &nbsp;
      <kbd>&larr;</kbd><kbd>&rarr;</kbd> &plusmn;5 BPM
      <span id="single-key-shortcut-legend" ${ui.singleKeyShortcutsEnabled ? "" : "hidden"}>
        &nbsp; <kbd>T</kbd> tap tempo &nbsp; <kbd>N</kbd>/<kbd>P</kbd> next/prev song
      </span>
    </p>
  </main>

  <aside class="mobile-transport" id="mobile-transport" aria-label="Compact metronome transport">
    <button type="button" id="mobile-song-prev" aria-label="Previous song">&larr;</button>
    <div class="mobile-transport-info">
      <p class="mobile-bpm"><span id="mobile-bpm-value">${settings.bpm}</span> <span>BPM</span></p>
      <p id="mobile-transport-now">No song loaded</p>
      <p id="mobile-transport-next">No songs in setlist</p>
    </div>
    <button type="button" class="btn-primary" id="mobile-startstop" aria-pressed="false">Start</button>
    <button type="button" id="mobile-song-next" aria-label="Next song">&rarr;</button>
  </aside>

  <dialog id="calibration-dialog" aria-labelledby="calibration-heading" aria-describedby="calibration-instructions calibration-status">
    <form method="dialog" class="calibration-dialog-content">
      <div class="dialog-header">
        <h2 id="calibration-heading">Calibrate this audio device</h2>
        <button type="submit" value="cancel" id="calibration-close" aria-label="Close calibration">Close</button>
      </div>
      <p id="calibration-instructions">Use speakers in a quiet room. Stop the metronome, do not play, and keep the microphone near your normal practice position. Ten isolated clicks will play.</p>
      <div class="calibration-progress" aria-hidden="true"><span id="calibration-progress-bar"></span></div>
      <p id="calibration-status" role="status" aria-live="polite">Ready to measure speaker-to-microphone round-trip latency.</p>
      <div class="dialog-actions">
        <button type="button" class="btn-primary" id="calibration-begin">Begin 10-click measurement</button>
        <button type="submit" value="cancel">Cancel</button>
      </div>
    </form>
  </dialog>

  <dialog id="library-dialog" aria-labelledby="library-heading" aria-describedby="library-status">
    <div class="dialog-header">
      <h2 id="library-heading">Song library</h2>
      <button type="button" id="library-close" aria-label="Close song library">Close</button>
    </div>
    <div class="field library-search-field">
      <label for="library-search">Search songs</label>
      <input type="search" id="library-search" class="text-input" autocomplete="off" />
    </div>
    <p class="library-results-summary" id="library-results-summary" aria-live="polite"></p>
    <ul class="library-list" id="library-list"></ul>
    <div class="library-tools" aria-label="Library and backup tools">
      <button type="button" id="library-remove-unused">Remove unused songs</button>
      <button type="button" id="backup-export">Export backup</button>
      <button type="button" id="backup-restore">Restore backup</button>
      <input type="file" id="backup-file" accept="application/json,.json" class="visually-hidden"
        tabindex="-1" aria-describedby="backup-help library-status" />
    </div>
    <p class="library-help" id="backup-help">Restore replaces this browser's library, setlists, settings, interface preferences, and Timing Lab history.</p>
    <p class="library-status" id="library-status" role="status" aria-live="polite"></p>
  </dialog>
`;

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const bpmValue = $<HTMLSpanElement>("bpm-value");
const bpmSlider = $<HTMLInputElement>("bpm-slider");
const startStop = $<HTMLButtonElement>("startstop");
const mobileStartStop = $<HTMLButtonElement>("mobile-startstop");
const mobileBpmValue = $<HTMLSpanElement>("mobile-bpm-value");
const lampsEl = $<HTMLDivElement>("lamps");
const srStatus = $<HTMLParagraphElement>("sr-status");
const trainerStatus = $<HTMLParagraphElement>("trainer-status");
const engineState = $<HTMLSpanElement>("engine-state");
const singleKeyShortcuts = $<HTMLInputElement>("single-key-shortcuts");
const singleKeyShortcutLegend = $<HTMLSpanElement>("single-key-shortcut-legend");

function persist(): void {
  saveLastSettings(settings);
}

/* ---------- Timing Lab ---------- */

type AnalysisUiState = "idle" | "requesting-permission" | "warming-up" | "live"
  | "calibration" | "complete" | "unsupported" | "denied" | "disconnected"
  | "processing-error";

const analysisStateEl = $<HTMLSpanElement>("analysis-state");
const analysisMessage = $<HTMLParagraphElement>("analysis-message");
const analysisToggle = $<HTMLButtonElement>("analysis-toggle");
const analysisReset = $<HTMLButtonElement>("analysis-reset");
const analysisExport = $<HTMLButtonElement>("analysis-export");
const analysisGrid = $<HTMLSelectElement>("analysis-grid");
const analysisSensitivity = $<HTMLSelectElement>("analysis-sensitivity");
const analysisOffset = $<HTMLInputElement>("analysis-offset");
const analysisCalibrate = $<HTMLButtonElement>("analysis-calibrate");
const analysisLevel = $<HTMLMeterElement>("analysis-level");
const analysisDevice = $<HTMLParagraphElement>("analysis-device");
const analysisCalibrationStatus = $<HTMLParagraphElement>("analysis-calibration-status");
const analysisTrace = $<HTMLDivElement>("analysis-trace");
const calibrationDialog = $<HTMLDialogElement>("calibration-dialog");
const calibrationBegin = $<HTMLButtonElement>("calibration-begin");
const calibrationStatus = $<HTMLParagraphElement>("calibration-status");
const calibrationProgress = $<HTMLSpanElement>("calibration-progress-bar");
let analysisHistory: AnalysisSessionRecord[] = loadAnalysisHistory();
let analysisUiState: AnalysisUiState = "idle";
let latestAnalysisSnapshot: AnalysisSnapshot = analysisSession.snapshot();
let analysisTimer: number | null = null;
let calibrationTimer: number | null = null;
let analysisTransitioning = false;
let lastInputStatus: MicrophoneInputStatus | null = null;
let calibrationController: CalibrationController;

const STATE_LABELS: Record<AnalysisUiState, string> = {
  idle: "Mic off",
  "requesting-permission": "Requesting permission",
  "warming-up": "Warming up",
  live: "Live",
  calibration: "Calibrating",
  complete: "Complete",
  unsupported: "Unsupported",
  denied: "Permission denied",
  disconnected: "Mic disconnected",
  "processing-error": "Processing error",
};

function setAnalysisState(state: AnalysisUiState, message: string): void {
  analysisUiState = state;
  analysisStateEl.dataset.state = state;
  analysisStateEl.textContent = STATE_LABELS[state];
  analysisMessage.textContent = message;
  const pending = state === "requesting-permission" || state === "warming-up" || state === "calibration";
  analysisToggle.disabled = pending || state === "unsupported";
  analysisReset.disabled = pending;
  analysisCalibrate.disabled = pending || state === "unsupported";
  analysisToggle.textContent = state === "live" || state === "warming-up"
    ? "End and save"
    : "Start analysis";
}

function formatMilliseconds(value: number | null, signed = false): string {
  if (value === null) return "--";
  const rounded = Math.round(value * 10) / 10;
  return `${signed && rounded > 0 ? "+" : ""}${rounded} ms`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function renderAnalysisMode(): void {
  const metronomeMode = latestAnalysisSnapshot.mode === "metronome";
  $<HTMLElement>("analysis-mode").textContent = metronomeMode ? "Metronome sync" : "Free play";
  $<HTMLElement>("analysis-mode-help").textContent = metronomeMode
    ? "Hits are compared with every selected subdivision target, including muted gap bars."
    : "Tempo locks from a steady repeated pulse; shorter or longer intervals are reported without early or late claims.";
  $<HTMLElement>("analysis-deviation-label").textContent = metronomeMode ? "Current timing" : "Interval change";
  $<HTMLElement>("analysis-bias-label").textContent = metronomeMode ? "Timing bias" : "Interval bias";
  const labels = metronomeMode
    ? ["Early", "Late", "early", "on time", "late"]
    : ["Shorter", "Longer", "shorter", "steady", "longer"];
  $<HTMLElement>("trace-low-label").textContent = labels[0];
  $<HTMLElement>("trace-high-label").textContent = labels[1];
  $<HTMLElement>("analysis-early-label").textContent = labels[2];
  $<HTMLElement>("analysis-ontime-label").textContent = labels[3];
  $<HTMLElement>("analysis-late-label").textContent = labels[4];
}

function renderAnalysisSnapshot(snapshot: AnalysisSnapshot): void {
  latestAnalysisSnapshot = snapshot;
  renderAnalysisMode();
  $<HTMLElement>("analysis-score").textContent = snapshot.score === null ? "--" : String(snapshot.score);
  $<HTMLElement>("analysis-grade").textContent = snapshot.grade;
  $<HTMLElement>("analysis-bpm").textContent = snapshot.bpm === null ? "--" : snapshot.bpm.toFixed(1);
  $<HTMLElement>("analysis-confidence").textContent = `${Math.round(snapshot.confidence * 100)}% confidence`;
  $<HTMLElement>("analysis-deviation").textContent = formatMilliseconds(snapshot.currentDeviationMs, true);
  $<HTMLElement>("analysis-mean").textContent = formatMilliseconds(snapshot.meanAbsoluteDeviationMs);
  $<HTMLElement>("analysis-jitter").textContent = formatMilliseconds(snapshot.standardDeviationMs);
  $<HTMLElement>("analysis-bias").textContent = formatMilliseconds(snapshot.averageOffsetMs, true);
  $<HTMLElement>("analysis-hits").textContent = `${snapshot.analyzedHits} ${snapshot.analyzedHits === 1 ? "hit" : "hits"}`;
  $<HTMLElement>("analysis-duration").textContent = formatDuration(snapshot.durationSeconds);
  $<HTMLElement>("analysis-early").textContent = String(snapshot.earlyCount);
  $<HTMLElement>("analysis-ontime").textContent = String(snapshot.onTimeCount);
  $<HTMLElement>("analysis-late").textContent = String(snapshot.lateCount);
  analysisTrace.querySelectorAll(".trace-hit").forEach((node) => node.remove());
  for (const deviation of snapshot.recentDeviationsMs) {
    const dot = document.createElement("span");
    dot.className = "trace-hit";
    dot.style.insetInlineStart = `${Math.min(100, Math.max(0, 50 + deviation / 2))}%`;
    analysisTrace.appendChild(dot);
  }
}

function renderCalibrationStatus(): void {
  const calibration = analysisPreferences.calibration;
  const date = calibration.measuredAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(calibration.measuredAt))
    : null;
  analysisOffset.value = String(calibration.offsetMs);
  analysisCalibrationStatus.textContent = calibration.quality === "measured"
    ? `${calibration.offsetMs} ms measured${date ? ` on ${date}` : ""}${calibration.stale ? ". Recalibrate for the current device." : "."}`
    : `${calibration.offsetMs} ms estimated or manually set. Run calibration for trusted timing.`;
}

function comparableTrend(record: AnalysisSessionRecord, index: number): string {
  if (record.score === null) return "Score collecting";
  const previous = analysisHistory.slice(index + 1).find(
    (candidate) => candidate.mode === record.mode
      && candidate.subdivision === record.subdivision
      && candidate.score !== null,
  );
  if (!previous || previous.score === null) return "First comparable score";
  const difference = record.score - previous.score;
  if (difference === 0) return "No score change";
  return `${difference > 0 ? "+" : ""}${difference} vs previous`;
}

function renderAnalysisHistory(): void {
  const list = $<HTMLOListElement>("analysis-history-list");
  list.replaceChildren();
  $<HTMLElement>("analysis-history-count").textContent = `${analysisHistory.length} saved`;
  $<HTMLElement>("analysis-history-empty").hidden = analysisHistory.length > 0;
  analysisExport.disabled = analysisHistory.length === 0;
  analysisHistory.slice(0, 8).forEach((record, index) => {
    const item = document.createElement("li");
    const summary = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = record.songTitle || (record.mode === "metronome" ? "Metronome session" : "Free-play session");
    const metadata = document.createElement("span");
    metadata.textContent = `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.recordedAt))} · ${record.hitCount} hits · ${record.playedBpm?.toFixed(1) ?? "--"} BPM`;
    const trend = document.createElement("small");
    const pulseName = record.subdivision === 1 ? "quarter" : record.subdivision === 2 ? "eighth" : "sixteenth";
    const modeName = record.mode === "metronome" ? "Metronome sync" : "Free play";
    metadata.textContent = `${metadata.textContent} · ${modeName} · ${pulseName} pulse`;
    trend.textContent = `${comparableTrend(record, index)} · Mean ${formatMilliseconds(record.meanAbsoluteErrorMs)} · Jitter ${formatMilliseconds(record.jitterMs)}`;
    summary.append(title, metadata, trend);
    const score = document.createElement("strong");
    score.className = "history-score";
    score.textContent = record.score === null ? "--" : String(record.score);
    score.setAttribute("aria-label", record.score === null ? "Score unavailable" : `Score ${record.score}`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${title.textContent}`);
    remove.addEventListener("click", () => {
      if (!window.confirm(`Delete ${title.textContent} from local history?`)) return;
      analysisHistory = deleteAnalysisSession(record.id);
      renderAnalysisHistory();
      setAnalysisState("complete", "The saved session was deleted from this browser.");
    });
    item.append(summary, score, remove);
    list.appendChild(item);
  });
}

function saveCurrentAnalysis(snapshot: AnalysisSnapshot): void {
  if (snapshot.detectedHits === 0) return;
  const song = library.find((candidate) => candidate.id === ui.activeSongId) ?? null;
  const setlist = activeSetlist();
  const record: AnalysisSessionRecord = {
    id: globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`,
    recordedAt: new Date().toISOString(),
    mode: snapshot.mode,
    songId: song?.id ?? null,
    songTitle: song?.title ?? null,
    setlistId: setlist?.id ?? null,
    setlistName: setlist?.name ?? null,
    targetBpm: snapshot.mode === "metronome" ? settings.bpm : null,
    playedBpm: snapshot.bpm,
    confidence: Math.round(snapshot.confidence * 100),
    score: snapshot.score,
    meanAbsoluteErrorMs: snapshot.meanAbsoluteDeviationMs,
    jitterMs: snapshot.standardDeviationMs,
    biasMs: snapshot.averageOffsetMs,
    hitCount: snapshot.analyzedHits,
    durationSeconds: snapshot.durationSeconds,
    subdivision: analysisPreferences.subdivision,
  };
  analysisHistory = saveAnalysisSession(record);
  renderAnalysisHistory();
}

function stopAnalysisTimer(): void {
  if (analysisTimer !== null) window.clearInterval(analysisTimer);
  analysisTimer = null;
}

function startAnalysisTimer(): void {
  stopAnalysisTimer();
  let lastSummaryBucket = 0;
  analysisTimer = window.setInterval(() => {
    renderAnalysisSnapshot(analysisSession.snapshot());
    const bucket = Math.floor(latestAnalysisSnapshot.durationSeconds / 15);
    if (bucket > lastSummaryBucket && bucket > 0) {
      lastSummaryBucket = bucket;
      analysisMessage.textContent = `${latestAnalysisSnapshot.analyzedHits} hits analyzed. ${latestAnalysisSnapshot.score === null ? "Still collecting a reliable score." : `Current score ${latestAnalysisSnapshot.score}.`}`;
    }
  }, 1_000);
}

function syncAnalysisMode(): void {
  const mode: AnalysisMode = engine.running ? "metronome" : "free";
  const changed = analysisSession.setMode(mode);
  renderAnalysisSnapshot(analysisSession.snapshot());
  if (changed && (analysisUiState === "live" || analysisUiState === "warming-up")) {
    setAnalysisState(
      analysisUiState,
      mode === "metronome"
        ? "Mode changed to metronome sync. Timing collection restarted on the audio clock."
        : "Mode changed to free play. Pulse collection restarted without an early or late reference.",
    );
  }
}

const microphoneAnalyzer = new MicrophoneAnalyzer(engine, {
  onOnset: (time, strength) => {
    if (calibrationController?.running) {
      calibrationController.recordOnset(time);
      return;
    }
    if (analysisUiState !== "live") return;
    const snapshot = analysisSession.addOnset(time, strength);
    renderAnalysisSnapshot(snapshot);
    if (snapshot.detectedHits >= 8 && snapshot.confidence < 0.35) {
      analysisMessage.textContent = "Input too noisy or irregular. Move closer, reduce ambient sound, or lower sensitivity.";
    }
  },
  onLevel: (level) => {
    analysisLevel.value = level;
    analysisLevel.textContent = `${Math.round(level * 100)}%`;
  },
  onInputStatus: (status) => {
    lastInputStatus = status;
    analysisDevice.textContent = `${status.label}. ${status.browserProcessingActive
      ? "Browser input processing is active, which can shift or soften attacks."
      : "Echo cancellation, noise suppression, and auto gain are off."}`;
  },
  onUnexpectedStop: (message) => {
    stopAnalysisTimer();
    if (calibrationController?.running) {
      if (calibrationTimer !== null) window.clearTimeout(calibrationTimer);
      calibrationTimer = null;
      calibrationController.cancel();
      calibrationStatus.textContent = message;
      calibrationBegin.disabled = false;
      calibrationBegin.textContent = "Retry measurement";
    }
    const state = message.toLowerCase().includes("disconnect") ? "disconnected" : "processing-error";
    setAnalysisState(state, message);
  },
});

calibrationController = new CalibrationController(engine, {
  start: () => microphoneAnalyzer.start("medium"),
  stop: () => microphoneAnalyzer.stop(),
});

engine.onScheduledBeat((beat) => {
  if (analysisUiState === "live" && latestAnalysisSnapshot.mode === "metronome") {
    analysisSession.addReferenceBeat(beat.time, beat.bpm);
  }
});

async function startAnalysis(): Promise<void> {
  if (analysisTransitioning) return;
  analysisTransitioning = true;
  syncAnalysisMode();
  analysisSession.reset();
  renderAnalysisSnapshot(analysisSession.snapshot());
  setAnalysisState("requesting-permission", "Choose Allow if the browser asks to use your microphone.");
  try {
    await microphoneAnalyzer.start(analysisPreferences.sensitivity);
    setAnalysisState("warming-up", "Listening to the room for a stable noise floor.");
    window.setTimeout(() => {
      if (!microphoneAnalyzer.running || analysisUiState !== "warming-up") return;
      setAnalysisState("live", latestAnalysisSnapshot.mode === "metronome"
        ? "Live. Play the selected pulse with headphones; muted gap bars still count."
        : "Live. Repeat the selected pulse steadily; interval consistency appears after pulse lock.");
      startAnalysisTimer();
    }, 600);
  } catch (error) {
    const message = microphoneErrorMessage(error);
    const denied = error instanceof DOMException
      && (error.name === "NotAllowedError" || error.name === "SecurityError");
    const unsupported = message.includes("HTTPS") || message.includes("AudioWorklet");
    setAnalysisState(unsupported ? "unsupported" : denied ? "denied" : "processing-error", message);
  } finally {
    analysisTransitioning = false;
  }
}

function endAndSaveAnalysis(): void {
  microphoneAnalyzer.stop();
  stopAnalysisTimer();
  const snapshot = analysisSession.snapshot();
  renderAnalysisSnapshot(snapshot);
  saveCurrentAnalysis(snapshot);
  setAnalysisState("complete", snapshot.detectedHits === 0
    ? "Session ended with no detected hits, so nothing was saved."
    : "Session ended and normalized metrics were saved locally. Raw audio was not stored.");
}

analysisToggle.addEventListener("click", () => {
  if (analysisUiState === "live" || analysisUiState === "warming-up") endAndSaveAnalysis();
  else void startAnalysis();
});
analysisReset.addEventListener("click", () => {
  analysisSession.reset();
  renderAnalysisSnapshot(analysisSession.snapshot());
  setAnalysisState(analysisUiState === "live" ? "live" : "idle", "Current Timing Lab measurements were reset.");
});
analysisGrid.value = String(analysisPreferences.subdivision);
analysisSensitivity.value = analysisPreferences.sensitivity;
analysisGrid.addEventListener("change", () => {
  analysisPreferences.subdivision = Number(analysisGrid.value) as AnalysisSubdivision;
  analysisSession.setSubdivision(analysisPreferences.subdivision);
  saveAnalysisPreferences(analysisPreferences);
  renderAnalysisSnapshot(analysisSession.snapshot());
  setAnalysisState(analysisUiState === "live" ? "live" : "idle", "Played pulse changed. Timing collection restarted.");
});
analysisSensitivity.addEventListener("change", () => {
  analysisPreferences.sensitivity = analysisSensitivity.value as AnalysisSensitivity;
  microphoneAnalyzer.setSensitivity(analysisPreferences.sensitivity);
  saveAnalysisPreferences(analysisPreferences);
});
analysisOffset.addEventListener("change", () => {
  const offsetMs = Math.min(250, Math.max(-250, Math.round(Number(analysisOffset.value) || 0)));
  analysisPreferences.calibration = {
    offsetMs,
    measuredAt: null,
    inputDeviceId: lastInputStatus?.deviceId ?? null,
    quality: "estimated",
    stale: false,
  };
  analysisSession.setInputOffset(offsetMs);
  saveAnalysisPreferences(analysisPreferences);
  renderCalibrationStatus();
});
$("analysis-calibration-reset").addEventListener("click", () => {
  analysisPreferences.calibration = {
    offsetMs: 0,
    measuredAt: null,
    inputDeviceId: null,
    quality: "estimated",
    stale: false,
  };
  analysisSession.setInputOffset(0);
  saveAnalysisPreferences(analysisPreferences);
  renderCalibrationStatus();
});

function exportAnalysisCsv(): void {
  const header = ["recorded_at", "mode", "song", "setlist", "target_bpm", "played_bpm", "confidence_percent", "score", "mean_error_ms", "jitter_ms", "bias_ms", "hit_count", "duration_seconds", "subdivision"];
  const quote = (value: string | number | null): string => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = analysisHistory.map((record) => [
    record.recordedAt, record.mode, record.songTitle, record.setlistName, record.targetBpm,
    record.playedBpm, record.confidence, record.score, record.meanAbsoluteErrorMs,
    record.jitterMs, record.biasMs, record.hitCount, record.durationSeconds, record.subdivision,
  ].map(quote).join(","));
  const url = URL.createObjectURL(new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ggcoder-timing-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
analysisExport.addEventListener("click", exportAnalysisCsv);

$("analysis-calibrate").addEventListener("click", () => {
  if (engine.running) {
    setAnalysisState("idle", "Stop the metronome before speaker-loopback calibration.");
    return;
  }
  if (microphoneAnalyzer.running) endAndSaveAnalysis();
  calibrationStatus.textContent = "Ready to measure speaker-to-microphone round-trip latency.";
  calibrationProgress.style.inlineSize = "0%";
  calibrationBegin.disabled = false;
  calibrationBegin.textContent = "Begin 10-click measurement";
  calibrationDialog.showModal();
  queueMicrotask(() => calibrationBegin.focus());
});

calibrationBegin.addEventListener("click", async () => {
  calibrationBegin.disabled = true;
  calibrationStatus.textContent = "Requesting microphone access, then scheduling ten clicks.";
  setAnalysisState("calibration", "Calibration is using the microphone and speaker loopback.");
  try {
    const run = await calibrationController.begin(
      () => lastInputStatus?.latencySeconds ?? null,
    );
    calibrationStatus.textContent = `Listening for ${CALIBRATION_CLICK_COUNT} clicks. Do not play.`;
    calibrationProgress.style.transitionDuration = `${CALIBRATION_CLICK_INTERVAL_SECONDS * (CALIBRATION_CLICK_COUNT - 1) + 1}s`;
    requestAnimationFrame(() => { calibrationProgress.style.inlineSize = "100%"; });
    calibrationTimer = window.setTimeout(() => {
      calibrationTimer = null;
      const result = calibrationController.complete();
      if (result.success && result.offsetMs !== null) {
        analysisPreferences.calibration = {
          offsetMs: result.offsetMs,
          measuredAt: new Date().toISOString(),
          inputDeviceId: lastInputStatus?.deviceId ?? null,
          quality: "measured",
          stale: false,
        };
        analysisSession.setInputOffset(result.offsetMs);
        saveAnalysisPreferences(analysisPreferences);
        renderCalibrationStatus();
        calibrationStatus.textContent = `${result.message} Browser estimate before measurement was ${run.estimatedOffsetMs} ms.`;
        setAnalysisState("complete", "Device calibration succeeded and was saved locally.");
      } else {
        calibrationStatus.textContent = result.message;
        setAnalysisState("processing-error", "Calibration was not stable enough. Review the guidance and retry.");
      }
      calibrationBegin.disabled = false;
      calibrationBegin.textContent = "Retry measurement";
    }, (0.5 + CALIBRATION_CLICK_INTERVAL_SECONDS * (CALIBRATION_CLICK_COUNT - 1) + 0.6) * 1_000);
  } catch (error) {
    const message = microphoneErrorMessage(error);
    const denied = error instanceof DOMException
      && (error.name === "NotAllowedError" || error.name === "SecurityError");
    const unsupported = message.includes("HTTPS") || message.includes("AudioWorklet");
    calibrationStatus.textContent = message;
    calibrationBegin.disabled = unsupported;
    calibrationBegin.textContent = unsupported ? "Calibration unavailable" : "Retry measurement";
    setAnalysisState(
      unsupported ? "unsupported" : denied ? "denied" : "processing-error",
      "Calibration could not start. Check the microphone guidance and retry.",
    );
  }
});

calibrationDialog.addEventListener("close", () => {
  if (calibrationTimer !== null) window.clearTimeout(calibrationTimer);
  calibrationTimer = null;
  if (calibrationController.running) calibrationController.cancel();
  if (analysisUiState === "calibration") setAnalysisState("idle", "Calibration cancelled. No offset was changed.");
  $<HTMLButtonElement>("analysis-calibrate").focus();
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  analysisPreferences.calibration = markCalibrationForDevice(analysisPreferences.calibration, null);
  saveAnalysisPreferences(analysisPreferences);
  renderCalibrationStatus();
  const calibrationWasRunning = calibrationController.running;
  const analysisWasRunning = microphoneAnalyzer.running;
  if (calibrationWasRunning) {
    if (calibrationTimer !== null) window.clearTimeout(calibrationTimer);
    calibrationTimer = null;
    calibrationController.cancel();
    calibrationStatus.textContent = "The audio-device list changed. Reconnect the microphone, then retry calibration.";
    calibrationBegin.disabled = false;
    calibrationBegin.textContent = "Retry measurement";
  } else if (analysisWasRunning) {
    microphoneAnalyzer.stop();
  }
  if (calibrationWasRunning || analysisWasRunning) {
    stopAnalysisTimer();
    setAnalysisState("disconnected", "The audio-device list changed. Reconnect or select the microphone, then retry.");
  }
});

window.addEventListener("pagehide", () => {
  stopAnalysisTimer();
  if (calibrationTimer !== null) window.clearTimeout(calibrationTimer);
  calibrationController.cancel();
  microphoneAnalyzer.stop();
});

const tabletAnalysisPlacement = window.matchMedia("(min-width: 760px) and (max-width: 1199px)");
function syncAnalysisPlacement(): void {
  const panel = $<HTMLElement>("analysis-panel");
  const anchor = tabletAnalysisPlacement.matches
    ? $<HTMLElement>("pillar-setlist")
    : document.querySelector<HTMLElement>(".pillar-metronome")!;
  if (anchor.nextElementSibling !== panel) anchor.after(panel);
}
tabletAnalysisPlacement.addEventListener("change", syncAnalysisPlacement);
syncAnalysisPlacement();
renderAnalysisSnapshot(latestAnalysisSnapshot);
renderCalibrationStatus();
renderAnalysisHistory();
if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !("AudioWorkletNode" in window)) {
  setAnalysisState("unsupported", "Timing Lab requires HTTPS or localhost, microphone capture, and AudioWorklet support.");
}

/* ---------- Tempo ---------- */

function setBpm(bpm: number): void {
  settings.bpm = clampBpm(bpm);
  bpmValue.textContent = String(settings.bpm);
  mobileBpmValue.textContent = String(settings.bpm);
  bpmSlider.value = String(settings.bpm);
  persist();
}

bpmSlider.addEventListener("input", () => setBpm(Number(bpmSlider.value)));
$("bpm-down").addEventListener("click", () => setBpm(settings.bpm - 1));
$("bpm-up").addEventListener("click", () => setBpm(settings.bpm + 1));
$("tap").addEventListener("click", () => {
  const bpm = tapTempo.tap(performance.now());
  if (bpm !== null) setBpm(bpm);
});

function renderShortcutPreference(): void {
  singleKeyShortcutLegend.hidden = !ui.singleKeyShortcutsEnabled;
  if (ui.singleKeyShortcutsEnabled) $("tap").setAttribute("aria-keyshortcuts", "T");
  else $("tap").removeAttribute("aria-keyshortcuts");
}

singleKeyShortcuts.addEventListener("change", () => {
  ui.singleKeyShortcutsEnabled = singleKeyShortcuts.checked;
  saveUiState(ui);
  renderShortcutPreference();
  announce(`Single-key shortcuts ${ui.singleKeyShortcutsEnabled ? "enabled" : "disabled"}`);
});
renderShortcutPreference();

/* ---------- Beat lamps ---------- */

const ACCENT_CYCLE: Record<BeatAccent, BeatAccent> = {
  accent: "normal",
  normal: "mute",
  mute: "accent",
};
const ACCENT_LABEL: Record<BeatAccent, string> = {
  accent: "accented",
  normal: "normal",
  mute: "muted",
};

function renderLamps(): void {
  lampsEl.innerHTML = "";
  settings.accents.forEach((accent, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lamp";
    b.dataset.accent = accent;
    b.dataset.beat = String(i);
    b.textContent = String(i + 1);
    b.setAttribute("aria-label", `Beat ${i + 1}: ${ACCENT_LABEL[accent]}`);
    b.addEventListener("click", () => {
      settings.accents[i] = ACCENT_CYCLE[settings.accents[i]];
      renderLamps();
      persist();
    });
    lampsEl.appendChild(b);
  });
}
renderLamps();

$<HTMLInputElement>("beats").addEventListener("change", (e) => {
  const n = Math.min(9, Math.max(1, Number((e.target as HTMLInputElement).value) || 4));
  (e.target as HTMLInputElement).value = String(n);
  settings.beatsPerBar = n;
  settings.accents = settings.accents.slice(0, n);
  while (settings.accents.length < n) settings.accents.push("normal");
  if (n > 0 && settings.accents.every((a) => a === "normal")) {
    settings.accents = defaultAccents(n);
  }
  renderLamps();
  persist();
});

/* ---------- Mixer ---------- */

const LAYERS: { key: Layer; label: string; glyph: string }[] = [
  { key: "quarter", label: "Quarter", glyph: "1/4" },
  { key: "eighth", label: "Eighth", glyph: "1/8" },
  { key: "sixteenth", label: "Sixteenth", glyph: "1/16" },
  { key: "triplet", label: "Triplet", glyph: "1/8T" },
];

const mixerEl = $<HTMLDivElement>("mixer");
for (const { key, label, glyph } of LAYERS) {
  const wrap = document.createElement("div");
  wrap.className = "fader";
  const id = `mix-${key}`;
  wrap.innerHTML = `
    <span class="fader-glyph" aria-hidden="true">${glyph}</span>
    <input type="range" id="${id}" min="0" max="100"
      value="${Math.round(settings.mix[key] * 100)}" />
    <label for="${id}">${label}</label>
  `;
  mixerEl.appendChild(wrap);
  wrap.querySelector("input")!.addEventListener("input", (e) => {
    settings.mix[key] = Number((e.target as HTMLInputElement).value) / 100;
    persist();
  });
}

/* ---------- Sound ---------- */

const voiceSel = $<HTMLSelectElement>("voice");
voiceSel.value = settings.voice;
voiceSel.addEventListener("change", () => {
  settings.voice = voiceSel.value as Voice;
  persist();
});

$<HTMLInputElement>("master").addEventListener("input", (e) => {
  settings.masterVolume = Number((e.target as HTMLInputElement).value) / 100;
  persist();
});

/* ---------- Trainers ---------- */

function bindNumber(id: string, apply: (n: number) => void): void {
  $<HTMLInputElement>(id).addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    const minimum = Number(el.min);
    const maximum = Number(el.max);
    const parsed = Number(el.value);
    const finite = Number.isFinite(parsed) ? parsed : minimum;
    const corrected = Math.round(Math.min(maximum, Math.max(minimum, finite)));
    el.value = String(corrected);
    apply(corrected);
    persist();
  });
}

$<HTMLInputElement>("gap-on").addEventListener("change", (e) => {
  settings.gap.enabled = (e.target as HTMLInputElement).checked;
  persist();
});
bindNumber("gap-play", (n) => (settings.gap.playBars = Math.max(1, n)));
bindNumber("gap-mute", (n) => (settings.gap.muteBars = Math.max(1, n)));

$<HTMLInputElement>("sp-on").addEventListener("change", (e) => {
  settings.speed.enabled = (e.target as HTMLInputElement).checked;
  persist();
});
bindNumber("sp-to", (n) => (settings.speed.toBpm = clampBpm(n)));
bindNumber("sp-step", (n) => (settings.speed.stepBpm = Math.max(1, n)));
bindNumber("sp-every", (n) => (settings.speed.everyBars = Math.max(1, n)));

/* ---------- Setlists ---------- */

const setlistSelect = $<HTMLSelectElement>("setlist-select");
const songList = $<HTMLOListElement>("song-list");
const songEmpty = $<HTMLParagraphElement>("song-empty");
const songTitle = $<HTMLInputElement>("song-title");
const songArtist = $<HTMLInputElement>("song-artist");
const songBand = $<HTMLInputElement>("song-band");
const songUpdate = $<HTMLButtonElement>("song-update");
const songCount = $<HTMLSpanElement>("song-count");
const faceTransport = $<HTMLDivElement>("face-transport");
const transportNow = $<HTMLParagraphElement>("transport-now");
const transportNext = $<HTMLParagraphElement>("transport-next");
const mobileTransportNow = $<HTMLParagraphElement>("mobile-transport-now");
const mobileTransportNext = $<HTMLParagraphElement>("mobile-transport-next");
const previousSongButtons = [
  $<HTMLButtonElement>("song-prev"),
  $<HTMLButtonElement>("mobile-song-prev"),
];
const nextSongButtons = [
  $<HTMLButtonElement>("song-next"),
  $<HTMLButtonElement>("mobile-song-next"),
];
const libraryDialog = $<HTMLDialogElement>("library-dialog");
const librarySearch = $<HTMLInputElement>("library-search");
const libraryList = $<HTMLUListElement>("library-list");
const libraryResultsSummary = $<HTMLParagraphElement>("library-results-summary");
const libraryStatus = $<HTMLParagraphElement>("library-status");
const removeUnusedButton = $<HTMLButtonElement>("library-remove-unused");
const backupFile = $<HTMLInputElement>("backup-file");
let libraryOpener: HTMLElement | null = null;

function saveUi(): void {
  saveUiState(ui);
}

function activeSetlist(): Setlist | null {
  return setlists.find((s) => s.id === ui.activeSetlistId) ?? setlists[0] ?? null;
}

function clearSongEditor(): void {
  songTitle.value = "";
  songArtist.value = "";
  songBand.value = "";
}

function setActiveSetlist(id: string | null): void {
  ui.activeSetlistId = id;
  ui.activeSongId = null;
  clearSongEditor();
  saveUi();
  renderSetlists();
}

function renderSetlists(): void {
  const active = activeSetlist();
  if (active && ui.activeSetlistId !== active.id) {
    ui.activeSetlistId = active.id;
    saveUi();
  }
  setlistSelect.innerHTML = "";
  for (const sl of setlists) {
    const opt = document.createElement("option");
    opt.value = sl.id;
    opt.textContent = sl.name;
    setlistSelect.appendChild(opt);
  }
  setlistSelect.disabled = setlists.length === 0;
  $("setlist-rename").toggleAttribute("disabled", !active);
  $("setlist-delete").toggleAttribute("disabled", !active);
  if (active) setlistSelect.value = active.id;
  renderSongs();
}

function activeSongReferences() {
  return resolveSongReferences(activeSetlist(), library);
}

function activeSongs(): LibrarySong[] {
  return activeSongReferences().map(({ song }) => song);
}

function songLabel(song: LibrarySong): string {
  return song.artist ? `${song.title} by ${song.artist}` : song.title;
}

function renderSongs(): void {
  const references = activeSongReferences();
  const songs = references.map(({ song }) => song);
  songList.innerHTML = "";
  songEmpty.hidden = songs.length > 0;
  songCount.textContent = `${songs.length} ${songs.length === 1 ? "song" : "songs"}`;
  references.forEach(({ song, sourceIndex }, displayIndex) => {
    const li = document.createElement("li");
    if (song.id === ui.activeSongId) li.classList.add("active");

    const load = document.createElement("button");
    load.type = "button";
    load.className = "song-load";
    load.innerHTML = `<span class="song-order">${displayIndex + 1}</span>
      <span class="song-main">
        <span class="song-title">${escapeHtml(song.title)}</span>
        ${song.artist ? `<span class="song-artist">${escapeHtml(song.artist)}</span>` : ""}
      </span>
      ${song.band ? `<span class="song-band">${escapeHtml(song.band)}</span>` : ""}
      <span class="preset-meta">${song.settings.bpm} BPM</span>`;
    load.setAttribute("aria-label", `Load song ${songLabel(song)}, ${song.settings.bpm} BPM`);
    if (song.id === ui.activeSongId) load.setAttribute("aria-current", "true");
    load.addEventListener("click", () => loadSong(song));

    const up = document.createElement("button");
    up.type = "button";
    up.className = "song-move";
    up.textContent = "\u2191";
    up.disabled = displayIndex === 0;
    up.setAttribute("aria-label", `Move ${song.title} up`);
    up.addEventListener("click", () => {
      const previous = references[displayIndex - 1];
      if (previous) moveSong(sourceIndex, previous.sourceIndex);
    });

    const down = document.createElement("button");
    down.type = "button";
    down.className = "song-move";
    down.textContent = "\u2193";
    down.disabled = displayIndex === references.length - 1;
    down.setAttribute("aria-label", `Move ${song.title} down`);
    down.addEventListener("click", () => {
      const next = references[displayIndex + 1];
      if (next) moveSong(sourceIndex, next.sourceIndex);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "song-move";
    del.textContent = "\u2715";
    del.setAttribute("aria-label", `Remove ${song.title} from setlist`);
    del.addEventListener("click", () => {
      const active = activeSetlist();
      if (!active) return;
      active.songIds.splice(sourceIndex, 1);
      if (ui.activeSongId === song.id && !active.songIds.includes(song.id)) {
        ui.activeSongId = null;
        clearSongEditor();
        saveUi();
      }
      saveSetlists(setlists);
      renderSongs();
      announce(`Removed ${song.title} from the setlist`);
    });

    li.append(load, up, down, del);
    songList.appendChild(li);
  });
  songUpdate.disabled = !songs.some((song) => song.id === ui.activeSongId);
  renderTransport(songs);
}

function renderTransport(songs: LibrarySong[]): void {
  faceTransport.hidden = songs.length === 0;
  const index = songs.findIndex((song) => song.id === ui.activeSongId);
  const current = index >= 0 ? songs[index] : null;
  const next = index < 0 ? songs[0] ?? null : songs[index + 1] ?? null;
  const currentText = current ? songLabel(current) : "No song loaded";
  const nextText = next ? `Next: ${songLabel(next)}` : songs.length > 0 ? "End of setlist" : "No songs in setlist";
  transportNow.textContent = currentText;
  transportNext.textContent = nextText;
  mobileTransportNow.textContent = currentText;
  mobileTransportNext.textContent = nextText;
  for (const button of previousSongButtons) {
    button.disabled = songs.length === 0 || index === 0;
  }
  for (const button of nextSongButtons) {
    button.disabled = songs.length === 0 || index === songs.length - 1;
  }
}

function moveSong(sourceIndex: number, targetSourceIndex: number): void {
  const ids = activeSetlist()?.songIds ?? [];
  if (sourceIndex < 0 || targetSourceIndex < 0 || sourceIndex >= ids.length || targetSourceIndex >= ids.length) {
    return;
  }
  [ids[sourceIndex], ids[targetSourceIndex]] = [ids[targetSourceIndex], ids[sourceIndex]];
  saveSetlists(setlists);
  renderSongs();
}

function loadSong(song: LibrarySong): void {
  Object.assign(settings, structuredClone(song.settings));
  setBpm(settings.bpm);
  renderLamps();
  syncInputs();
  persist();
  songTitle.value = song.title;
  songArtist.value = song.artist;
  songBand.value = song.band ?? "";
  ui.activeSongId = song.id;
  saveUi();
  renderSongs();
  announce(`Loaded ${song.title}`);
}

function stepSong(delta: number): void {
  const songs = activeSongs();
  if (songs.length === 0) return;
  const idx = songs.findIndex((s) => s.id === ui.activeSongId);
  const next =
    idx < 0
      ? delta > 0
        ? 0
        : songs.length - 1
      : Math.min(songs.length - 1, Math.max(0, idx + delta));
  if (next === idx) return;
  loadSong(songs[next]);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function libraryReferenceCount(songId: string): number {
  return setlists.reduce(
    (count, setlist) => count + setlist.songIds.filter((id) => id === songId).length,
    0,
  );
}

function unusedLibrarySongs(): LibrarySong[] {
  return library.filter((song) => libraryReferenceCount(song.id) === 0);
}

function setLibraryStatus(message: string): void {
  libraryStatus.textContent = message;
  announce(message);
}

function renderLibrary(): void {
  const query = librarySearch.value.trim().toLocaleLowerCase();
  const active = activeSetlist();
  const matches = library.filter((song) =>
    [song.title, song.artist, song.band ?? ""].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  );
  libraryList.innerHTML = "";
  for (const song of matches) {
    const references = libraryReferenceCount(song.id);
    const item = document.createElement("li");
    const details = document.createElement("div");
    details.className = "library-song-details";
    const title = document.createElement("strong");
    title.textContent = song.title;
    const secondary = document.createElement("span");
    secondary.textContent = [song.artist, song.band].filter(Boolean).join(" / ") || "No artist or Band";
    const meta = document.createElement("span");
    meta.className = "preset-meta";
    meta.textContent = `${song.settings.bpm} BPM, ${references} ${references === 1 ? "reference" : "references"}`;
    details.append(title, secondary, meta);

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Add to setlist";
    add.disabled = active?.songIds.includes(song.id) ?? false;
    add.setAttribute("aria-label", `Add ${song.title} to setlist`);
    if (add.disabled) add.title = "Already in the active setlist";
    add.addEventListener("click", () => {
      const target = ensureActiveSetlist();
      if (target.songIds.includes(song.id)) return;
      target.songIds.push(song.id);
      saveSetlists(setlists);
      saveUi();
      renderSetlists();
      renderLibrary();
      setLibraryStatus(`Added ${song.title} to ${target.name}`);
    });
    item.append(details, add);
    libraryList.appendChild(item);
  }

  libraryResultsSummary.textContent = matches.length === 0
    ? query ? "No songs match this search." : "No songs are saved in the library."
    : `${matches.length} ${matches.length === 1 ? "song" : "songs"}`;
  const unusedCount = unusedLibrarySongs().length;
  removeUnusedButton.disabled = unusedCount === 0;
  removeUnusedButton.textContent = unusedCount === 0
    ? "Remove unused songs"
    : `Remove ${unusedCount} unused ${unusedCount === 1 ? "song" : "songs"}`;
}

$("library-open").addEventListener("click", (event) => {
  libraryOpener = event.currentTarget as HTMLElement;
  librarySearch.value = "";
  libraryStatus.textContent = "";
  renderLibrary();
  libraryDialog.showModal();
  librarySearch.focus();
});

$("library-close").addEventListener("click", () => libraryDialog.close());
libraryDialog.addEventListener("close", () => {
  libraryOpener?.focus();
  libraryOpener = null;
});
libraryDialog.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = [...libraryDialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), select:not(:disabled)',
  )].filter((element) => !element.hidden);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
librarySearch.addEventListener("input", renderLibrary);

removeUnusedButton.addEventListener("click", () => {
  const unused = unusedLibrarySongs();
  if (unused.length === 0) return;
  const label = `${unused.length} unused ${unused.length === 1 ? "song" : "songs"}`;
  if (!window.confirm(`Remove ${label} from the library? This cannot be undone.`)) return;
  const removedIds = new Set(unused.map((song) => song.id));
  for (let index = library.length - 1; index >= 0; index -= 1) {
    if (removedIds.has(library[index].id)) library.splice(index, 1);
  }
  if (ui.activeSongId && removedIds.has(ui.activeSongId)) {
    ui.activeSongId = null;
    clearSongEditor();
    saveUi();
  }
  saveLibrary(library);
  renderSetlists();
  renderLibrary();
  setLibraryStatus(`Removed ${label} from the library`);
});

$("backup-export").addEventListener("click", () => {
  const payload = createBackupPayload();
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ggcoder-metronome-backup-${payload.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  setLibraryStatus("Backup exported");
});

$("backup-restore").addEventListener("click", () => backupFile.click());
backupFile.addEventListener("change", async () => {
  const file = backupFile.files?.[0];
  backupFile.value = "";
  if (!file) return;
  try {
    const payload = parseBackupPayload(await file.text());
    if (!window.confirm("Restore this backup? This replaces the current library, setlists, metronome settings, interface preferences, and Timing Lab history in this browser.")) {
      setLibraryStatus("Restore canceled. Current local data was not changed.");
      return;
    }
    restoreBackupPayload(payload);
    setLibraryStatus("Backup restored. Reloading the metronome.");
    window.location.reload();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The backup could not be restored.";
    const rollbackFailed = message.includes("could not be fully rolled back");
    setLibraryStatus(rollbackFailed ? message : `${message} Current local data was not changed.`);
  }
});

setlistSelect.addEventListener("change", () => setActiveSetlist(setlistSelect.value));

$("setlist-new").addEventListener("click", () => {
  const name = window.prompt("New setlist name", `Setlist ${setlists.length + 1}`)?.trim();
  if (!name) return;
  const sl: Setlist = { id: crypto.randomUUID(), name, songIds: [] };
  setlists.push(sl);
  saveSetlists(setlists);
  setActiveSetlist(sl.id);
  announce(`Created setlist ${name}`);
});

$("setlist-rename").addEventListener("click", () => {
  const active = activeSetlist();
  if (!active) return;
  const name = window.prompt("Rename setlist", active.name)?.trim();
  if (!name) return;
  active.name = name;
  saveSetlists(setlists);
  renderSetlists();
});

$("setlist-delete").addEventListener("click", () => {
  const active = activeSetlist();
  if (!active) return;
  const count = active.songIds.length;
  if (!window.confirm(`Delete setlist "${active.name}"${count ? ` and its ${count} song ${count === 1 ? "reference" : "references"}` : ""}? Songs stay in the library.`))
    return;
  setlists = setlists.filter((s) => s.id !== active.id);
  saveSetlists(setlists);
  setActiveSetlist(setlists[0]?.id ?? null);
  announce(`Deleted ${active.name}`);
});

function ensureActiveSetlist(): Setlist {
  const current = activeSetlist();
  if (current) return current;
  const created = { id: crypto.randomUUID(), name: "Setlist 1", songIds: [] };
  setlists.push(created);
  ui.activeSetlistId = created.id;
  return created;
}

function currentSongMetadata(): Pick<LibrarySong, "title" | "artist" | "band"> {
  const title = songTitle.value.trim() || `${settings.bpm} BPM`;
  const artist = songArtist.value.trim();
  const band = songBand.value.trim();
  return { title, artist, ...(band ? { band } : {}) };
}

$("song-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const active = ensureActiveSetlist();
  const metadata = currentSongMetadata();
  const song: LibrarySong = {
    id: crypto.randomUUID(),
    ...metadata,
    settings: structuredClone(settings),
  };
  library.push(song);
  active.songIds.push(song.id);
  ui.activeSongId = song.id;
  songTitle.value = song.title;
  songArtist.value = song.artist;
  songBand.value = song.band ?? "";
  saveLibrary(library);
  saveSetlists(setlists);
  saveUi();
  renderSetlists();
  announce(`Saved new song ${song.title}`);
});

songUpdate.addEventListener("click", () => {
  const loaded = library.find((song) => song.id === ui.activeSongId);
  if (!loaded) return;
  const previousTitle = loaded.title;
  const metadata = currentSongMetadata();
  loaded.title = metadata.title;
  loaded.artist = metadata.artist;
  if (metadata.band) loaded.band = metadata.band;
  else delete loaded.band;
  loaded.settings = structuredClone(settings);
  saveLibrary(library);
  renderSetlists();
  announce(`Updated loaded song ${loaded.title}${loaded.title !== previousTitle ? `, previously ${previousTitle}` : ""}`);
});

for (const button of previousSongButtons) {
  button.addEventListener("click", () => stepSong(-1));
}
for (const button of nextSongButtons) {
  button.addEventListener("click", () => stepSong(1));
}

function syncInputs(): void {
  $<HTMLInputElement>("beats").value = String(settings.beatsPerBar);
  for (const { key } of LAYERS) {
    $<HTMLInputElement>(`mix-${key}`).value = String(Math.round(settings.mix[key] * 100));
  }
  voiceSel.value = settings.voice;
  $<HTMLInputElement>("master").value = String(Math.round(settings.masterVolume * 100));
  $<HTMLInputElement>("gap-on").checked = settings.gap.enabled;
  $<HTMLInputElement>("gap-play").value = String(settings.gap.playBars);
  $<HTMLInputElement>("gap-mute").value = String(settings.gap.muteBars);
  $<HTMLInputElement>("sp-on").checked = settings.speed.enabled;
  $<HTMLInputElement>("sp-to").value = String(settings.speed.toBpm);
  $<HTMLInputElement>("sp-step").value = String(settings.speed.stepBpm);
  $<HTMLInputElement>("sp-every").value = String(settings.speed.everyBars);
}

renderSetlists();
const initiallyLoadedSong = activeSongs().find((song) => song.id === ui.activeSongId);
if (initiallyLoadedSong) {
  songTitle.value = initiallyLoadedSong.title;
  songArtist.value = initiallyLoadedSong.artist;
  songBand.value = initiallyLoadedSong.band ?? "";
} else if (ui.activeSongId) {
  ui.activeSongId = null;
  saveUi();
  renderSongs();
}

/* ---------- Collapsible pillars & panels ---------- */

const mainShell = $<HTMLElement>("main-shell");

function bindPillar(
  railId: string,
  pillarId: string,
  bodyId: string,
  key: "setlistPaneHidden" | "satellitesPaneHidden",
  shellClass: string,
): void {
  const rail = $<HTMLButtonElement>(railId);
  const pillar = $(pillarId);
  const body = $(bodyId);
  const apply = (): void => {
    const hidden = ui[key];
    pillar.classList.toggle("collapsed", hidden);
    mainShell.classList.toggle(shellClass, hidden);
    body.hidden = hidden;
    rail.setAttribute("aria-expanded", String(!hidden));
  };
  rail.addEventListener("click", () => {
    ui[key] = !ui[key];
    saveUi();
    apply();
  });
  apply();
}

bindPillar("rail-setlist", "pillar-setlist", "pillar-setlist-body", "setlistPaneHidden", "setlist-hidden");
bindPillar("rail-satellites", "pillar-satellites", "pillar-satellites-body", "satellitesPaneHidden", "satellites-hidden");

function bindPanelToggle(toggleId: string, bodyId: string, panelKey: string): void {
  const toggle = $<HTMLButtonElement>(toggleId);
  const body = $(bodyId);
  const apply = (): void => {
    const collapsed = ui.collapsedPanels.includes(panelKey);
    body.hidden = collapsed;
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  toggle.addEventListener("click", () => {
    ui.collapsedPanels = ui.collapsedPanels.includes(panelKey)
      ? ui.collapsedPanels.filter((k) => k !== panelKey)
      : [...ui.collapsedPanels, panelKey];
    saveUi();
    apply();
  });
  apply();
}

bindPanelToggle("toggle-mixer", "mixer-body", "mixer");
bindPanelToggle("toggle-sound", "sound-body", "sound");
bindPanelToggle("toggle-trainers", "trainers-body", "trainers");

/* ---------- Transport + visuals ---------- */

function announce(msg: string): void {
  srStatus.textContent = msg;
}

function renderPlaybackState(running: boolean): void {
  engineState.textContent = running ? "Running" : "Ready";
  engineState.dataset.state = running ? "running" : "ready";
  for (const button of [startStop, mobileStartStop]) {
    button.textContent = running ? "Stop" : "Start";
    button.setAttribute("aria-pressed", String(running));
  }
  if (!running) {
    bpmValue.textContent = String(settings.bpm);
    mobileBpmValue.textContent = String(settings.bpm);
  }
  syncAnalysisMode();
}

let transportTransitioning = false;

async function toggle(): Promise<void> {
  if (transportTransitioning) return;
  transportTransitioning = true;
  startStop.disabled = true;
  mobileStartStop.disabled = true;
  try {
    if (engine.running) {
      engine.stop();
      renderPlaybackState(false);
      trainerStatus.textContent = "";
      announce("Stopped");
      clearLamps();
      return;
    }

    try {
      engineState.textContent = "Starting audio";
      engineState.dataset.state = "pending";
      await engine.start();
      renderPlaybackState(true);
      announce("Started");
    } catch {
      engine.stop();
      renderPlaybackState(false);
      engineState.textContent = "Audio unavailable";
      engineState.dataset.state = "error";
      trainerStatus.textContent = "Audio could not start. Check browser audio permissions and try again.";
      announce("Audio could not start. Check browser audio permissions, then press Start to retry.");
      clearLamps();
    }
  } finally {
    transportTransitioning = false;
    startStop.disabled = false;
    mobileStartStop.disabled = false;
  }
}

startStop.addEventListener("click", () => void toggle());
mobileStartStop.addEventListener("click", () => void toggle());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  engine.resync();
  clearLamps();
});

function clearLamps(): void {
  lampsEl.querySelectorAll(".lamp").forEach((l) => l.classList.remove("lit", "lit-muted"));
}

function tick(): void {
  const due = engine.takeDueVisuals();
  const latest = due[due.length - 1];
  if (latest) {
    clearLamps();
    const lamp = lampsEl.querySelector(`[data-beat="${latest.beat}"]`);
    lamp?.classList.add(latest.muted ? "lit-muted" : "lit");
    if (latest.bpm !== Number(bpmValue.textContent)) {
      bpmValue.textContent = String(latest.bpm);
      mobileBpmValue.textContent = String(latest.bpm);
    }
    const parts: string[] = [`Bar ${latest.bar + 1}`];
    if (settings.gap.enabled) parts.push(latest.muted ? "gap: silent, keep counting" : "gap: playing");
    if (settings.speed.enabled) parts.push(`ramping to ${settings.speed.toBpm} BPM`);
    trainerStatus.textContent =
      settings.gap.enabled || settings.speed.enabled ? parts.join(" - ") : "";
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ---------- Keyboard shortcuts ---------- */

document.addEventListener("keydown", (e) => {
  if (libraryDialog.open || calibrationDialog.open) return;
  const target = e.target as HTMLElement;
  const typing =
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement;
  if (typing && target instanceof HTMLInputElement && target.type === "text") return;
  switch (e.key) {
    case " ":
      if (typing) return;
      if (target instanceof HTMLButtonElement && target !== startStop && target !== mobileStartStop) return;
      e.preventDefault();
      void toggle();
      break;
    case "ArrowUp":
      if (typing) return;
      e.preventDefault();
      setBpm(settings.bpm + 1);
      break;
    case "ArrowDown":
      if (typing) return;
      e.preventDefault();
      setBpm(settings.bpm - 1);
      break;
    case "ArrowRight":
      if (typing) return;
      e.preventDefault();
      setBpm(settings.bpm + 5);
      break;
    case "ArrowLeft":
      if (typing) return;
      e.preventDefault();
      setBpm(settings.bpm - 5);
      break;
    case "t":
    case "T": {
      if (typing || !ui.singleKeyShortcutsEnabled) return;
      const bpm = tapTempo.tap(performance.now());
      if (bpm !== null) setBpm(bpm);
      break;
    }
    case "n":
    case "N":
      if (typing || !ui.singleKeyShortcutsEnabled) return;
      stepSong(1);
      break;
    case "p":
    case "P":
      if (typing || !ui.singleKeyShortcutsEnabled) return;
      stepSong(-1);
      break;
  }
});
