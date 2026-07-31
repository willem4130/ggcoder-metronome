import { describe, expect, it } from "vitest";
import {
  calculateTimingScore,
  DEFAULT_ANALYSIS_PREFERENCES,
  estimatePulseBpm,
  estimateTempo,
  normalizeAnalysisPreferences,
  TimingAnalysisSession,
  type AnalysisSubdivision,
} from "./performance-analysis";

function addMetronomeHits(
  deviationsMs: number[],
  bpm = 120,
  subdivision: AnalysisSubdivision = 1,
): TimingAnalysisSession {
  const session = new TimingAnalysisSession("metronome", {
    ...DEFAULT_ANALYSIS_PREFERENCES,
    subdivision,
  });
  const beatDuration = 60 / bpm;
  for (let beat = 0; beat < Math.ceil(deviationsMs.length / subdivision); beat += 1) {
    session.addReferenceBeat(beat * beatDuration, bpm);
    for (let pulse = 0; pulse < subdivision; pulse += 1) {
      const hitIndex = beat * subdivision + pulse;
      if (hitIndex >= deviationsMs.length) break;
      session.addOnset(
        beat * beatDuration + pulse * beatDuration / subdivision + deviationsMs[hitIndex] / 1000,
      );
    }
  }
  return session;
}

describe("confidence-weighted tempo estimation", () => {
  it("estimates quarter, eighth, and sixteenth selected pulses", () => {
    expect(estimatePulseBpm([0, 0.5, 1, 1.5, 2], 1)).toBeCloseTo(120);
    expect(estimatePulseBpm([0, 0.25, 0.5, 0.75, 1], 2)).toBeCloseTo(120);
    expect(estimatePulseBpm([0, 0.125, 0.25, 0.375, 0.5], 4)).toBeCloseTo(120);
  });

  it("covers the supported 30–260 BPM range", () => {
    for (const bpm of [30, 60, 120, 200, 260]) {
      const interval = 60 / bpm;
      const onsets = Array.from({ length: 12 }, (_, index) => index * interval);
      expect(estimatePulseBpm(onsets, 1)).toBeCloseTo(bpm, 4);
    }
  });

  it("resists one missed hit and one duplicate", () => {
    const missed = [0, 0.5, 1, 2, 2.5, 3, 3.5, 4];
    expect(estimatePulseBpm(missed, 1)).toBeCloseTo(120, 0);
    const duplicate = [0, 0.5, 1, 1.04, 1.5, 2, 2.5, 3];
    expect(estimatePulseBpm(duplicate, 1)).toBeCloseTo(120, 0);
  });

  it("reports strong confidence only after enough consistent evidence", () => {
    expect(estimateTempo([0, 0.5], 1)).toEqual({ bpm: null, confidence: 0 });
    expect(estimateTempo([0, 0.5, 1, 1.5, 2, 2.5], 1).confidence).toBeGreaterThan(0.8);
  });
});

describe("metronome target matching", () => {
  it("measures exact, early, and late phase against audio-clock targets", () => {
    const session = addMetronomeHits([0, -12, 15, 0, -8, 9, 0, 0]);
    const snapshot = session.snapshot();
    expect(snapshot.currentDeviationMs).toBeCloseTo(0);
    expect(snapshot.earlyCount).toBe(2);
    expect(snapshot.onTimeCount).toBe(4);
    expect(snapshot.lateCount).toBe(2);
    expect(snapshot.analyzedHits).toBe(8);
  });

  it("expands quarter references into the selected subdivision grid", () => {
    const session = addMetronomeHits(Array(12).fill(5), 120, 4);
    expect(session.snapshot().analyzedHits).toBe(12);
    expect(session.snapshot().bpm).toBeCloseTo(120, 0);
    expect(session.snapshot().pulseDurationMs).toBe(125);
  });

  it("keeps targets in muted gap bars because scheduled beats remain references", () => {
    const session = new TimingAnalysisSession("metronome", DEFAULT_ANALYSIS_PREFERENCES);
    session.addReferenceBeat(0, 120);
    session.addReferenceBeat(0.5, 120); // The engine may label this scheduled beat muted.
    session.addOnset(0);
    session.addOnset(0.5);
    expect(session.snapshot().analyzedHits).toBe(2);
  });

  it("keeps only the closest flam/duplicate for one target", () => {
    const session = new TimingAnalysisSession("metronome", DEFAULT_ANALYSIS_PREFERENCES);
    session.addReferenceBeat(1, 120);
    session.addOnset(1.03);
    session.addOnset(1.01);
    session.addOnset(1.04);
    expect(session.snapshot().detectedHits).toBe(3);
    expect(session.snapshot().analyzedHits).toBe(1);
    expect(session.snapshot().currentDeviationMs).toBeCloseTo(10);
  });

  it("does not match a hit outside the honest target window", () => {
    const session = new TimingAnalysisSession("metronome", DEFAULT_ANALYSIS_PREFERENCES);
    session.addReferenceBeat(1, 120);
    session.addOnset(1.3);
    expect(session.snapshot().analyzedHits).toBe(0);
  });

  it("applies calibrated device offset before matching", () => {
    const session = new TimingAnalysisSession("metronome", {
      ...DEFAULT_ANALYSIS_PREFERENCES,
      inputOffsetMs: 20,
    });
    session.addReferenceBeat(1, 120);
    expect(session.addOnset(1.02).currentDeviationMs).toBeCloseTo(0);
  });
});

