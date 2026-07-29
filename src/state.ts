import type { GapTrainer, SpeedTrainer, SubdivisionMix } from "./timing";

export type Voice = "click" | "wood" | "beep";

/** Per-beat behavior, cycled by tapping a beat lamp. */
export type BeatAccent = "accent" | "normal" | "mute";

export interface Settings {
  bpm: number;
  beatsPerBar: number;
  accents: BeatAccent[];
  mix: SubdivisionMix;
  voice: Voice;
  masterVolume: number;
  gap: GapTrainer;
  speed: SpeedTrainer;
}

export function defaultAccents(beats: number): BeatAccent[] {
  return Array.from({ length: beats }, (_, i) => (i === 0 ? "accent" : "normal"));
}

export function defaultSettings(): Settings {
  return {
    bpm: 120,
    beatsPerBar: 4,
    accents: defaultAccents(4),
    mix: { quarter: 1, eighth: 0, sixteenth: 0, triplet: 0 },
    voice: "click",
    masterVolume: 0.8,
    gap: { enabled: false, playBars: 4, muteBars: 2 },
    speed: { enabled: false, toBpm: 180, stepBpm: 2, everyBars: 4 },
  };
}

export interface Preset {
  name: string;
  settings: Settings;
}

export interface Song {
  id: string;
  name: string;
  settings: Settings;
}

export interface Setlist {
  id: string;
  name: string;
  songs: Song[];
}

/** Collapsible-pane flags + last active setlist/song, persisted across sessions. */
export interface UiState {
  setlistPaneHidden: boolean;
  satellitesPaneHidden: boolean;
  collapsedPanels: string[];
  activeSetlistId: string | null;
  activeSongId: string | null;
}

const PRESETS_KEY = "ggcoder-metronome.presets.v1";
const LAST_KEY = "ggcoder-metronome.last.v1";
const SETLISTS_KEY = "ggcoder-metronome.setlists.v1";
const UI_KEY = "ggcoder-metronome.ui.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Loads setlists, migrating legacy presets once: if no setlists exist yet but
 * old presets do, they become songs in a setlist named "My presets".
 * The legacy presets key is left untouched as a backup.
 */
export function loadSetlists(): Setlist[] {
  const existing = safeParse<Setlist[]>(localStorage.getItem(SETLISTS_KEY));
  if (existing) return existing;
  const legacy = safeParse<Preset[]>(localStorage.getItem(PRESETS_KEY));
  if (legacy && legacy.length > 0) {
    const migrated: Setlist[] = [
      {
        id: crypto.randomUUID(),
        name: "My presets",
        songs: legacy.map((p) => ({
          id: crypto.randomUUID(),
          name: p.name,
          settings: { ...defaultSettings(), ...p.settings },
        })),
      },
    ];
    saveSetlists(migrated);
    return migrated;
  }
  return [];
}

export function saveSetlists(setlists: Setlist[]): void {
  localStorage.setItem(SETLISTS_KEY, JSON.stringify(setlists));
}

export function defaultUiState(): UiState {
  return {
    setlistPaneHidden: false,
    satellitesPaneHidden: false,
    collapsedPanels: [],
    activeSetlistId: null,
    activeSongId: null,
  };
}

export function loadUiState(): UiState {
  const saved = safeParse<Partial<UiState>>(localStorage.getItem(UI_KEY));
  return saved ? { ...defaultUiState(), ...saved } : defaultUiState();
}

export function saveUiState(ui: UiState): void {
  localStorage.setItem(UI_KEY, JSON.stringify(ui));
}

export function loadLastSettings(): Settings {
  const saved = safeParse<Settings>(localStorage.getItem(LAST_KEY));
  return saved ? { ...defaultSettings(), ...saved } : defaultSettings();
}

export function saveLastSettings(settings: Settings): void {
  localStorage.setItem(LAST_KEY, JSON.stringify(settings));
}
