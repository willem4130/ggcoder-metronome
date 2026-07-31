export type AnalysisMode = "metronome" | "free";
export type AnalysisSubdivision = 1 | 2 | 4;
export type AnalysisSensitivity = "low" | "medium" | "high";

export interface AnalysisPreferences {
  subdivision: AnalysisSubdivision;
  sensitivity: AnalysisSensitivity;
  inputOffsetMs: number;
}

export interface TimingEvent {
  onsetTime: number;
  targetTime: number | null;
  deviationMs: number | null;
  strength: number;
}

export interface TempoEstimate {
  bpm: number | null;
  confidence: number;
}

export interface AnalysisSnapshot {
  mode: AnalysisMode;
  bpm: number | null;
  confidence: number;
  score: number | null;
  grade: "Collecting" | "Locked" | "Solid" | "Developing" | "Unsteady";
  currentDeviationMs: number | null;
  meanAbsoluteDeviationMs: number | null;
  standardDeviationMs: number | null;
  averageOffsetMs: number | null;
  driftPercent: number | null;
  earlyCount: number;
  onTimeCount: number;
  lateCount: number;
  analyzedHits: number;
  detectedHits: number;
  durationSeconds: number;
  pulseDurationMs: number | null;
  recentDeviationsMs: number[];
}

interface ReferenceTarget {
  time: number;
  pulseDuration: number;
  event: TimingEvent | null;
}

interface WeightedTempoCandidate {
  bpm: number;
  weight: number;
}

const MAX_EVENTS = 256;
const MAX_TEMPO_ONSETS = 32;
const MAX_REFERENCE_TARGETS = 1_024;
const MAX_RECENT_DEVIATIONS = 24;
const ON_TIME_WINDOW_MS = 5;
const MIN_ANALYZED_HITS = 8;
const TEMPO_CLUSTER_TOLERANCE = 0.03;
const MIN_TEMPO_CONFIDENCE = 0.55;
const FREE_BASELINE_ALPHA = 0.02;

export const DEFAULT_ANALYSIS_PREFERENCES: AnalysisPreferences = {
  subdivision: 1,
  sensitivity: "medium",
  inputOffsetMs: 0,
};

export function normalizeAnalysisPreferences(value: unknown): AnalysisPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_ANALYSIS_PREFERENCES };
  }
  const candidate = value as Record<string, unknown>;
  const subdivision = candidate.subdivision === 1 || candidate.subdivision === 2 || candidate.subdivision === 4
    ? candidate.subdivision
    : DEFAULT_ANALYSIS_PREFERENCES.subdivision;
  const sensitivity = candidate.sensitivity === "low"
    || candidate.sensitivity === "medium"
    || candidate.sensitivity === "high"
    ? candidate.sensitivity
    : DEFAULT_ANALYSIS_PREFERENCES.sensitivity;
  const offset = typeof candidate.inputOffsetMs === "number" && Number.isFinite(candidate.inputOffsetMs)
    ? candidate.inputOffsetMs
    : DEFAULT_ANALYSIS_PREFERENCES.inputOffsetMs;
  return {
    subdivision,
    sensitivity,
    inputOffsetMs: Math.round(clamp(offset, -250, 250)),
  };
}

/**
 * Confidence-weighted pulse estimate from adjacent and short multi-hit spans.
 * Multi-hit candidates keep one missed/duplicate detection from forcing a
 * half/double-tempo jump.
 */