describe("free-play baseline", () => {
  it("locks after eight confident hits, then reports interval deviation without phase claims", () => {
    const session = new TimingAnalysisSession("free", DEFAULT_ANALYSIS_PREFERENCES);
    for (let index = 0; index < 8; index += 1) session.addOnset(index * 0.5);
    expect(session.snapshot().analyzedHits).toBe(0);
    session.addOnset(4.01);
    const snapshot = session.snapshot();
    expect(snapshot.mode).toBe("free");
    expect(snapshot.currentDeviationMs).toBeCloseTo(10);
    expect(snapshot.analyzedHits).toBe(1);
    expect(snapshot.score).toBeNull();
  });

  it("surfaces gradual tempo drift instead of moving the baseline to the newest hit", () => {
    const session = new TimingAnalysisSession("free", DEFAULT_ANALYSIS_PREFERENCES);
    let time = 0;
    for (let index = 0; index < 10; index += 1) {
      session.addOnset(time);
      time += 0.5;
    }
    for (let index = 0; index < 20; index += 1) {
      time += index * 0.0008;
      session.addOnset(time);
      time += 0.5;
    }
    expect(Math.abs(session.snapshot().driftPercent ?? 0)).toBeGreaterThan(0.2);
    expect(session.snapshot().averageOffsetMs).not.toBe(0);
  });

  it("does not jump to half tempo after one long interval", () => {
    const session = new TimingAnalysisSession("free", DEFAULT_ANALYSIS_PREFERENCES);
    for (let index = 0; index < 12; index += 1) session.addOnset(index * 0.5);
    const before = session.snapshot().bpm;
    session.addOnset(6.5);
    expect(before).toBeCloseTo(120, 0);
    expect(session.snapshot().bpm).toBeGreaterThan(100);
  });
});

describe("transparent score and state transitions", () => {
  it("withholds score until eight analyzed hits", () => {
    expect(addMetronomeHits(Array(7).fill(0)).snapshot().score).toBeNull();
    expect(addMetronomeHits(Array(8).fill(0)).snapshot().score).toBe(100);
  });

  it("uses normalized RMS error relative to the selected pulse", () => {
    expect(calculateTimingScore(0, 500)).toBe(100);
    expect(calculateTimingScore(10, 500)).toBe(90);
    expect(calculateTimingScore(100, 500)).toBe(0);
    expect(addMetronomeHits(Array(8).fill(10)).snapshot().score).toBe(90);
  });

  it("resets incompatible measurements on mode or subdivision changes", () => {
    const session = addMetronomeHits(Array(8).fill(0));
    expect(session.setMode("free")).toBe(true);
    expect(session.snapshot().detectedHits).toBe(0);
    expect(session.setMode("free")).toBe(false);
    session.addOnset(0);
    session.setSubdivision(2);
    expect(session.snapshot().detectedHits).toBe(0);
  });
});

describe("normalizeAnalysisPreferences", () => {
  it("repairs malformed persisted preferences and clamps offset", () => {
    expect(normalizeAnalysisPreferences({
      subdivision: 3,
      sensitivity: "extreme",
      inputOffsetMs: 999,
    })).toEqual({ subdivision: 1, sensitivity: "medium", inputOffsetMs: 250 });
    expect(normalizeAnalysisPreferences({
      subdivision: 4,
      sensitivity: "high",
      inputOffsetMs: -42.4,
    })).toEqual({ subdivision: 4, sensitivity: "high", inputOffsetMs: -42 });
  });
});
