export const CALIBRATION_CLICK_COUNT = 10;
export const CALIBRATION_WARMUP_CLICKS = 2;
export const CALIBRATION_MINIMUM_MATCHES = 7;
export const CALIBRATION_MAX_SPREAD_MS = 12;
export const CALIBRATION_CLICK_INTERVAL_SECONDS = 0.65;

const CALIBRATION_START_LEAD_SECONDS = 0.5;
const MINIMUM_LOOPBACK_SECONDS = 0.005;
const MAXIMUM_LOOPBACK_SECONDS = 0.35;

export interface CalibrationAudioHost {
  readonly running: boolean;
  acquireAudioContext(): Promise<AudioContext>;
  releaseAudioContext(): void;
  scheduleCalibrationClick(time: number): void;
}

export interface CalibrationCapture {
  start(): Promise<void>;
  stop(): void;
}

export interface CalibrationMeasurement {
  success: boolean;
  offsetMs: number | null;
  matchedClicks: number;
  spreadMs: number | null;
  quality: "measured" | "insufficient-matches" | "unstable";
  message: string;
}

export interface CalibrationRun {
  referenceTimes: readonly number[];
  estimatedOffsetMs: number;
}

export interface CalibrationMetadata {
  offsetMs: number;
  measuredAt: string | null;
  inputDeviceId: string | null;
  quality: "estimated" | "measured";
  stale: boolean;
}

export function estimateDeviceOffsetMs(
  context: AudioContext,
  inputLatencySeconds: number | null,
): number {
  const outputLatency = finiteNonNegative(
    (context as AudioContext & { outputLatency?: number }).outputLatency,
  );
  const baseLatency = finiteNonNegative(context.baseLatency);
  const inputLatency = finiteNonNegative(inputLatencySeconds);
  return Math.round(Math.min(250, (outputLatency + baseLatency + inputLatency) * 1000));
}

export function calculateCalibration(
  referenceTimes: readonly number[],
  onsetTimes: readonly number[],
): CalibrationMeasurement {
  const usableReferences = referenceTimes.slice(CALIBRATION_WARMUP_CLICKS);
  const candidateOffsets: number[] = [];
  for (const referenceTime of usableReferences) {
    for (const onsetTime of onsetTimes) {
      const offset = onsetTime - referenceTime;
      if (offset >= MINIMUM_LOOPBACK_SECONDS && offset <= MAXIMUM_LOOPBACK_SECONDS) {
        candidateOffsets.push(offset);
      }
    }
  }
  let clusterCenter = 0;
  let clusterSize = 0;
  for (const center of candidateOffsets) {
    const size = candidateOffsets.filter((offset) => Math.abs(offset - center) <= 0.02).length;
    if (size > clusterSize) {
      clusterCenter = center;
      clusterSize = size;
    }
  }

  const usedOnsets = new Set<number>();
  const offsetsMs: number[] = [];
  for (const referenceTime of usableReferences) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < onsetTimes.length; index += 1) {
      if (usedOnsets.has(index)) continue;
      const offset = onsetTimes[index] - referenceTime;
      const distance = Math.abs(offset - clusterCenter);
      if (offset < MINIMUM_LOOPBACK_SECONDS || offset > MAXIMUM_LOOPBACK_SECONDS) continue;
      if (distance <= 0.03 && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      usedOnsets.add(bestIndex);
      offsetsMs.push((onsetTimes[bestIndex] - referenceTime) * 1000);
    }
  }

  if (offsetsMs.length < CALIBRATION_MINIMUM_MATCHES) {
    return {
      success: false,
      offsetMs: null,
      matchedClicks: offsetsMs.length,
      spreadMs: null,
      quality: "insufficient-matches",
      message: `Only ${offsetsMs.length} of 8 usable clicks matched; at least ${CALIBRATION_MINIMUM_MATCHES} are required.`,
    };
  }

  const offsetMs = median(offsetsMs);
  const spreadMs = median(offsetsMs.map((offset) => Math.abs(offset - offsetMs)));
  if (spreadMs > CALIBRATION_MAX_SPREAD_MS) {
    return {
      success: false,
      offsetMs: null,
      matchedClicks: offsetsMs.length,
      spreadMs: rounded(spreadMs),
      quality: "unstable",
      message: `Loopback varied by ${rounded(spreadMs)} ms; move to a quieter room and retry.`,
    };
  }

  return {
    success: true,
    offsetMs: rounded(offsetMs),
    matchedClicks: offsetsMs.length,
    spreadMs: rounded(spreadMs),
    quality: "measured",
    message: `Measured ${rounded(offsetMs)} ms device offset from ${offsetsMs.length} clicks.`,
  };
}

export function markCalibrationForDevice(
  calibration: CalibrationMetadata,
  currentInputDeviceId: string | null,
): CalibrationMetadata {
  const stale = calibration.quality === "measured"
    && calibration.inputDeviceId !== currentInputDeviceId;
  return { ...calibration, stale };
}

export class CalibrationController {
  private contextLeased = false;
  private active = false;
  private starting = false;
  private cancelled = false;
  private referenceTimes: number[] = [];
  private onsetTimes: number[] = [];

  constructor(
    private readonly audioHost: CalibrationAudioHost,
    private readonly capture: CalibrationCapture,
  ) {}

  get running(): boolean {
    return this.active || this.starting;
  }

  async begin(
    inputLatencySeconds: number | null | (() => number | null),
  ): Promise<CalibrationRun> {
    if (this.running) throw new Error("Calibration is already running.");
    if (this.audioHost.running) {
      throw new Error("Stop metronome playback before calibrating.");
    }
    this.cancelled = false;
    this.starting = true;
    this.referenceTimes = [];
    this.onsetTimes = [];
    try {
      const context = await this.audioHost.acquireAudioContext();
      this.contextLeased = true;
      if (this.cancelled) throw new Error("Calibration was cancelled.");
      await this.capture.start();
      if (this.cancelled) throw new Error("Calibration was cancelled.");
      const firstClickTime = context.currentTime + CALIBRATION_START_LEAD_SECONDS;
      for (let index = 0; index < CALIBRATION_CLICK_COUNT; index += 1) {
        const time = firstClickTime + index * CALIBRATION_CLICK_INTERVAL_SECONDS;
        this.referenceTimes.push(time);
        this.audioHost.scheduleCalibrationClick(time);
      }
      this.starting = false;
      this.active = true;
      const resolvedInputLatency = typeof inputLatencySeconds === "function"
        ? inputLatencySeconds()
        : inputLatencySeconds;
      return {
        referenceTimes: [...this.referenceTimes],
        estimatedOffsetMs: estimateDeviceOffsetMs(context, resolvedInputLatency),
      };
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  recordOnset(time: number): void {
    if (!this.active || !Number.isFinite(time)) return;
    this.onsetTimes.push(time);
  }

  complete(): CalibrationMeasurement {
    if (!this.active) throw new Error("Calibration is not running.");
    const result = calculateCalibration(this.referenceTimes, this.onsetTimes);
    this.cleanup();
    return result;
  }

  cancel(): void {
    this.cancelled = true;
    this.cleanup();
  }

  private cleanup(): void {
    this.active = false;
    this.starting = false;
    this.capture.stop();
    if (this.contextLeased) {
      this.contextLeased = false;
      this.audioHost.releaseAudioContext();
    }
  }
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}