export function estimateTempo(
  onsetTimes: number[],
  subdivision: AnalysisSubdivision,
): TempoEstimate {
  const recent = onsetTimes.slice(-MAX_TEMPO_ONSETS);
  if (recent.length < 3) return { bpm: null, confidence: 0 };
  const candidates: WeightedTempoCandidate[] = [];
  const newestIndex = recent.length - 1;
  for (let end = 1; end < recent.length; end += 1) {
    for (let span = 1; span <= 4 && end - span >= 0; span += 1) {
      const interval = recent[end] - recent[end - span];
      if (interval <= 0) continue;
      const bpm = 60 * span / interval / subdivision;
      if (bpm < 30 || bpm > 260) continue;
      const recency = 0.65 + 0.35 * end / newestIndex;
      candidates.push({ bpm, weight: recency / Math.sqrt(span) });
    }
  }
  if (candidates.length === 0) return { bpm: null, confidence: 0 };

  let bestCenter = 0;
  let bestWeight = 0;
  let totalWeight = 0;
  for (const candidate of candidates) totalWeight += candidate.weight;
  for (const centerCandidate of candidates) {
    let clusterWeight = 0;
    for (const candidate of candidates) {
      if (Math.abs(candidate.bpm - centerCandidate.bpm) / centerCandidate.bpm
        <= TEMPO_CLUSTER_TOLERANCE) {
        clusterWeight += candidate.weight;
      }
    }
    if (clusterWeight > bestWeight) {
      bestCenter = centerCandidate.bpm;
      bestWeight = clusterWeight;
    }
  }
  if (bestWeight === 0 || bestCenter === 0) return { bpm: null, confidence: 0 };
  const bestCluster = candidates
    .filter((candidate) => Math.abs(candidate.bpm - bestCenter) / bestCenter
      <= TEMPO_CLUSTER_TOLERANCE)
    .sort((left, right) => left.bpm - right.bpm);
  let cumulativeWeight = 0;
  let weightedMedianBpm = bestCenter;
  for (const candidate of bestCluster) {
    cumulativeWeight += candidate.weight;
    if (cumulativeWeight >= bestWeight / 2) {
      weightedMedianBpm = candidate.bpm;
      break;
    }
  }
  return {
    bpm: weightedMedianBpm,
    confidence: clamp(bestWeight / totalWeight, 0, 1),
  };
}

export function estimatePulseBpm(
  onsetTimes: number[],
  subdivision: AnalysisSubdivision,
): number | null {
  return estimateTempo(onsetTimes, subdivision).bpm;
}

/** Score = 100 × (1 − RMS error ÷ 20% of selected pulse duration), clamped 0–100. */
export function calculateTimingScore(rmsErrorMs: number, pulseDurationMs: number): number {
  if (!Number.isFinite(rmsErrorMs) || !Number.isFinite(pulseDurationMs) || pulseDurationMs <= 0) {
    return 0;
  }
  return Math.round(clamp(100 * (1 - rmsErrorMs / (pulseDurationMs * 0.2)), 0, 100));
}

function roundedMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export class TimingAnalysisSession {
  private mode: AnalysisMode;
  private subdivision: AnalysisSubdivision;
  private inputOffsetMs: number;
  private events: TimingEvent[] = [];
  private referenceTargets: ReferenceTarget[] = [];
  private tempoOnsets: number[] = [];
  private detectedHits = 0;
  private firstOnsetTime: number | null = null;
  private lastOnsetTime: number | null = null;
  private stableBpm: number | null = null;
  private tempoConfidence = 0;
  private pendingOctaveBpm: number | null = null;
  private pendingOctaveCount = 0;
  private freeBaselineInterval: number | null = null;

  constructor(mode: AnalysisMode, preferences: AnalysisPreferences) {
    this.mode = mode;
    this.subdivision = preferences.subdivision;
    this.inputOffsetMs = preferences.inputOffsetMs;
  }

  setMode(mode: AnalysisMode): boolean {
    if (mode === this.mode) return false;
    this.mode = mode;
    this.reset();
    return true;
  }

  setSubdivision(subdivision: AnalysisSubdivision): void {
    if (subdivision === this.subdivision) return;
    this.subdivision = subdivision;
    this.reset();
  }

  setInputOffset(inputOffsetMs: number): void {
    this.inputOffsetMs = clamp(inputOffsetMs, -250, 250);
  }

  reset(): void {
    this.events = [];
    this.referenceTargets = [];
    this.tempoOnsets = [];
    this.detectedHits = 0;
    this.firstOnsetTime = null;
    this.lastOnsetTime = null;
    this.stableBpm = null;
    this.tempoConfidence = 0;
    this.pendingOctaveBpm = null;
    this.pendingOctaveCount = 0;
    this.freeBaselineInterval = null;
  }

  addReferenceBeat(time: number, bpm: number): void {
    if (!Number.isFinite(time) || !Number.isFinite(bpm) || bpm <= 0) return;
    const pulseDuration = 60 / bpm / this.subdivision;
    for (let pulse = 0; pulse < this.subdivision; pulse += 1) {
      const targetTime = time + pulse * pulseDuration;
      const duplicate = this.referenceTargets.some(
        (target) => Math.abs(target.time - targetTime) < 0.000_01,
      );
      if (!duplicate) {
        this.referenceTargets.push({ time: targetTime, pulseDuration, event: null });
      }
    }
    if (this.referenceTargets.length > MAX_REFERENCE_TARGETS) {
      this.referenceTargets.splice(0, this.referenceTargets.length - MAX_REFERENCE_TARGETS);
    }
  }

  addOnset(time: number, strength = 1): AnalysisSnapshot {
    if (!Number.isFinite(time)) return this.snapshot();
    const adjustedTime = time - this.inputOffsetMs / 1000;
    this.detectedHits += 1;
    this.firstOnsetTime ??= adjustedTime;
    this.lastOnsetTime = adjustedTime;

    if (this.mode === "metronome") this.addMetronomeOnset(adjustedTime, strength);
    else this.addFreeOnset(adjustedTime, strength);
    return this.snapshot();
  }

  snapshot(): AnalysisSnapshot {
    const deviations = this.events
      .map((event) => event.deviationMs)
      .filter((value): value is number => value !== null);
    const mean = deviations.length > 0 ? average(deviations) : null;
    const meanAbsolute = deviations.length > 0
      ? average(deviations.map((value) => Math.abs(value)))
      : null;
    const standardDeviation = mean === null
      ? null
      : Math.sqrt(average(deviations.map((value) => (value - mean) ** 2)));
    const rms = deviations.length > 0
      ? Math.sqrt(average(deviations.map((value) => value ** 2)))
      : null;
    const pulseDurationMs = this.resolvePulseDurationMs();
    const enoughEvidence = deviations.length >= MIN_ANALYZED_HITS
      && this.tempoConfidence >= MIN_TEMPO_CONFIDENCE;
    const score = enoughEvidence && rms !== null && pulseDurationMs !== null
      ? calculateTimingScore(rms, pulseDurationMs)
      : null;
    const currentTempo = estimateTempo(this.tempoOnsets, this.subdivision).bpm;
    const baselineBpm = this.freeBaselineInterval === null
      ? null
      : 60 / this.freeBaselineInterval / this.subdivision;
    const driftPercent = this.mode === "free" && currentTempo !== null && baselineBpm !== null
      ? (currentTempo - baselineBpm) / baselineBpm * 100
      : null;

    return {
      mode: this.mode,
      bpm: this.stableBpm === null ? null : roundedMetric(this.stableBpm),
      confidence: roundedMetric(this.tempoConfidence * 100),
      score,
      grade: score === null
        ? "Collecting"
        : score >= 90
          ? "Locked"
          : score >= 75
            ? "Solid"
            : score >= 55
              ? "Developing"
              : "Unsteady",
      currentDeviationMs: deviations.length > 0 ? roundedMetric(deviations.at(-1)!) : null,
      meanAbsoluteDeviationMs: meanAbsolute === null ? null : roundedMetric(meanAbsolute),
      standardDeviationMs: standardDeviation === null ? null : roundedMetric(standardDeviation),
      averageOffsetMs: mean === null ? null : roundedMetric(mean),
      driftPercent: driftPercent === null ? null : roundedMetric(driftPercent),
      earlyCount: deviations.filter((value) => value < -ON_TIME_WINDOW_MS).length,
      onTimeCount: deviations.filter((value) => Math.abs(value) <= ON_TIME_WINDOW_MS).length,
      lateCount: deviations.filter((value) => value > ON_TIME_WINDOW_MS).length,
      analyzedHits: deviations.length,
      detectedHits: this.detectedHits,
      durationSeconds: this.firstOnsetTime === null || this.lastOnsetTime === null
        ? 0
        : roundedMetric(Math.max(0, this.lastOnsetTime - this.firstOnsetTime)),
      pulseDurationMs: pulseDurationMs === null ? null : roundedMetric(pulseDurationMs),
      recentDeviationsMs: deviations.slice(-MAX_RECENT_DEVIATIONS).map(roundedMetric),
    };
  }

  getEvents(): TimingEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  private addMetronomeOnset(time: number, strength: number): void {
    const target = this.nearestReferenceTarget(time);
    if (!target) return;
    const deviationMs = (time - target.time) * 1000;
    if (target.event) {
      if (Math.abs(deviationMs) >= Math.abs(target.event.deviationMs ?? Number.POSITIVE_INFINITY)) return;
      target.event.onsetTime = time;
      target.event.deviationMs = deviationMs;
      target.event.strength = clamp(strength, 0, 1);
      return;
    }
    const event: TimingEvent = {
      onsetTime: time,
      targetTime: target.time,
      deviationMs,
      strength: clamp(strength, 0, 1),
    };
    target.event = event;
    this.pushEvent(event);
    this.pushTempoOnset(time);
  }

  private addFreeOnset(time: number, strength: number): void {
    const previousTime = this.tempoOnsets.at(-1) ?? null;
    const tempo = this.pushTempoOnset(time);
    const baselineBeforeOnset = this.freeBaselineInterval;
    if (this.freeBaselineInterval === null
      && this.tempoOnsets.length >= MIN_ANALYZED_HITS
      && tempo.bpm !== null
      && tempo.confidence >= MIN_TEMPO_CONFIDENCE) {
      this.freeBaselineInterval = 60 / tempo.bpm / this.subdivision;
    }

    let targetTime: number | null = null;
    let deviationMs: number | null = null;
    if (previousTime !== null && baselineBeforeOnset !== null && this.freeBaselineInterval !== null) {
      targetTime = previousTime + this.freeBaselineInterval;
      deviationMs = (time - targetTime) * 1000;
      const interval = time - previousTime;
      if (Math.abs(interval - this.freeBaselineInterval) / this.freeBaselineInterval <= 0.25) {
        this.freeBaselineInterval = this.freeBaselineInterval * (1 - FREE_BASELINE_ALPHA)
          + interval * FREE_BASELINE_ALPHA;
      }
    }
    this.pushEvent({
      onsetTime: time,
      targetTime,
      deviationMs,
      strength: clamp(strength, 0, 1),
    });
  }

  private pushEvent(event: TimingEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  private pushTempoOnset(time: number): TempoEstimate {
    this.tempoOnsets.push(time);
    if (this.tempoOnsets.length > MAX_TEMPO_ONSETS) this.tempoOnsets.shift();
    return this.updateTempo();
  }

  private updateTempo(): TempoEstimate {
    const estimate = estimateTempo(this.tempoOnsets, this.subdivision);
    this.tempoConfidence = estimate.confidence;
    if (estimate.bpm === null) return estimate;
    if (this.stableBpm === null) {
      this.stableBpm = estimate.bpm;
      return estimate;
    }

    const ratio = estimate.bpm / this.stableBpm;
    const octaveJump = (ratio > 1.8 && ratio < 2.2) || (ratio > 0.45 && ratio < 0.55);
    if (octaveJump) {
      if (this.pendingOctaveBpm !== null
        && Math.abs(estimate.bpm - this.pendingOctaveBpm) / this.pendingOctaveBpm < 0.06) {
        this.pendingOctaveCount += 1;
      } else {
        this.pendingOctaveBpm = estimate.bpm;
        this.pendingOctaveCount = 1;
      }
      if (this.pendingOctaveCount >= 3 && estimate.confidence >= MIN_TEMPO_CONFIDENCE) {
        this.stableBpm = estimate.bpm;
        this.pendingOctaveBpm = null;
        this.pendingOctaveCount = 0;
      }
      return estimate;
    }

    this.pendingOctaveBpm = null;
    this.pendingOctaveCount = 0;
    const alpha = Math.abs(ratio - 1) < 0.12 ? 0.25 : 0.1;
    this.stableBpm = this.stableBpm * (1 - alpha) + estimate.bpm * alpha;
    return estimate;
  }

  private nearestReferenceTarget(time: number): ReferenceTarget | null {
    let nearest: ReferenceTarget | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const target of this.referenceTargets) {
      const distance = Math.abs(time - target.time);
      if (distance < nearestDistance && distance <= target.pulseDuration * 0.45) {
        nearest = target;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private resolvePulseDurationMs(): number | null {
    if (this.mode === "free" && this.freeBaselineInterval !== null) {
      return this.freeBaselineInterval * 1000;
    }
    const recentTarget = this.referenceTargets.at(-1);
    if (recentTarget) return recentTarget.pulseDuration * 1000;
    if (this.stableBpm !== null) return 60_000 / this.stableBpm / this.subdivision;
    return null;
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
