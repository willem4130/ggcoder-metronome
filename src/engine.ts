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
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.beat = 0;
    this.bar = 0;
    this.visualQueue = [];
    this.nextBeatTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.visualQueue = [];
    void this.ctx?.suspend();
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

      this.visualQueue.push({
        time: this.nextBeatTime,
        beat: this.beat,
        bar: this.bar,
        muted: barMuted,
        bpm,
      });

      this.nextBeatTime += beatDur;
      this.beat += 1;
      if (this.beat >= s.beatsPerBar) {
        this.beat = 0;
        this.bar += 1;
      }
    }
  }
}
