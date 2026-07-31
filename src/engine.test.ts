import { describe, expect, it, vi } from "vitest";
import {
  AudioContextLeaseCounter,
  resolveScheduleAnchor,
  ScheduledBeatBus,
  shouldSuspendAudioContext,
  type VisualBeat,
} from "./engine";

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

describe("shared AudioContext lifecycle", () => {
  it("keeps the context active until every microphone/calibration lease is released", () => {
    const leases = new AudioContextLeaseCounter();
    leases.acquire();
    leases.acquire();
    expect(leases.active).toBe(2);
    expect(shouldSuspendAudioContext(false, leases.active)).toBe(false);

    expect(leases.release()).toBe(true);
    expect(shouldSuspendAudioContext(false, leases.active)).toBe(false);
    expect(leases.release()).toBe(true);
    expect(shouldSuspendAudioContext(false, leases.active)).toBe(true);
  });

  it("does not underflow or treat an unmatched release as real", () => {
    const leases = new AudioContextLeaseCounter();
    expect(leases.release()).toBe(false);
    expect(leases.active).toBe(0);
  });

  it("never suspends while metronome playback is running", () => {
    expect(shouldSuspendAudioContext(true, 0)).toBe(false);
  });
});

describe("scheduled audio-clock beat subscriptions", () => {
  const beat: VisualBeat = { time: 12.5, beat: 2, bar: 4, muted: true, bpm: 120 };

  it("publishes muted gap beats and supports idempotent unsubscribe", () => {
    const bus = new ScheduledBeatBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);
    bus.publish(beat);
    unsubscribe();
    unsubscribe();
    bus.publish({ ...beat, time: 13 });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(beat);
  });

  it("uses a stable listener snapshot when a listener unsubscribes during publish", () => {
    const bus = new ScheduledBeatBus();
    const second = vi.fn();
    let unsubscribeSecond: () => void = () => undefined;
    bus.subscribe(() => unsubscribeSecond());
    unsubscribeSecond = bus.subscribe(second);

    bus.publish(beat);
    expect(second).toHaveBeenCalledOnce();
    bus.publish(beat);
    expect(second).toHaveBeenCalledOnce();
  });
});
