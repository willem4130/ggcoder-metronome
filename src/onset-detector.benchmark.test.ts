import { describe, expect, it } from "vitest";
import { OnsetDetectorCore, type OnsetSensitivity } from "./onset-detector";

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 128;
const FRAME_SECONDS = FRAME_SIZE / SAMPLE_RATE;
const EMPTY = new Float32Array(FRAME_SIZE);

type Bands = [Float32Array, Float32Array, Float32Array];
interface SyntheticFixture {
  name: string;
  frames: Bands[];
  expectedTimes: number[];
}

/** All benchmark audio is programmatically generated here; no third-party recordings are used. */
function impulse(amplitude: number, width = 16): Float32Array {
  const samples = new Float32Array(FRAME_SIZE);
  for (let index = 28; index < 28 + width; index += 1) {
    samples[index] = (index % 2 === 0 ? 1 : -1) * amplitude;
  }
  return samples;
}

function seededNoise(amplitude: number, seed: number): Float32Array {
  const samples = new Float32Array(FRAME_SIZE);
  let state = seed || 1;
  for (let index = 0; index < samples.length; index += 1) {
    state = state * 16_807 % 2_147_483_647;
    samples[index] = ((state / 2_147_483_647) * 2 - 1) * amplitude;
  }
  return samples;
}

function fixture(
  name: string,
  totalFrames: number,
  hits: Array<{ frame: number; band: 0 | 1 | 2; amplitude: number; decayFrames?: number }>,
  noiseAtFrame: (frame: number) => number = () => 0,
): SyntheticFixture {
  const frames: Bands[] = [];
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const noise = noiseAtFrame(frameIndex);
    const bands: Bands = [
      seededNoise(noise, frameIndex * 3 + 1),
      seededNoise(noise, frameIndex * 3 + 2),
      seededNoise(noise, frameIndex * 3 + 3),
    ];
    for (const hit of hits) {
      const elapsed = frameIndex - hit.frame;
      const decayFrames = hit.decayFrames ?? 1;
      if (elapsed < 0 || elapsed >= decayFrames) continue;
      const amplitude = hit.amplitude * Math.exp(-elapsed / Math.max(1, decayFrames / 3));
      bands[hit.band] = impulse(amplitude, hit.band === 2 ? 32 : 16);
    }
    frames.push(bands);
  }
  return {
    name,
    frames,
    expectedTimes: hits.map((hit) => hit.frame * FRAME_SECONDS + 28 / SAMPLE_RATE),
  };
}

