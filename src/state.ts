import { MAX_BPM, MIN_BPM, type GapTrainer, type SpeedTrainer, type SubdivisionMix } from "./timing";

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
  singleKeyShortcutsEnabled: boolean;
}

export interface ResolvedSongReference {
  song: LibrarySong;
  /** Exact index in Setlist.songIds, including any preceding dangling references. */
  sourceIndex: number;
}

export type AnalysisMode = "metronome" | "free";
export type AnalysisSubdivision = 1 | 2 | 4;
export type AnalysisSensitivity = "low" | "medium" | "high";

export interface AnalysisCalibration {
  offsetMs: number;
  measuredAt: string | null;
  inputDeviceId: string | null;
  quality: "estimated" | "measured";
  stale: boolean;
}

export interface AnalysisPreferences {
  subdivision: AnalysisSubdivision;
  sensitivity: AnalysisSensitivity;
  calibration: AnalysisCalibration;
}

export interface AnalysisSessionRecord {
  id: string;
  recordedAt: string;
  mode: AnalysisMode;
  songId: string | null;
  songTitle: string | null;
  setlistId: string | null;
  setlistName: string | null;
  targetBpm: number | null;
  playedBpm: number | null;
  confidence: number;
  score: number | null;
  meanAbsoluteErrorMs: number | null;
  jitterMs: number | null;
  biasMs: number | null;
  hitCount: number;
  durationSeconds: number;
  subdivision: AnalysisSubdivision;
}

interface BackupPayloadBase {
  exportedAt: string;
  library: LibrarySong[];
  setlists: Setlist[];
  lastSettings: Settings;
  ui: UiState;
}

export interface BackupPayloadV1 extends BackupPayloadBase {
  version: 1;
}

export interface BackupPayloadV2 extends BackupPayloadBase {
  version: 2;
  analysisPreferences: AnalysisPreferences;
  analysisHistory: AnalysisSessionRecord[];
}

export type BackupPayload = BackupPayloadV1 | BackupPayloadV2;

const PRESETS_KEY = "ggcoder-metronome.presets.v1";
const LAST_KEY = "ggcoder-metronome.last.v1";
const SETLISTS_V1_KEY = "ggcoder-metronome.setlists.v1";
const SETLISTS_KEY = "ggcoder-metronome.setlists.v2";
const LIBRARY_KEY = "ggcoder-metronome.library.v1";
const UI_KEY = "ggcoder-metronome.ui.v1";
const ANALYSIS_PREFERENCES_KEY = "ggcoder-metronome.analysis.preferences.v1";
const ANALYSIS_HISTORY_KEY = "ggcoder-metronome.analysis.history.v1";
const MAX_ANALYSIS_HISTORY = 100;
const BACKUP_KEYS = [
  LIBRARY_KEY,
  SETLISTS_KEY,
  LAST_KEY,
  UI_KEY,
  ANALYSIS_PREFERENCES_KEY,
  ANALYSIS_HISTORY_KEY,
] as const;

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.min(max, Math.max(min, value));
  return integer ? Math.round(bounded) : bounded;
}

function normalizedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizedId(value: unknown): string | null {
  const id = normalizedString(value);
  return id.length > 0 ? id : null;
}

function normalizedNullableId(value: unknown): string | null {
  return value === null ? null : normalizedId(value);
}

function normalizedNullableString(value: unknown): string | null {
  if (value === null) return null;
  const text = normalizedString(value);
  return text || null;
}

export function defaultAnalysisPreferences(): AnalysisPreferences {
  return {
    subdivision: 1,
    sensitivity: "medium",
    calibration: {
      offsetMs: 0,
      measuredAt: null,
      inputDeviceId: null,
      quality: "estimated",
      stale: false,
    },
  };
}

