/** Pure timing logic: subdivision onsets, trainers, tap tempo. No Web Audio here. */

export const MIN_BPM = 30;
export const MAX_BPM = 260;

export const clampBpm = (bpm: number): number =>
  Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));

/** Per-layer gain, 0..1 (the Rhythm Watch style mixer). */
export interface SubdivisionMix {
  quarter: number;
  eighth: number;
  sixteenth: number;
  triplet: number;
}

export type Layer = keyof SubdivisionMix;

/** A scheduled hit inside one beat, offset expressed as a fraction of the beat. */
export interface Onset {
  offset: number;
  layer: Layer;
  gain: number;
}

/**
 * Onsets for one beat. Layers stack like on the hardware: the quarter layer
 * owns the downbeat, sub layers own their in-between positions.
 */
export function beatOnsets(mix: SubdivisionMix): Onset[] {
  const out: Onset[] = [];
  if (mix.quarter > 0) out.push({ offset: 0, layer: "quarter", gain: mix.quarter });
  if (mix.eighth > 0) out.push({ offset: 1 / 2, layer: "eighth", gain: mix.eighth });
  if (mix.sixteenth > 0) {
    for (const offset of [1 / 4, 1 / 2, 3 / 4]) {
      out.push({ offset, layer: "sixteenth", gain: mix.sixteenth });
    }
  }
  if (mix.triplet > 0) {
    for (const offset of [1 / 3, 2 / 3]) {
      out.push({ offset, layer: "triplet", gain: mix.triplet });
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

export interface GapTrainer {
  enabled: boolean;
  playBars: number;
  muteBars: number;
}

/** Gap trainer: is this bar silent? Bar indices start at 0. */
export function isBarMuted(gap: GapTrainer, barIndex: number): boolean {
  if (!gap.enabled || gap.muteBars <= 0) return false;
  const cycle = Math.max(1, gap.playBars) + gap.muteBars;
  return barIndex % cycle >= Math.max(1, gap.playBars);
}

export interface SpeedTrainer {
  enabled: boolean;
  toBpm: number;
  stepBpm: number;
  everyBars: number;
}

/** Speed trainer: BPM for a given bar, ramping from startBpm toward toBpm. */
export function bpmForBar(sp: SpeedTrainer, startBpm: number, barIndex: number): number {
  if (!sp.enabled || sp.stepBpm <= 0 || sp.everyBars <= 0) return startBpm;
  const steps = Math.floor(barIndex / sp.everyBars);
  const dir = sp.toBpm >= startBpm ? 1 : -1;
  const bpm = startBpm + dir * steps * sp.stepBpm;
  const bounded = dir > 0 ? Math.min(bpm, sp.toBpm) : Math.max(bpm, sp.toBpm);
  return clampBpm(bounded);
}

/** Averages the last few tap intervals; resets after a 2 s pause. */
export class TapTempo {
  private taps: number[] = [];

  /** @param nowMs timestamp in milliseconds. Returns a BPM once two taps exist. */
  tap(nowMs: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && nowMs - last > 2000) this.taps = [];
    this.taps.push(nowMs);
    if (this.taps.length < 2) return null;
    const recent = this.taps.slice(-6);
    const avgInterval = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
    if (avgInterval <= 0) return null;
    return clampBpm(60000 / avgInterval);
  }
}