function analyze(fixtureToRun: SyntheticFixture, sensitivity: OnsetSensitivity = "medium") {
  const detector = new OnsetDetectorCore(SAMPLE_RATE, FRAME_SIZE, sensitivity);
  const detectedTimes: number[] = [];
  fixtureToRun.frames.forEach((bands, index) => {
    const result = detector.process(...bands, index * FRAME_SECONDS);
    if (result.detected) detectedTimes.push(result.onsetTime);
  });
  const flush = detector.process(EMPTY, EMPTY, EMPTY, fixtureToRun.frames.length * FRAME_SECONDS);
  if (flush.detected) detectedTimes.push(flush.onsetTime);

  const used = new Set<number>();
  let matched = 0;
  for (const expected of fixtureToRun.expectedTimes) {
    let bestIndex = -1;
    let bestError = Number.POSITIVE_INFINITY;
    detectedTimes.forEach((detected, index) => {
      if (used.has(index)) return;
      const error = Math.abs(detected - expected);
      if (error < bestError) {
        bestError = error;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestError <= 0.015) {
      used.add(bestIndex);
      matched += 1;
    }
  }
  return {
    expected: fixtureToRun.expectedTimes.length,
    detected: detectedTimes.length,
    matched,
    recall: fixtureToRun.expectedTimes.length === 0 ? 1 : matched / fixtureToRun.expectedTimes.length,
    extraRate: detectedTimes.length === 0 ? 0 : (detectedTimes.length - matched) / detectedTimes.length,
  };
}

const cleanFixtures = [
  fixture("kick-like low impulses", 640, Array.from({ length: 20 }, (_, index) => ({
    frame: 10 + index * 30, band: 0 as const, amplitude: 0.75,
  }))),
  fixture("snare-like mid impulses", 640, Array.from({ length: 20 }, (_, index) => ({
    frame: 10 + index * 30, band: 1 as const, amplitude: 0.8,
  }))),
  fixture("quiet mixed impulses", 640, Array.from({ length: 20 }, (_, index) => ({
    frame: 10 + index * 30, band: (index % 2) as 0 | 1, amplitude: 0.08,
  }))),
  fixture("cymbal-like high decays", 640, Array.from({ length: 20 }, (_, index) => ({
    frame: 10 + index * 30, band: 2 as const, amplitude: 0.65, decayFrames: 10,
  }))),
];

const silence = fixture("silence", 1_000, []);
const broadbandNoise = fixture("broadband room noise", 1_000, [], () => 0.0025);
const changingNoise = fixture(
  "changing noise floor",
  1_000,
  Array.from({ length: 12 }, (_, index) => ({
    frame: 50 + index * 75, band: 1 as const, amplitude: 0.55,
  })),
  (frameIndex) => 0.001 + frameIndex / 1_000 * 0.008,
);
const legalDoubleHits = fixture(
  "double hits beyond cooldown",
  500,
  Array.from({ length: 10 }, (_, index) => {
    const pair = Math.floor(index / 2);
    return { frame: 20 + pair * 90 + (index % 2) * 18, band: 1 as const, amplitude: 0.8 };
  }),
);

describe("declared detector acceptance benchmark", () => {
  it("has no silence detections and no stable broadband-noise detections", () => {
    expect(analyze(silence).detected).toBe(0);
    expect(analyze(broadbandNoise).detected).toBe(0);
  });

  it("meets >=95% recall and <=2% extras across clean supported fixtures", () => {
    const aggregate = cleanFixtures.map((cleanFixture) => ({
      name: cleanFixture.name,
      ...analyze(cleanFixture),
    }));
    const expected = aggregate.reduce((sum, result) => sum + result.expected, 0);
    const matched = aggregate.reduce((sum, result) => sum + result.matched, 0);
    const detected = aggregate.reduce((sum, result) => sum + result.detected, 0);
    const recall = matched / expected;
    const extraRate = (detected - matched) / detected;
    console.info("Synthetic clean detector benchmark", { recall, extraRate, aggregate });
    expect(recall).toBeGreaterThanOrEqual(0.95);
    expect(extraRate).toBeLessThanOrEqual(0.02);
  });

  it("detects supported double hits beyond the 35 ms cooldown", () => {
    expect(analyze(legalDoubleHits)).toMatchObject({ matched: 10, detected: 10 });
  });

  it("stays bounded as the noise floor changes", () => {
    const result = analyze(changingNoise);
    expect(result.recall).toBeGreaterThanOrEqual(0.9);
    expect(result.detected - result.matched).toBeLessThanOrEqual(2);
  });

  it("moves quiet-hit recall in the documented sensitivity direction", () => {
    const quiet = fixture("sensitivity probe", 360, Array.from({ length: 10 }, (_, index) => ({
      frame: 10 + index * 32, band: 1 as const, amplitude: 0.035,
    })));
    const low = analyze(quiet, "low");
    const high = analyze(quiet, "high");
    expect(high.matched).toBeGreaterThan(low.matched);
  });

  it("processes well below one 2.67 ms render quantum in this synthetic harness", () => {
    const detector = new OnsetDetectorCore(SAMPLE_RATE);
    const bands: Bands = [seededNoise(0.003, 1), seededNoise(0.003, 2), seededNoise(0.003, 3)];
    const durations: number[] = [];
    for (let index = 0; index < 20_000; index += 1) {
      const started = performance.now();
      detector.process(...bands, index * FRAME_SECONDS);
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    const p95Ms = durations[Math.floor(durations.length * 0.95)];
    console.info("Synthetic detector processing benchmark", { p95Ms, renderQuantumMs: FRAME_SECONDS * 1000 });
    expect(p95Ms).toBeLessThan(FRAME_SECONDS * 1000);
  });
});