export function normalizeAnalysisPreferences(value: unknown): AnalysisPreferences {
  const defaults = defaultAnalysisPreferences();
  const source = isRecord(value) ? value : {};
  const calibration = isRecord(source.calibration) ? source.calibration : {};
  // The prototype stored inputOffsetMs at the top level. Migrate it once.
  const legacyOffset = source.inputOffsetMs;
  const offsetSource = calibration.offsetMs ?? legacyOffset;
  const measuredAt = typeof calibration.measuredAt === "string"
    && !Number.isNaN(Date.parse(calibration.measuredAt))
    ? calibration.measuredAt
    : null;
  return {
    subdivision: source.subdivision === 1 || source.subdivision === 2 || source.subdivision === 4
      ? source.subdivision
      : defaults.subdivision,
    sensitivity: source.sensitivity === "low"
      || source.sensitivity === "medium"
      || source.sensitivity === "high"
      ? source.sensitivity
      : defaults.sensitivity,
    calibration: {
      offsetMs: Math.round(boundedNumber(offsetSource, defaults.calibration.offsetMs, -250, 250)),
      measuredAt,
      inputDeviceId: normalizedNullableId(calibration.inputDeviceId),
      quality: calibration.quality === "measured" && measuredAt !== null
        ? "measured"
        : "estimated",
      stale: typeof calibration.stale === "boolean" ? calibration.stale : false,
    },
  };
}

export function loadAnalysisPreferences(): AnalysisPreferences {
  return normalizeAnalysisPreferences(safeParse(localStorage.getItem(ANALYSIS_PREFERENCES_KEY)));
}

export function saveAnalysisPreferences(preferences: AnalysisPreferences): void {
  localStorage.setItem(
    ANALYSIS_PREFERENCES_KEY,
    JSON.stringify(normalizeAnalysisPreferences(preferences)),
  );
}

function normalizeAnalysisSession(value: unknown): AnalysisSessionRecord | null {
  if (!isRecord(value)) return null;
  const id = normalizedId(value.id);
  const recordedAt = typeof value.recordedAt === "string"
    && !Number.isNaN(Date.parse(value.recordedAt))
    ? value.recordedAt
    : null;
  if (!id || !recordedAt || (value.mode !== "metronome" && value.mode !== "free")) return null;
  const subdivision = value.subdivision === 1 || value.subdivision === 2 || value.subdivision === 4
    ? value.subdivision
    : null;
  if (subdivision === null) return null;
  const nullableMetric = (metric: unknown, minimum: number, maximum: number): number | null => {
    if (metric === null) return null;
    if (typeof metric !== "number" || !Number.isFinite(metric)) return null;
    return Math.min(maximum, Math.max(minimum, metric));
  };
  return {
    id,
    recordedAt,
    mode: value.mode,
    songId: normalizedNullableId(value.songId),
    songTitle: normalizedNullableString(value.songTitle),
    setlistId: normalizedNullableId(value.setlistId),
    setlistName: normalizedNullableString(value.setlistName),
    targetBpm: nullableMetric(value.targetBpm, MIN_BPM, MAX_BPM),
    playedBpm: nullableMetric(value.playedBpm, MIN_BPM, MAX_BPM),
    confidence: boundedNumber(value.confidence, 0, 0, 100),
    score: nullableMetric(value.score, 0, 100),
    meanAbsoluteErrorMs: nullableMetric(value.meanAbsoluteErrorMs, 0, 2_000),
    jitterMs: nullableMetric(value.jitterMs, 0, 2_000),
    biasMs: nullableMetric(value.biasMs, -2_000, 2_000),
    hitCount: boundedNumber(value.hitCount, 0, 0, 1_000_000, true),
    durationSeconds: boundedNumber(value.durationSeconds, 0, 0, 86_400),
    subdivision,
  };
}

export function normalizeAnalysisHistory(value: unknown): AnalysisSessionRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const records: AnalysisSessionRecord[] = [];
  for (const candidate of value) {
    const record = normalizeAnalysisSession(candidate);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return records
    .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt))
    .slice(0, MAX_ANALYSIS_HISTORY);
}

export function loadAnalysisHistory(): AnalysisSessionRecord[] {
  return normalizeAnalysisHistory(safeParse(localStorage.getItem(ANALYSIS_HISTORY_KEY)));
}

export function saveAnalysisHistory(records: AnalysisSessionRecord[]): void {
  localStorage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(normalizeAnalysisHistory(records)));
}

