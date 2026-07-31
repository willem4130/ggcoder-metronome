import { describe, expect, it, vi } from "vitest";
import {
  calculateCalibration,
  CalibrationController,
  estimateDeviceOffsetMs,
  markCalibrationForDevice,
  type CalibrationAudioHost,
  type CalibrationCapture,
} from "./calibration";

function references(): number[] {
  return Array.from({ length: 10 }, (_, index) => 1 + index * 0.65);
}

describe("speaker-loopback measurement", () => {
  it("discards warm-up clicks and uses the median stable round-trip offset", () => {
    const refs = references();
    const jitter = [-2, 1, 0, 3, -1, 2, 0, -3, 1, 0];
    const onsets = refs.map((time, index) => time + (82 + jitter[index]) / 1000);
    const result = calculateCalibration(refs, onsets);
    expect(result.success).toBe(true);
    expect(result.offsetMs).toBeCloseTo(82, 0);
    expect(result.matchedClicks).toBe(8);
    expect(result.spreadMs).toBeLessThanOrEqual(3);
  });

  it("ignores unclustered ambient onsets", () => {
    const refs = references();
    const loopback = refs.map((time) => time + 0.075);
    const noise = [1.012, 2.24, 3.61, 5.2, 6.01];
    const result = calculateCalibration(refs, [...loopback, ...noise]);
    expect(result.success).toBe(true);
    expect(result.offsetMs).toBeCloseTo(75);
  });

  it("rejects too few matching clicks", () => {
    const refs = references();
    const result = calculateCalibration(refs, refs.slice(2, 7).map((time) => time + 0.08));
    expect(result).toMatchObject({
      success: false,
      quality: "insufficient-matches",
      matchedClicks: 5,
    });
  });

  it("rejects a loopback cluster with median absolute spread above 12 ms", () => {
    const refs = references();
    const offsets = [81, 85, 90, 100, 110, 115, 119, 120];
    const onsets = refs.slice(2).map((time, index) => time + offsets[index] / 1000);
    const result = calculateCalibration(refs, onsets);
    expect(result.success).toBe(false);
    expect(result.quality).toBe("unstable");
    expect(result.spreadMs).toBeGreaterThan(12);
  });
});

describe("CalibrationController lifecycle", () => {
  function harness(captureStart: () => Promise<void> = async () => undefined) {
    const context = {
      currentTime: 4,
      baseLatency: 0.01,
      outputLatency: 0.02,
    } as AudioContext;
    const host: CalibrationAudioHost = {
      running: false,
      acquireAudioContext: vi.fn(async () => context),
      releaseAudioContext: vi.fn(),
      scheduleCalibrationClick: vi.fn(),
    };
    const capture: CalibrationCapture = {
      start: vi.fn(captureStart),
      stop: vi.fn(),
    };
    return { controller: new CalibrationController(host, capture), host, capture };
  }

  it("starts capture, schedules ten isolated clicks, and releases exactly one lease", async () => {
    const { controller, host, capture } = harness();
    const run = await controller.begin(0.015);
    expect(run.referenceTimes).toHaveLength(10);
    expect(run.estimatedOffsetMs).toBe(45);
    expect(capture.start).toHaveBeenCalledOnce();
    expect(host.scheduleCalibrationClick).toHaveBeenCalledTimes(10);
    for (const time of run.referenceTimes) controller.recordOnset(time + 0.08);
    expect(controller.complete().success).toBe(true);
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(host.releaseAudioContext).toHaveBeenCalledOnce();
  });

  it("requires stopped metronome playback", async () => {
    const { controller, host } = harness();
    Object.defineProperty(host, "running", { value: true });
    await expect(controller.begin(null)).rejects.toThrow("Stop metronome");
    expect(host.acquireAudioContext).not.toHaveBeenCalled();
  });

  it("cancels during async capture startup without leaking or double-releasing", async () => {
    let resolveCapture: () => void = () => undefined;
    const pendingCapture = new Promise<void>((resolve) => {
      resolveCapture = resolve;
    });
    const { controller, host } = harness(() => pendingCapture);
    const starting = controller.begin(null);
    await Promise.resolve();
    expect(controller.running).toBe(true);
    controller.cancel();
    resolveCapture();
    await expect(starting).rejects.toThrow("cancelled");
    expect(host.releaseAudioContext).toHaveBeenCalledOnce();
  });
});

describe("calibration metadata", () => {
  it("seeds latency from browser output, base, and input estimates", () => {
    const context = { baseLatency: 0.01, outputLatency: 0.025 } as AudioContext;
    expect(estimateDeviceOffsetMs(context, 0.015)).toBe(50);
  });

  it("marks measured calibration stale after an input-device change", () => {
    const calibration = {
      offsetMs: 72,
      measuredAt: "2026-07-30T12:00:00.000Z",
      inputDeviceId: "mic-a",
      quality: "measured" as const,
      stale: false,
    };
    expect(markCalibrationForDevice(calibration, "mic-a").stale).toBe(false);
    expect(markCalibrationForDevice(calibration, "mic-b").stale).toBe(true);
  });
});
