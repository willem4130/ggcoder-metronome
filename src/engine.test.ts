import { describe, expect, it } from "vitest";
import { resolveScheduleAnchor } from "./engine";

describe("scheduler and visibility-resync clock anchoring", () => {
  it("preserves an already-scheduled future beat during visibility resync", () => {
    expect(resolveScheduleAnchor(10.04, 10)).toEqual({
      nextBeatTime: 10.04,
      resynced: false,
    });
  });

  it("re-anchors a stale visibility-resync time ahead of the audio clock", () => {
    expect(resolveScheduleAnchor(9, 10)).toEqual({
      nextBeatTime: 10.08,
      resynced: true,
    });
  });

  it("does not overreact to small scheduler jitter", () => {
    expect(resolveScheduleAnchor(9.97, 10)).toEqual({
      nextBeatTime: 9.97,
      resynced: false,
    });
  });
});
