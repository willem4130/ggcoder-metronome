import "./style.css";
import { MetronomeEngine } from "./engine";
import {
  defaultAccents,
  loadLastSettings,
  loadPresets,
  saveLastSettings,
  savePresets,
  type BeatAccent,
  type Preset,
  type Settings,
  type Voice,
} from "./state";
import { clampBpm, MAX_BPM, MIN_BPM, TapTempo, type Layer } from "./timing";

const settings: Settings = loadLastSettings();
let presets: Preset[] = loadPresets();
const engine = new MetronomeEngine(() => settings);
const tapTempo = new TapTempo();

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="shell">
    <h1>GGCoder Metronome<span class="subtitle">drummer's metronome</span></h1>
  </header>
  <main class="shell">
    <section class="panel tempo" aria-label="Tempo">
      <p class="bpm-readout" id="bpm-readout" aria-live="off">
        <span id="bpm-value">${settings.bpm}</span>
        <span class="bpm-label" id="bpm-label">BPM</span>
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
      <p class="visually-hidden" role="status" id="sr-status"></p>
    </section>

    <section class="panel" aria-labelledby="mixer-h">
      <h2 id="mixer-h">Subdivision mixer</h2>
      <div class="mixer" id="mixer"></div>
    </section>

    <section class="panel" aria-labelledby="sound-h">
      <h2 id="sound-h">Sound</h2>
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
    </section>

    <section class="panel" aria-labelledby="trainers-h">
      <h2 id="trainers-h">Trainers</h2>
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
      <div class="field-row" style="margin-top: var(--gap-2)">
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
    </section>

    <section class="panel" aria-labelledby="presets-h">
      <h2 id="presets-h">Presets</h2>
      <div class="field-row">
        <div class="field" style="flex:1">
          <label for="preset-name">Name</label>
          <input type="text" id="preset-name" placeholder="e.g. Tom Sawyer bridge"
            style="width:100%; min-height:44px; font:inherit; color:var(--text);
            background:var(--surface-2); border:1px solid var(--border);
            border-radius:var(--radius); padding:0 var(--gap-1)" />
        </div>
        <button type="button" id="preset-save">Save preset</button>
      </div>
      <ul class="preset-list" id="preset-list" style="margin-top: var(--gap-2)"></ul>
      <p class="empty-note" id="preset-empty">No presets yet. Dial in a groove and save it.</p>
    </section>

    <p class="shortcuts">
      <kbd>Space</kbd> start/stop &nbsp; <kbd>&uarr;</kbd><kbd>&darr;</kbd> &plusmn;1 BPM &nbsp;
      <kbd>&larr;</kbd><kbd>&rarr;</kbd> &plusmn;5 BPM &nbsp; <kbd>T</kbd> tap tempo
    </p>
  </main>
`;

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const bpmValue = $<HTMLSpanElement>("bpm-value");
const bpmSlider = $<HTMLInputElement>("bpm-slider");
const startStop = $<HTMLButtonElement>("startstop");
const lampsEl = $<HTMLDivElement>("lamps");
const srStatus = $<HTMLParagraphElement>("sr-status");
const trainerStatus = $<HTMLParagraphElement>("trainer-status");

function persist(): void {
  saveLastSettings(settings);
}

/* ---------- Tempo ---------- */

function setBpm(bpm: number): void {
  settings.bpm = clampBpm(bpm);
  bpmValue.textContent = String(settings.bpm);
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
    const n = Number(el.value);
    if (Number.isFinite(n)) {
      apply(n);
      persist();
    }
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

/* ---------- Presets ---------- */

const presetList = $<HTMLUListElement>("preset-list");
const presetEmpty = $<HTMLParagraphElement>("preset-empty");
const presetName = $<HTMLInputElement>("preset-name");

function renderPresets(): void {
  presetList.innerHTML = "";
  presetEmpty.hidden = presets.length > 0;
  presets.forEach((p, i) => {
    const li = document.createElement("li");
    const load = document.createElement("button");
    load.type = "button";
    load.className = "preset-load";
    load.innerHTML = `<span>${escapeHtml(p.name)}</span>
      <span class="preset-meta">${p.settings.bpm} BPM &middot; ${p.settings.beatsPerBar}/4</span>`;
    load.setAttribute("aria-label", `Load preset ${p.name}, ${p.settings.bpm} BPM`);
    load.addEventListener("click", () => {
      Object.assign(settings, structuredClone(p.settings));
      setBpm(settings.bpm);
      renderLamps();
      syncInputs();
      persist();
      announce(`Loaded ${p.name}`);
    });
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete preset ${p.name}`);
    del.addEventListener("click", () => {
      presets.splice(i, 1);
      savePresets(presets);
      renderPresets();
    });
    li.append(load, del);
    presetList.appendChild(li);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

$("preset-save").addEventListener("click", () => {
  const name = presetName.value.trim() || `${settings.bpm} BPM`;
  const existing = presets.findIndex((p) => p.name === name);
  const preset: Preset = { name, settings: structuredClone(settings) };
  if (existing >= 0) presets[existing] = preset;
  else presets.push(preset);
  savePresets(presets);
  presetName.value = "";
  renderPresets();
  announce(`Saved ${name}`);
});

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

renderPresets();

/* ---------- Transport + visuals ---------- */

function announce(msg: string): void {
  srStatus.textContent = msg;
}

async function toggle(): Promise<void> {
  if (engine.running) {
    engine.stop();
    startStop.textContent = "Start";
    startStop.setAttribute("aria-pressed", "false");
    trainerStatus.textContent = "";
    announce("Stopped");
    clearLamps();
  } else {
    await engine.start();
    startStop.textContent = "Stop";
    startStop.setAttribute("aria-pressed", "true");
    announce("Started");
  }
}

startStop.addEventListener("click", () => void toggle());

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
  const target = e.target as HTMLElement;
  const typing =
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement;
  if (typing && target instanceof HTMLInputElement && target.type === "text") return;
  switch (e.key) {
    case " ":
      if (typing) return;
      if (target instanceof HTMLButtonElement && target !== startStop) return;
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
      if (typing) return;
      const bpm = tapTempo.tap(performance.now());
      if (bpm !== null) setBpm(bpm);
      break;
    }
  }
});
