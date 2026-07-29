import type { Voice } from "./state";

/** Synthesized click voices. No samples, no network. */
export function scheduleHit(
  ctx: AudioContext,
  destination: AudioNode,
  voice: Voice,
  time: number,
  gain: number,
  accented: boolean,
): void {
  if (gain <= 0) return;
  const env = ctx.createGain();
  env.connect(destination);

  const peak = gain * (accented ? 1 : 0.72);

  switch (voice) {
    case "click": {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = accented ? 2600 : 1800;
      env.gain.setValueAtTime(peak, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
      osc.connect(env);
      osc.start(time);
      osc.stop(time + 0.03);
      break;
    }
    case "wood": {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(accented ? 1250 : 850, time);
      osc.frequency.exponentialRampToValueAtTime(accented ? 700 : 480, time + 0.05);
      env.gain.setValueAtTime(peak, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
      osc.connect(env);
      osc.start(time);
      osc.stop(time + 0.06);
      break;
    }
    case "beep": {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = accented ? 1760 : 880;
      env.gain.setValueAtTime(0.0001, time);
      env.gain.exponentialRampToValueAtTime(peak, time + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
      osc.connect(env);
      osc.start(time);
      osc.stop(time + 0.1);
      break;
    }
  }
}