export function saveAnalysisSession(record: AnalysisSessionRecord): AnalysisSessionRecord[] {
  const normalized = normalizeAnalysisSession(record);
  if (!normalized) throw new Error("Cannot save an invalid analysis session.");
  const records = normalizeAnalysisHistory([normalized, ...loadAnalysisHistory()]);
  saveAnalysisHistory(records);
  return records;
}

export function deleteAnalysisSession(id: string): AnalysisSessionRecord[] {
  const records = loadAnalysisHistory().filter((record) => record.id !== id);
  saveAnalysisHistory(records);
  return records;
}

/** Repairs malformed or partial settings without trusting nested persisted objects. */
export function normalizeSettings(value: unknown): Settings {
  const defaults = defaultSettings();
  const source = isRecord(value) ? value : {};
  const beatsPerBar = boundedNumber(source.beatsPerBar, defaults.beatsPerBar, 1, 9, true);
  const mix = isRecord(source.mix) ? source.mix : {};
  const gap = isRecord(source.gap) ? source.gap : {};
  const speed = isRecord(source.speed) ? source.speed : {};
  const sourceAccents = Array.isArray(source.accents) ? source.accents : [];
  const accents = Array.from({ length: beatsPerBar }, (_, index) => {
    const accent = sourceAccents[index];
    return accent === "accent" || accent === "normal" || accent === "mute"
      ? accent
      : defaultAccents(beatsPerBar)[index];
  });

  return {
    bpm: boundedNumber(source.bpm, defaults.bpm, MIN_BPM, MAX_BPM, true),
    beatsPerBar,
    accents,
    mix: {
      quarter: boundedNumber(mix.quarter, defaults.mix.quarter, 0, 1),
      eighth: boundedNumber(mix.eighth, defaults.mix.eighth, 0, 1),
      sixteenth: boundedNumber(mix.sixteenth, defaults.mix.sixteenth, 0, 1),
      triplet: boundedNumber(mix.triplet, defaults.mix.triplet, 0, 1),
    },
    voice: source.voice === "click" || source.voice === "wood" || source.voice === "beep"
      ? source.voice
      : defaults.voice,
    masterVolume: boundedNumber(source.masterVolume, defaults.masterVolume, 0, 1),
    gap: {
      enabled: typeof gap.enabled === "boolean" ? gap.enabled : defaults.gap.enabled,
      playBars: boundedNumber(gap.playBars, defaults.gap.playBars, 1, 32, true),
      muteBars: boundedNumber(gap.muteBars, defaults.gap.muteBars, 1, 32, true),
    },
    speed: {
      enabled: typeof speed.enabled === "boolean" ? speed.enabled : defaults.speed.enabled,
      toBpm: boundedNumber(speed.toBpm, defaults.speed.toBpm, MIN_BPM, MAX_BPM, true),
      stepBpm: boundedNumber(speed.stepBpm, defaults.speed.stepBpm, 1, 20, true),
      everyBars: boundedNumber(speed.everyBars, defaults.speed.everyBars, 1, 32, true),
    },
  };
}

function normalizeLibrarySong(value: unknown): LibrarySong | null {
  if (!isRecord(value)) return null;
  const id = normalizedId(value.id);
  const title = normalizedString(value.title);
  if (!id || !title) return null;
  const band = normalizedString(value.band);
  return {
    id,
    title,
    artist: normalizedString(value.artist),
    ...(band ? { band } : {}),
    settings: normalizeSettings(value.settings),
  };
}

export function normalizeLibrary(value: unknown): LibrarySong[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const songs: LibrarySong[] = [];
  for (const candidate of value) {
    const song = normalizeLibrarySong(candidate);
    if (!song || seen.has(song.id)) continue;
    seen.add(song.id);
    songs.push(song);
  }
  return songs;
}

function normalizeSetlist(value: unknown): Setlist | null {
  if (!isRecord(value)) return null;
  const id = normalizedId(value.id);
  const name = normalizedString(value.name);
  if (!id || !name || !Array.isArray(value.songIds)) return null;
  return {
    id,
    name,
    songIds: value.songIds.map(normalizedId).filter((songId): songId is string => songId !== null),
  };
}

