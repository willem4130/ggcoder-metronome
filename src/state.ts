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

/** A song saved once in the shared library; setlists reference it by id. */
export interface LibrarySong {
  id: string;
  title: string;
  /** Empty string when unknown. */
  artist: string;
  /** Optional tag, e.g. "Cover band". */
  band?: string;
  settings: Settings;
}

/** Legacy v1 embedded-song shape, kept only for migration. */
export interface SongV1 {
  id: string;
  name: string;
  settings: Settings;
}

/** Legacy v1 setlist shape, kept only for migration. */
export interface SetlistV1 {
  id: string;
  name: string;
  songs: SongV1[];
}

export interface Setlist {
  id: string;
  name: string;
  /** Ordered references into the song library. */
  songIds: string[];
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
const SETLISTS_V1_KEY = "ggcoder-metronome.setlists.v1";
const SETLISTS_KEY = "ggcoder-metronome.setlists.v2";
const LIBRARY_KEY = "ggcoder-metronome.library.v1";
const UI_KEY = "ggcoder-metronome.ui.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadLibrary(): LibrarySong[] {
  return safeParse<LibrarySong[]>(localStorage.getItem(LIBRARY_KEY)) ?? [];
}

export function saveLibrary(songs: LibrarySong[]): void {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(songs));
}

/** Maps a setlist's song ids to library entries, silently dropping dangling ids. */
export function resolveSongs(
  setlist: Setlist | null,
  library: LibrarySong[],
): LibrarySong[] {
  if (!setlist) return [];
  const byId = new Map(library.map((s) => [s.id, s]));
  return setlist.songIds
    .map((id) => byId.get(id))
    .filter((s): s is LibrarySong => s !== undefined);
}

/**
 * Migrates v1 setlists (embedded songs) to the library + v2 model.
 * Song ids are preserved so `ui.activeSongId` stays valid; songs with the
 * same title and identical settings collapse into one library entry.
 * Persists both the library and the v2 setlists.
 */
function migrateV1Setlists(v1: SetlistV1[]): Setlist[] {
  const library = loadLibrary();
  const idByKey = new Map<string, string>();
  for (const song of library) {
    idByKey.set(`${song.title}\u0000${JSON.stringify(song.settings)}`, song.id);
  }
  const migrated: Setlist[] = v1.map((sl) => ({
    id: sl.id,
    name: sl.name,
    songIds: sl.songs.map((song) => {
      const settings = { ...defaultSettings(), ...song.settings };
      const key = `${song.name}\u0000${JSON.stringify(settings)}`;
      const existingId = idByKey.get(key);
      if (existingId) return existingId;
      library.push({ id: song.id, title: song.name, artist: "", settings });
      idByKey.set(key, song.id);
      return song.id;
    }),
  }));
  saveLibrary(library);
  saveSetlists(migrated);
  return migrated;
}

/**
 * Loads v2 setlists, migrating older data once. Chain: v2 → v1 setlists
 * (embedded songs become library entries, ids preserved) → legacy presets
 * (wrapped as a "My presets" setlist, then migrated the same way).
 * Old keys are never deleted — they remain as backups.
 */
export function loadSetlists(): Setlist[] {
  const existing = safeParse<Setlist[]>(localStorage.getItem(SETLISTS_KEY));
  if (existing) return existing;
  const v1 = safeParse<SetlistV1[]>(localStorage.getItem(SETLISTS_V1_KEY));
  if (v1) return migrateV1Setlists(v1);
  const legacy = safeParse<Preset[]>(localStorage.getItem(PRESETS_KEY));
  if (legacy && legacy.length > 0) {
    return migrateV1Setlists([
      {
        id: crypto.randomUUID(),
        name: "My presets",
        songs: legacy.map((p) => ({
          id: crypto.randomUUID(),
          name: p.name,
          settings: { ...defaultSettings(), ...p.settings },
        })),
      },
    ]);
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
