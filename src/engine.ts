import type { Settings } from "./state";
import { scheduleHit } from "./voices";
import { beatOnsets, bpmForBar, isBarMuted } from "./timing";

export interface VisualBeat {
  time: number;
  beat: number;
  bar: number;
  muted: boolean;
  bpm: number;
}

const LOOKAHEAD_S = 0.1;
const TICK_MS = 25;
const START_LEAD_S = 0.08;
const STALE_TOLERANCE_S = 0.05;

export interface ScheduleAnchor {
  nextBeatTime: number;
  resynced: boolean;
}

export class AudioContextLeaseCounter {
  private count = 0;

  get active(): number {
    return this.count;
  }

  acquire(): void {
    this.count += 1;
  }

  release(): boolean {
    if (this.count === 0) return false;
    this.count -= 1;
    return true;
  }
}

export class ScheduledBeatBus {
  private readonly listeners = new Set<(beat: VisualBeat) => void>();

  subscribe(listener: (beat: VisualBeat) => void): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  publish(beat: VisualBeat): void {
    for (const listener of [...this.listeners]) listener(beat);
  }
}

export function shouldSuspendAudioContext(running: boolean, activeLeases: number): boolean {
  return !running && activeLeases === 0;
}

/** Pure stale-clock guard used by the audio scheduler and unit tests. */
export function resolveScheduleAnchor(
  nextBeatTime: number,
  currentTime: number,
): ScheduleAnchor {
  if (nextBeatTime < currentTime - STALE_TOLERANCE_S) {
    return { nextBeatTime: currentTime + START_LEAD_S, resynced: true };
  }
  return { nextBeatTime, resynced: false };
}

/**
 * Lookahead scheduler (the standard "A Tale of Two Clocks" pattern):
 * a coarse setInterval wakes up every 25 ms and schedules every hit that
 * falls inside the next 100 ms on the sample-accurate AudioContext clock.
 */
export class MetronomeEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeatTime = 0;
  private beat = 0;
  private bar = 0;
  private visualQueue: VisualBeat[] = [];
  private readonly audioContextLeases = new AudioContextLeaseCounter();
  private readonly scheduledBeats = new ScheduledBeatBus();

  constructor(private getSettings: () => Settings) {}

  get running(): boolean {
    return this.timer !== null;
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** BPM actually sounding right now (speed trainer may have ramped it). */
  get effectiveBpm(): number {
    const s = this.getSettings();
    return bpmForBar(s.speed, s.bpm, this.bar);
  }

  async start(): Promise<void> {
    if (this.running) return;
    const ctx = await this.ensureAudioContext();
    this.beat = 0;
    this.bar = 0;
    this.visualQueue = [];
    this.nextBeatTime = ctx.currentTime + START_LEAD_S;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.visualQueue = [];
    this.suspendIfIdle();
  }

  /** Keeps the shared clock alive for microphone analysis, including free-play mode. */
  async acquireAudioContext(): Promise<AudioContext> {
    const context = await this.ensureAudioContext();
    this.audioContextLeases.acquire();
    return context;
  }

  releaseAudioContext(): void {
    if (this.audioContextLeases.release()) this.suspendIfIdle();
  }

  onScheduledBeat(listener: (beat: VisualBeat) => void): () => void {
    return this.scheduledBeats.subscribe(listener);
  }

  /** Clears stale visuals and repairs stale lookahead without changing musical counters. */
  resync(): void {
    if (!this.running || !this.ctx) return;
    this.visualQueue = [];
    this.nextBeatTime = resolveScheduleAnchor(
      this.nextBeatTime,
      this.ctx.currentTime,
    ).nextBeatTime;
  }

  /** Pops beats whose time has arrived, for the rAF-driven visualizer. */
  takeDueVisuals(): VisualBeat[] {
    if (!this.ctx) return [];
    const now = this.ctx.currentTime;
    const due: VisualBeat[] = [];
    while (this.visualQueue.length > 0 && this.visualQueue[0].time <= now) {
      due.push(this.visualQueue.shift()!);
    }
    return due;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const s = this.getSettings();
    master.gain.value = s.masterVolume;
    const anchor = resolveScheduleAnchor(this.nextBeatTime, ctx.currentTime);
    this.nextBeatTime = anchor.nextBeatTime;
    if (anchor.resynced) this.visualQueue = [];

    while (this.nextBeatTime < ctx.currentTime + LOOKAHEAD_S) {
      const bpm = bpmForBar(s.speed, s.bpm, this.bar);
      const beatDur = 60 / bpm;
      const barMuted = isBarMuted(s.gap, this.bar);
      const accent = s.accents[this.beat] ?? "normal";

      if (!barMuted) {
        for (const onset of beatOnsets(s.mix)) {
          const isDownbeat = onset.offset === 0 && onset.layer === "quarter";
          if (isDownbeat && accent === "mute") continue;
          scheduleHit(
            ctx,
            master,
            s.voice,
            this.nextBeatTime + onset.offset * beatDur,
            isDownbeat ? onset.gain : onset.gain * 0.8,
            isDownbeat && accent === "accent",
          );
        }
      }

      const visualBeat: VisualBeat = {
        time: this.nextBeatTime,
        beat: this.beat,
        bar: this.bar,
        muted: barMuted,
        bpm,
      };
      this.visualQueue.push(visualBeat);
      this.scheduledBeats.publish(visualBeat);

      this.nextBeatTime += beatDur;
      this.beat += 1;
      if (this.beat >= s.beatsPerBar) {
        this.beat = 0;
        this.bar += 1;
      }
    }
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  private suspendIfIdle(): void {
    if (!shouldSuspendAudioContext(this.running, this.audioContextLeases.active)) return;
    void this.ctx?.suspend().catch(() => undefined);
  }
}
