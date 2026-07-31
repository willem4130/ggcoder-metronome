export type OnsetSensitivity = "low" | "medium" | "high";

export interface OnsetDetectorResult {
  detected: boolean;
  /** AudioContext time of the strongest sample in the detected render quantum. */
  onsetTime: number;
  strength: number;
  level: number;
  /** Local-maximum lookahead, reported so callers can expose detector latency. */
  algorithmicDelaySeconds: number;
}

interface DetectorTuning {
  silenceFloor: number;
  minimumFlux: number;
  thresholdSigma: number;
}

const TUNING: Record<OnsetSensitivity, DetectorTuning> = {
  low: { silenceFloor: 0.008, minimumFlux: 0.012, thresholdSigma: 4.5 },
  medium: { silenceFloor: 0.004, minimumFlux: 0.006, thresholdSigma: 3.2 },
  high: { silenceFloor: 0.002, minimumFlux: 0.003, thresholdSigma: 2.2 },
};

const MINIMUM_INTER_ONSET_SECONDS = 0.035;
const BASELINE_ALPHA = 0.025;
const MINIMUM_VARIANCE = 1e-8;
const LOW_WEIGHT = 0.45;
const MID_WEIGHT = 0.4;
const HIGH_WEIGHT = 0.15;

/**
 * Allocation-free adaptive onset detector for one Web Audio render quantum.
 * The three inputs are pre-filtered low/mid/high bands and may be empty.
 * `process()` returns the same mutable result object on every call.
 */
export class OnsetDetectorCore {
  private sensitivity: OnsetSensitivity;
  private readonly result: OnsetDetectorResult;
  private previousLowRms = 0;
  private previousMidRms = 0;
  private previousHighRms = 0;
  private fluxBeforeCandidate = 0;
  private candidateFlux = 0;
  private candidateThreshold = 0;
  private candidateLevel = 0;
  private candidateTime = 0;
  private noiseMean = 0.0005;
  private noiseVariance = 0.000001;
  private lastOnsetTime = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly sampleRate: number,
    renderQuantumFrames = 128,
    sensitivity: OnsetSensitivity = "medium",
  ) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError("sampleRate must be a positive finite number");
    }
    this.sensitivity = sensitivity;
    this.result = {
      detected: false,
      onsetTime: 0,
      strength: 0,
      level: 0,
      algorithmicDelaySeconds: renderQuantumFrames / sampleRate,
    };
  }

  setSensitivity(sensitivity: OnsetSensitivity): void {
    this.sensitivity = sensitivity;
  }

  reset(): void {
    this.previousLowRms = 0;
    this.previousMidRms = 0;
    this.previousHighRms = 0;
    this.fluxBeforeCandidate = 0;
    this.candidateFlux = 0;
    this.candidateThreshold = 0;
    this.candidateLevel = 0;
    this.candidateTime = 0;
    this.noiseMean = 0.0005;
    this.noiseVariance = 0.000001;
    this.lastOnsetTime = Number.NEGATIVE_INFINITY;
    this.result.detected = false;
    this.result.onsetTime = 0;
    this.result.strength = 0;
    this.result.level = 0;
  }

  process(
    low: Float32Array | undefined,
    mid: Float32Array | undefined,
    high: Float32Array | undefined,
    frameStartTime: number,
  ): OnsetDetectorResult {
    const lowRms = rms(low);
    const midRms = rms(mid);
    const highRms = rms(high);
    const level = Math.sqrt(
      lowRms * lowRms * LOW_WEIGHT
      + midRms * midRms * MID_WEIGHT
      + highRms * highRms * HIGH_WEIGHT,
    );
    const flux = Math.max(0, lowRms - this.previousLowRms) * LOW_WEIGHT
      + Math.max(0, midRms - this.previousMidRms) * MID_WEIGHT
      + Math.max(0, highRms - this.previousHighRms) * HIGH_WEIGHT;
    const tuning = TUNING[this.sensitivity];
    const deviation = Math.sqrt(Math.max(MINIMUM_VARIANCE, this.noiseVariance));
    const threshold = Math.max(
      tuning.minimumFlux,
      this.noiseMean + tuning.thresholdSigma * deviation,
    );

    this.result.detected = false;
    this.result.level = Math.min(1, level * 5);

    const candidateIsLocalMaximum = this.candidateFlux > this.fluxBeforeCandidate
      && this.candidateFlux >= flux;
    const candidateIsAttack = this.candidateFlux >= this.candidateThreshold
      && this.candidateLevel >= tuning.silenceFloor;
    const cooldownComplete = this.candidateTime - this.lastOnsetTime
      >= MINIMUM_INTER_ONSET_SECONDS;

    if (candidateIsLocalMaximum && candidateIsAttack && cooldownComplete) {
      this.lastOnsetTime = this.candidateTime;
      this.result.detected = true;
      this.result.onsetTime = this.candidateTime;
      this.result.strength = Math.min(
        1,
        this.candidateFlux / Math.max(this.candidateThreshold, tuning.minimumFlux) / 3,
      );
    }

    // Attacks must not drag the adaptive baseline upward. Quiet/background frames
    // use an exponential mean and variance so changing room noise is followed.
    if (flux < threshold && level < Math.max(tuning.silenceFloor * 4, 0.05)) {
      const difference = flux - this.noiseMean;
      this.noiseMean += BASELINE_ALPHA * difference;
      this.noiseVariance = (1 - BASELINE_ALPHA)
        * (this.noiseVariance + BASELINE_ALPHA * difference * difference);
    }

    this.fluxBeforeCandidate = this.candidateFlux;
    this.candidateFlux = flux;
    this.candidateThreshold = threshold;
    this.candidateLevel = level;
    this.candidateTime = frameStartTime + peakOffsetSeconds(low, mid, high, this.sampleRate);
    this.previousLowRms = lowRms;
    this.previousMidRms = midRms;
    this.previousHighRms = highRms;
    return this.result;
  }
}

function rms(samples: Float32Array | undefined): number {
  if (!samples || samples.length === 0) return 0;
  let squareSum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    squareSum += sample * sample;
  }
  return Math.sqrt(squareSum / samples.length);
}

function peakOffsetSeconds(
  low: Float32Array | undefined,
  mid: Float32Array | undefined,
  high: Float32Array | undefined,
  sampleRate: number,
): number {
  const length = Math.max(low?.length ?? 0, mid?.length ?? 0, high?.length ?? 0);
  let peak = 0;
  let peakIndex = 0;
  for (let index = 0; index < length; index += 1) {
    const weighted = Math.abs(low?.[index] ?? 0) * LOW_WEIGHT
      + Math.abs(mid?.[index] ?? 0) * MID_WEIGHT
      + Math.abs(high?.[index] ?? 0) * HIGH_WEIGHT;
    if (weighted > peak) {
      peak = weighted;
      peakIndex = index;
    }
  }
  return peakIndex / sampleRate;
}
