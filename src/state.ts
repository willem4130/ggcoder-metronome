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

const PRESETS_KEY = "ggcoder-metronome.presets.v1";
const LAST_KEY = "ggcoder-metronome.last.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadPresets(): Preset[] {
  return safeParse<Preset[]>(localStorage.getItem(PRESETS_KEY)) ?? [];
}

export function savePresets(presets: Preset[]): void {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export function loadLastSettings(): Settings {
  const saved = safeParse<Settings>(localStorage.getItem(LAST_KEY));
  return saved ? { ...defaultSettings(), ...saved } : defaultSettings();
}

export function saveLastSettings(settings: Settings): void {
  localStorage.setItem(LAST_KEY, JSON.stringify(settings));
}