export function normalizeSetlists(value: unknown): Setlist[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const setlists: Setlist[] = [];
  for (const candidate of value) {
    const setlist = normalizeSetlist(candidate);
    if (!setlist || seen.has(setlist.id)) continue;
    seen.add(setlist.id);
    setlists.push(setlist);
  }
  return setlists;
}

export function loadLibrary(): LibrarySong[] {
  return normalizeLibrary(safeParse(localStorage.getItem(LIBRARY_KEY)));
}

export function saveLibrary(songs: LibrarySong[]): void {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(songs));
}

/** Resolves visible songs while retaining each reference's exact source index. */
export function resolveSongReferences(
  setlist: Setlist | null,
  library: LibrarySong[],
): ResolvedSongReference[] {
  if (!setlist) return [];
  const byId = new Map(library.map((song) => [song.id, song]));
  return setlist.songIds.flatMap((id, sourceIndex) => {
    const song = byId.get(id);
    return song ? [{ song, sourceIndex }] : [];
  });
}

export function resolveSongs(setlist: Setlist | null, library: LibrarySong[]): LibrarySong[] {
  return resolveSongReferences(setlist, library).map(({ song }) => song);
}

function normalizeV1Setlists(value: unknown): SetlistV1[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = normalizedId(candidate.id);
    const name = normalizedString(candidate.name);
    if (!id || !name || !Array.isArray(candidate.songs)) return [];
    const songs: SongV1[] = candidate.songs.flatMap((songCandidate) => {
      if (!isRecord(songCandidate)) return [];
      const songId = normalizedId(songCandidate.id);
      const songName = normalizedString(songCandidate.name);
      if (!songId || !songName) return [];
      return [{ id: songId, name: songName, settings: normalizeSettings(songCandidate.settings) }];
    });
    return [{ id, name, songs }];
  });
}

function settingsKey(title: string, settings: Settings): string {
  return `${title}\u0000${JSON.stringify(settings)}`;
}

/**
 * Migrates v1 setlists in two passes so an active duplicate remains canonical.
 * Old storage keys remain untouched as recovery backups.
 */
function migrateV1Setlists(v1: SetlistV1[]): Setlist[] {
  const existingLibrary = loadLibrary();
  const activeSongId = loadUiState().activeSongId;
  const candidates = [
    ...existingLibrary,
    ...v1.flatMap((setlist) =>
      setlist.songs.map((song) => ({
        id: song.id,
        title: song.name,
        artist: "",
        settings: normalizeSettings(song.settings),
      })),
    ),
  ];
  const groups = new Map<string, LibrarySong[]>();
  for (const song of candidates) {
    const key = settingsKey(song.title, song.settings);
    const group = groups.get(key) ?? [];
    group.push(song);
    groups.set(key, group);
  }

  const canonicalIdByCandidate = new Map<string, string>();
  const library: LibrarySong[] = [];
  for (const group of groups.values()) {
    const canonical = group.find((song) => song.id === activeSongId) ?? group[0];
    library.push(canonical);
    for (const song of group) canonicalIdByCandidate.set(song.id, canonical.id);
  }

  const migrated = v1.map((setlist) => ({
    id: setlist.id,
    name: setlist.name,
    songIds: setlist.songs.map((song) => canonicalIdByCandidate.get(song.id) ?? song.id),
  }));
  saveLibrary(library);
  saveSetlists(migrated);
  return migrated;
}

