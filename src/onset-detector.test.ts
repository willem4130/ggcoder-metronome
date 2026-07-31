import { describe, expect, it } from "vitest";
import { OnsetDetectorCore, type OnsetSensitivity } from "./onset-detector";

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 128;
const FRAME_SECONDS = FRAME_SIZE / SAMPLE_RATE;

function frame(level = 0): Float32Array {
  const samples = new Float32Array(FRAME_SIZE);
  samples.fill(level);
  return samples;
}

function impulse(level: number, start = 24, width = 12): Float32Array {
  const samples = frame();
  for (let index = start; index < Math.min(FRAME_SIZE, start + width); index += 1) {
    samples[index] = index % 2 === 0 ? level : -level;
  }
  return samples;
}

function countDetections(
  fixtures: Array<[Float32Array, Float32Array, Float32Array]>,
  sensitivity: OnsetSensitivity = "medium",
): number {
  const detector = new OnsetDetectorCore(SAMPLE_RATE, FRAME_SIZE, sensitivity);
  let count = 0;
  fixtures.forEach(([low, mid, high], index) => {
    if (detector.process(low, mid, high, index * FRAME_SECONDS).detected) count += 1;
  });
  // Flush the final local-maximum candidate.
  if (detector.process(frame(), frame(), frame(), fixtures.length * FRAME_SECONDS).detected) count += 1;
  return count;
}

function hitFixture(
  band: "low" | "mid" | "high",
  hitCount: number,
  level = 0.8,
  spacingFrames = 20,
): Array<[Float32Array, Float32Array, Float32Array]> {
  const fixtures: Array<[Float32Array, Float32Array, Float32Array]> = [];
  const totalFrames = hitCount * spacingFrames;
  for (let index = 0; index < totalFrames; index += 1) {
    const low = frame();
    const mid = frame();
    const high = frame();
    if (index % spacingFrames === 2) {
      const target = band === "low" ? low : band === "mid" ? mid : high;
      target.set(impulse(level));
    }
    fixtures.push([low, mid, high]);
  }
  return fixtures;
}

describe("OnsetDetectorCore", () => {
  it("never detects silence or a stable noise floor", () => {
    const silence = Array.from({ length: 200 }, () => [frame(), frame(), frame()] as const);
    expect(countDetections(silence.map((bands) => [...bands]))).toBe(0);

    const noise = Array.from({ length: 200 }, (_, frameIndex) => {
      const level = 0.0015 + (frameIndex % 7) * 0.00005;
      return [frame(level), frame(-level), frame(level)] as [Float32Array, Float32Array, Float32Array];
    });
    expect(countDetections(noise)).toBe(0);
  });

  it.each(["low", "mid"] as const)("detects clean %s-band percussive impulses", (band) => {
    expect(countDetections(hitFixture(band, 20))).toBe(20);
  });

  it("weights cymbal-like high-band decay below low and mid attacks", () => {
    const fixtures: Array<[Float32Array, Float32Array, Float32Array]> = [];
    for (let index = 0; index < 80; index += 1) {
      const decay = index < 24 ? 0.08 * Math.exp(-index / 8) : 0;
      fixtures.push([frame(), frame(), frame(decay)]);
    }
    expect(countDetections(fixtures, "low")).toBe(0);
    expect(countDetections(hitFixture("mid", 4), "low")).toBe(4);
  });

  it("enforces a 35 ms minimum interval for double hits", () => {
    const fixtures = hitFixture("mid", 1, 0.9, 30);
    fixtures[2] = [frame(), impulse(0.9), frame()];
    fixtures[8] = [frame(), impulse(0.9), frame()];
    fixtures[22] = [frame(), impulse(0.9), frame()];
    expect(countDetections(fixtures)).toBe(2);
  });

  it("adapts to a changing background while preserving later attacks", () => {
    const fixtures: Array<[Float32Array, Float32Array, Float32Array]> = [];
    for (let index = 0; index < 240; index += 1) {
      const floor = 0.001 + index / 240 * 0.004;
      const hit = index === 60 || index === 140 || index === 220;
      fixtures.push([
        hit ? impulse(0.65) : frame(floor),
        hit ? impulse(0.8) : frame(-floor),
        frame(floor),
      ]);
    }
    expect(countDetections(fixtures)).toBe(3);
  });

  it("makes higher sensitivity accept a quiet hit rejected by low sensitivity", () => {
    const fixtures = hitFixture("mid", 3, 0.035);
    expect(countDetections(fixtures, "low")).toBe(0);
    expect(countDetections(fixtures, "high")).toBe(3);
  });

  it("reports the peak sample time and one-quantum lookahead", () => {
    const detector = new OnsetDetectorCore(SAMPLE_RATE);
    detector.process(frame(), impulse(0.8, 32), frame(), 1);
    const result = detector.process(frame(), frame(), frame(), 1 + FRAME_SECONDS);
    expect(result.detected).toBe(true);
    expect(result.onsetTime).toBeCloseTo(1 + 32 / SAMPLE_RATE, 8);
    expect(result.algorithmicDelaySeconds).toBeCloseTo(FRAME_SECONDS, 8);
  });

  it("reuses its result object without per-frame output allocation", () => {
    const detector = new OnsetDetectorCore(SAMPLE_RATE);
    const first = detector.process(frame(), frame(), frame(), 0);
    const second = detector.process(frame(), frame(), frame(), FRAME_SECONDS);
    expect(second).toBe(first);
  });
});
