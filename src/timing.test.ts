import { describe, expect, it } from "vitest";
import {
  beatOnsets,
  bpmForBar,
  clampBpm,
  isBarMuted,
  TapTempo,
  type GapTrainer,
  type SpeedTrainer,
} from "./timing";

describe("clampBpm", () => {
  it("clamps to 30..260 and rounds", () => {
    expect(clampBpm(10)).toBe(30);
    expect(clampBpm(300)).toBe(260);
    expect(clampBpm(120.6)).toBe(121);
  });
});

describe("beatOnsets", () => {
  it("quarter only produces the downbeat", () => {
    const onsets = beatOnsets({ quarter: 1, eighth: 0, sixteenth: 0, triplet: 0 });
    expect(onsets).toEqual([{ offset: 0, layer: "quarter", gain: 1 }]);
  });

  it("stacks layers sorted by offset", () => {
    const onsets = beatOnsets({ quarter: 1, eighth: 0.5, sixteenth: 0.25, triplet: 0 });
    expect(onsets.map((o) => o.offset)).toEqual([0, 1 / 4, 1 / 2, 1 / 2, 3 / 4]);
    expect(onsets[0].layer).toBe("quarter");
  });

  it("triplet layer fills thirds", () => {
    const onsets = beatOnsets({ quarter: 0, eighth: 0, sixteenth: 0, triplet: 0.8 });
    expect(onsets).toEqual([
      { offset: 1 / 3, layer: "triplet", gain: 0.8 },
      { offset: 2 / 3, layer: "triplet", gain: 0.8 },
    ]);
  });

  it("silent mixer produces nothing", () => {
    expect(beatOnsets({ quarter: 0, eighth: 0, sixteenth: 0, triplet: 0 })).toEqual([]);
  });
});

describe("isBarMuted", () => {
  const gap: GapTrainer = { enabled: true, playBars: 4, muteBars: 2 };

  it("plays 4, mutes 2, repeats", () => {
    const pattern = Array.from({ length: 12 }, (_, i) => isBarMuted(gap, i));
    expect(pattern).toEqual([
      false, false, false, false, true, true,
      false, false, false, false, true, true,
    ]);
  });

  it("disabled trainer never mutes", () => {
    expect(isBarMuted({ ...gap, enabled: false }, 5)).toBe(false);
  });
});

describe("bpmForBar", () => {
  const up: SpeedTrainer = { enabled: true, toBpm: 180, stepBpm: 2, everyBars: 4 };

  it("ramps up every N bars and caps at target", () => {
    expect(bpmForBar(up, 120, 0)).toBe(120);
    expect(bpmForBar(up, 120, 3)).toBe(120);
    expect(bpmForBar(up, 120, 4)).toBe(122);
    expect(bpmForBar(up, 120, 8)).toBe(124);
    expect(bpmForBar(up, 120, 4000)).toBe(180);
  });

  it("ramps down toward a lower target", () => {
    const down: SpeedTrainer = { enabled: true, toBpm: 60, stepBpm: 5, everyBars: 2 };
    expect(bpmForBar(down, 100, 2)).toBe(95);
    expect(bpmForBar(down, 100, 400)).toBe(60);
  });

  it("disabled trainer returns start BPM", () => {
    expect(bpmForBar({ ...up, enabled: false }, 120, 40)).toBe(120);
  });
});

describe("TapTempo", () => {
  it("returns null on first tap, then averages intervals", () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(500)).toBe(120);
    expect(t.tap(1000)).toBe(120);
  });

  it("resets after a 2 second pause", () => {
    const t = new TapTempo();
    t.tap(0);
    t.tap(500);
    expect(t.tap(5000)).toBeNull();
    expect(t.tap(5250)).toBe(240);
  });

  it("clamps absurdly fast tapping", () => {
    const t = new TapTempo();
    t.tap(0);
    expect(t.tap(50)).toBe(260);
  });
});