/** Loads v2 setlists, migrating embedded v1 songs or legacy presets once. */
export function loadSetlists(): Setlist[] {
  const existingRaw = safeParse(localStorage.getItem(SETLISTS_KEY));
  if (existingRaw !== null) return normalizeSetlists(existingRaw);

  const v1Raw = safeParse(localStorage.getItem(SETLISTS_V1_KEY));
  if (v1Raw !== null) return migrateV1Setlists(normalizeV1Setlists(v1Raw));

  const legacyRaw = safeParse(localStorage.getItem(PRESETS_KEY));
  if (Array.isArray(legacyRaw) && legacyRaw.length > 0) {
    const presets = legacyRaw.flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      const name = normalizedString(candidate.name);
      if (!name) return [];
      return [{ name, settings: normalizeSettings(candidate.settings) }];
    });
    if (presets.length === 0) return [];
    return migrateV1Setlists([
      {
        id: crypto.randomUUID(),
        name: "My presets",
        songs: presets.map((preset) => ({
          id: crypto.randomUUID(),
          name: preset.name,
          settings: preset.settings,
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
    singleKeyShortcutsEnabled: true,
  };
}

export function normalizeUiState(value: unknown): UiState {
  const defaults = defaultUiState();
  if (!isRecord(value)) return defaults;
  return {
    setlistPaneHidden: typeof value.setlistPaneHidden === "boolean"
      ? value.setlistPaneHidden
      : defaults.setlistPaneHidden,
    satellitesPaneHidden: typeof value.satellitesPaneHidden === "boolean"
      ? value.satellitesPaneHidden
      : defaults.satellitesPaneHidden,
    collapsedPanels: Array.isArray(value.collapsedPanels)
      ? [...new Set(value.collapsedPanels.filter((item): item is string => typeof item === "string"))]
      : defaults.collapsedPanels,
    activeSetlistId: normalizedNullableId(value.activeSetlistId),
    activeSongId: normalizedNullableId(value.activeSongId),
    singleKeyShortcutsEnabled: typeof value.singleKeyShortcutsEnabled === "boolean"
      ? value.singleKeyShortcutsEnabled
      : defaults.singleKeyShortcutsEnabled,
  };
}

export function loadUiState(): UiState {
  return normalizeUiState(safeParse(localStorage.getItem(UI_KEY)));
}

export function saveUiState(ui: UiState): void {
  localStorage.setItem(UI_KEY, JSON.stringify(ui));
}

export function loadLastSettings(): Settings {
  return normalizeSettings(safeParse(localStorage.getItem(LAST_KEY)));
}

export function saveLastSettings(settings: Settings): void {
  localStorage.setItem(LAST_KEY, JSON.stringify(settings));
}

function settingsAreValid(value: unknown): value is Settings {
  if (!isRecord(value)
    || !Array.isArray(value.accents)
    || !isRecord(value.mix)
    || !isRecord(value.gap)
    || !isRecord(value.speed)) {
    return false;
  }
  const normalized = normalizeSettings(value);
  return value.bpm === normalized.bpm
    && value.beatsPerBar === normalized.beatsPerBar
    && JSON.stringify(value.accents) === JSON.stringify(normalized.accents)
    && value.mix.quarter === normalized.mix.quarter
    && value.mix.eighth === normalized.mix.eighth
    && value.mix.sixteenth === normalized.mix.sixteenth
    && value.mix.triplet === normalized.mix.triplet
    && value.voice === normalized.voice
    && value.masterVolume === normalized.masterVolume
    && value.gap.enabled === normalized.gap.enabled
    && value.gap.playBars === normalized.gap.playBars
    && value.gap.muteBars === normalized.gap.muteBars
    && value.speed.enabled === normalized.speed.enabled
    && value.speed.toBpm === normalized.speed.toBpm
    && value.speed.stepBpm === normalized.speed.stepBpm
    && value.speed.everyBars === normalized.speed.everyBars;
}

function uiStateIsValid(value: unknown): value is UiState {
  if (!isRecord(value)) return false;
  const normalized = normalizeUiState(value);
  const candidate = {
    setlistPaneHidden: value.setlistPaneHidden,
    satellitesPaneHidden: value.satellitesPaneHidden,
    collapsedPanels: value.collapsedPanels,
    activeSetlistId: value.activeSetlistId,
    activeSongId: value.activeSongId,
    singleKeyShortcutsEnabled: value.singleKeyShortcutsEnabled,
  };
  return JSON.stringify(candidate) === JSON.stringify(normalized);
}

function libraryIsValid(value: unknown): value is LibrarySong[] {
  if (!Array.isArray(value) || value.length !== normalizeLibrary(value).length) return false;
  const ids = new Set<string>();
  return value.every((candidate) => {
    if (!isRecord(candidate) || !settingsAreValid(candidate.settings)) return false;
    const normalized = normalizeLibrarySong(candidate);
    if (!normalized || ids.has(normalized.id)) return false;
    ids.add(normalized.id);
    return candidate.id === normalized.id
      && candidate.title === normalized.title
      && candidate.artist === normalized.artist
      && candidate.band === normalized.band;
  });
}

function setlistsAreValid(value: unknown): value is Setlist[] {
  if (!Array.isArray(value) || value.length !== normalizeSetlists(value).length) return false;
  const ids = new Set<string>();
  return value.every((candidate) => {
    if (!isRecord(candidate)) return false;
    const normalized = normalizeSetlist(candidate);
    if (!normalized || ids.has(normalized.id)) return false;
    ids.add(normalized.id);
    return candidate.id === normalized.id
      && candidate.name === normalized.name
      && JSON.stringify(candidate.songIds) === JSON.stringify(normalized.songIds);
  });
}

export function createBackupPayload(): BackupPayloadV2 {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    library: loadLibrary(),
    setlists: loadSetlists(),
    lastSettings: loadLastSettings(),
    ui: loadUiState(),
    analysisPreferences: loadAnalysisPreferences(),
    analysisHistory: loadAnalysisHistory(),
  };
}

function analysisPreferencesAreValid(value: unknown): value is AnalysisPreferences {
  if (!isRecord(value) || !isRecord(value.calibration)) return false;
  return JSON.stringify(value) === JSON.stringify(normalizeAnalysisPreferences(value));
}

function analysisHistoryIsValid(value: unknown): value is AnalysisSessionRecord[] {
  if (!Array.isArray(value)) return false;
  return JSON.stringify(value) === JSON.stringify(normalizeAnalysisHistory(value));
}

/** Parses and fully validates a replacement backup before any storage write occurs. */
export function parseBackupPayload(raw: string): BackupPayload {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("This file is not valid JSON. Choose a GGCoder Metronome backup file.");
  }
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) {
    throw new Error("This backup version is not supported. Choose a version 1 or 2 backup file.");
  }
  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new Error("This backup is missing a valid export date.");
  }
  if (!libraryIsValid(value.library) || !setlistsAreValid(value.setlists)) {
    throw new Error("This backup contains invalid library or setlist data.");
  }
  if (!settingsAreValid(value.lastSettings) || !uiStateIsValid(value.ui)) {
    throw new Error("This backup contains invalid metronome settings or interface preferences.");
  }
  if (value.version === 2
    && (!analysisPreferencesAreValid(value.analysisPreferences)
      || !analysisHistoryIsValid(value.analysisHistory))) {
    throw new Error("This backup contains invalid Timing Lab preferences or history.");
  }
  return value as unknown as BackupPayload;
}

/** Writes every current key atomically from the caller's perspective, rolling back on failure. */
export function restoreBackupPayload(payload: BackupPayload, storage: Storage = localStorage): void {
  const snapshot = new Map(BACKUP_KEYS.map((key) => [key, storage.getItem(key)]));
  const analysisPreferences = payload.version === 2
    ? payload.analysisPreferences
    : defaultAnalysisPreferences();
  const analysisHistory = payload.version === 2 ? payload.analysisHistory : [];
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(payload.library));
    storage.setItem(SETLISTS_KEY, JSON.stringify(payload.setlists));
    storage.setItem(LAST_KEY, JSON.stringify(payload.lastSettings));
    storage.setItem(UI_KEY, JSON.stringify(payload.ui));
    storage.setItem(ANALYSIS_PREFERENCES_KEY, JSON.stringify(analysisPreferences));
    storage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(analysisHistory));
  } catch (error) {
    try {
      for (const [key, previous] of snapshot) {
        if (previous === null) storage.removeItem(key);
        else storage.setItem(key, previous);
      }
    } catch {
      throw new Error("Restore failed and local storage could not be fully rolled back.", { cause: error });
    }
    throw new Error("Restore failed. Your previous local data was preserved.", { cause: error });
  }
}
