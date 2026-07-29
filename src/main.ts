import "./style.css";
import { MetronomeEngine } from "./engine";
import {
  defaultAccents,
  loadLastSettings,
  loadLibrary,
  loadSetlists,
  loadUiState,
  resolveSongs,
  saveLastSettings,
  saveLibrary,
  saveSetlists,
  saveUiState,
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

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="shell">
    <h1>GGCoder Metronome<span class="subtitle">drummer's metronome</span></h1>
  </header>
  <main class="shell" id="main-shell">
    <div class="pillar pillar-metronome">
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

    <div class="pillar" id="pillar-setlist">
      <button type="button" class="pillar-rail" id="rail-setlist"
        aria-expanded="true" aria-controls="pillar-setlist-body">
        <span class="rail-label">Setlist</span>
        <span class="rail-chevron" aria-hidden="true">&#9662;</span>
      </button>
      <div class="pillar-body" id="pillar-setlist-body">
        <section class="panel" aria-labelledby="setlist-h">
          <h2 id="setlist-h">Setlist</h2>
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
          </div>
          <ol class="song-list" id="song-list"></ol>
          <p class="empty-note" id="song-empty">No songs yet. Dial in a groove and save it.</p>
          <div class="song-form">
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
            <button type="button" id="song-save">Save song</button>
          </div>
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
    <section class="panel" aria-labelledby="mixer-h">
      <h2><button type="button" class="panel-toggle" id="toggle-mixer"
        aria-expanded="true" aria-controls="mixer-body">
        <span id="mixer-h">Subdivision mixer</span>
        <span class="rail-chevron" aria-hidden="true">&#9662;</span>
      </button></h2>
      <div class="panel-body" id="mixer-body">
        <div class="mixer" id="mixer"></div>
      </div>
    </section>

    <section class="panel" aria-labelledby="sound-h">
      <h2><button type="button" class="panel-toggle" id="toggle-sound"
        aria-expanded="true" aria-controls="sound-body">
        <span id="sound-h">Sound</span>
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
      </div>
    </section>

    <section class="panel" aria-labelledby="trainers-h">
      <h2><button type="button" class="panel-toggle" id="toggle-trainers"
        aria-expanded="true" aria-controls="trainers-body">
        <span id="trainers-h">Trainers</span>
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
      </div>
    </section>
      </div>
    </div>

    <p class="shortcuts">
      <kbd>Space</kbd> start/stop &nbsp; <kbd>&uarr;</kbd><kbd>&darr;</kbd> &plusmn;1 BPM &nbsp;
      <kbd>&larr;</kbd><kbd>&rarr;</kbd> &plusmn;5 BPM &nbsp; <kbd>T</kbd> tap tempo &nbsp;
      <kbd>N</kbd>/<kbd>P</kbd> next/prev song
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

/* ---------- Setlists ---------- */

const setlistSelect = $<HTMLSelectElement>("setlist-select");
const songList = $<HTMLOListElement>("song-list");
const songEmpty = $<HTMLParagraphElement>("song-empty");
const songTitle = $<HTMLInputElement>("song-title");
const songArtist = $<HTMLInputElement>("song-artist");
const songBand = $<HTMLInputElement>("song-band");
const faceTransport = $<HTMLDivElement>("face-transport");
const transportNow = $<HTMLParagraphElement>("transport-now");
const transportNext = $<HTMLParagraphElement>("transport-next");

function saveUi(): void {
  saveUiState(ui);
}

function activeSetlist(): Setlist | null {
  return setlists.find((s) => s.id === ui.activeSetlistId) ?? setlists[0] ?? null;
}

function setActiveSetlist(id: string | null): void {
  ui.activeSetlistId = id;
  ui.activeSongId = null;
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
  if (active) setlistSelect.value = active.id;
  renderSongs();
}

function activeSongs(): LibrarySong[] {
  return resolveSongs(activeSetlist(), library);
}

function songLabel(song: LibrarySong): string {
  return song.artist ? `${song.title} \u2014 ${song.artist}` : song.title;
}

function renderSongs(): void {
  const songs = activeSongs();
  songList.innerHTML = "";
  songEmpty.hidden = songs.length > 0;
  songs.forEach((song, i) => {
    const li = document.createElement("li");
    if (song.id === ui.activeSongId) li.classList.add("active");

    const load = document.createElement("button");
    load.type = "button";
    load.className = "song-load";
    load.innerHTML = `<span class="song-order">${i + 1}</span>
      <span class="song-main">
        <span class="song-title">${escapeHtml(song.title)}</span>
        ${song.artist ? `<span class="song-artist">${escapeHtml(song.artist)}</span>` : ""}
      </span>
      ${song.band ? `<span class="song-band">${escapeHtml(song.band)}</span>` : ""}
      <span class="preset-meta">${song.settings.bpm} BPM</span>`;
    load.setAttribute("aria-label", `Load song ${songLabel(song)}, ${song.settings.bpm} BPM`);
    load.addEventListener("click", () => loadSong(song));

    const up = document.createElement("button");
    up.type = "button";
    up.className = "song-move";
    up.textContent = "\u2191";
    up.disabled = i === 0;
    up.setAttribute("aria-label", `Move ${song.title} up`);
    up.addEventListener("click", () => moveSong(i, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "song-move";
    down.textContent = "\u2193";
    down.disabled = i === songs.length - 1;
    down.setAttribute("aria-label", `Move ${song.title} down`);
    down.addEventListener("click", () => moveSong(i, 1));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "song-move";
    del.textContent = "\u2715";
    del.setAttribute("aria-label", `Remove ${song.title} from setlist`);
    del.addEventListener("click", () => {
      const active = activeSetlist();
      if (!active) return;
      active.songIds.splice(i, 1);
      if (ui.activeSongId === song.id) {
        ui.activeSongId = null;
        saveUi();
      }
      saveSetlists(setlists);
      renderSongs();
    });

    li.append(load, up, down, del);
    songList.appendChild(li);
  });
  renderTransport(songs);
}

function renderTransport(songs: LibrarySong[]): void {
  faceTransport.hidden = songs.length === 0;
  if (songs.length === 0) return;
  const idx = songs.findIndex((s) => s.id === ui.activeSongId);
  const current = idx >= 0 ? songs[idx] : null;
  const next = idx < 0 ? songs[0] : songs[idx + 1] ?? null;
  transportNow.textContent = current ? songLabel(current) : "No song loaded";
  transportNext.textContent = next ? `Next: ${songLabel(next)}` : "End of setlist";
}

function moveSong(index: number, delta: number): void {
  const ids = activeSetlist()?.songIds ?? [];
  const target = index + delta;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  saveSetlists(setlists);
  renderSongs();
}

function loadSong(song: LibrarySong): void {
  Object.assign(settings, structuredClone(song.settings));
  setBpm(settings.bpm);
  renderLamps();
  syncInputs();
  persist();
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
  if (!window.confirm(`Delete setlist "${active.name}"${count ? ` and its ${count} songs` : ""}? Songs stay in the library.`))
    return;
  setlists = setlists.filter((s) => s.id !== active.id);
  saveSetlists(setlists);
  setActiveSetlist(setlists[0]?.id ?? null);
  announce(`Deleted ${active.name}`);
});

$("song-save").addEventListener("click", () => {
  let active = activeSetlist();
  if (!active) {
    active = { id: crypto.randomUUID(), name: "Setlist 1", songIds: [] };
    setlists.push(active);
    ui.activeSetlistId = active.id;
  }
  const title = songTitle.value.trim() || `${settings.bpm} BPM`;
  const artist = songArtist.value.trim();
  const band = songBand.value.trim();
  const existing = library.find((s) => s.title === title && s.artist === artist);
  let song: LibrarySong;
  if (existing) {
    existing.settings = structuredClone(settings);
    if (band) existing.band = band;
    song = existing;
  } else {
    song = {
      id: crypto.randomUUID(),
      title,
      artist,
      ...(band ? { band } : {}),
      settings: structuredClone(settings),
    };
    library.push(song);
  }
  if (!active.songIds.includes(song.id)) active.songIds.push(song.id);
  ui.activeSongId = song.id;
  saveLibrary(library);
  saveSetlists(setlists);
  saveUi();
  songTitle.value = "";
  songArtist.value = "";
  songBand.value = "";
  renderSetlists();
  announce(`Saved ${title}`);
});

$("song-prev").addEventListener("click", () => stepSong(-1));
$("song-next").addEventListener("click", () => stepSong(1));

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
    case "n":
    case "N":
      if (typing) return;
      stepSong(1);
      break;
    case "p":
    case "P":
      if (typing) return;
      stepSong(-1);
      break;
  }
});
