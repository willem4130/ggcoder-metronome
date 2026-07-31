import onsetProcessorUrl from "./onset-processor.ts?worker&url";
import type { AnalysisSensitivity } from "./performance-analysis";

export interface AudioContextLease {
  acquireAudioContext(): Promise<AudioContext>;
  releaseAudioContext(): void;
}

export interface MicrophoneInputStatus {
  deviceId: string | null;
  label: string;
  latencySeconds: number | null;
  autoGainControl: boolean | null;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  browserProcessingActive: boolean;
}

export interface MicrophoneAnalyzerCallbacks {
  onOnset(time: number, strength: number, detectorDelaySeconds: number): void;
  onLevel(level: number): void;
  onInputStatus(status: MicrophoneInputStatus): void;
  onUnexpectedStop(message: string): void;
}

type WorkletMessage =
  | { type: "onset"; time: number; strength: number; detectorDelaySeconds: number }
  | { type: "level"; level: number };

const ANALYZER_CANCELLED = "Microphone start cancelled";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWorkletMessage(value: unknown): value is WorkletMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "level") return isFiniteNumber(candidate.level);
  return candidate.type === "onset"
    && isFiniteNumber(candidate.time)
    && isFiniteNumber(candidate.strength)
    && isFiniteNumber(candidate.detectorDelaySeconds);
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function describeInputTrack(track: MediaStreamTrack): MicrophoneInputStatus {
  const settings = track.getSettings();
  const extendedSettings = settings as MediaTrackSettings & { latency?: number };
  const autoGainControl = optionalBoolean(settings.autoGainControl);
  const echoCancellation = optionalBoolean(settings.echoCancellation);
  const noiseSuppression = optionalBoolean(settings.noiseSuppression);
  return {
    deviceId: typeof settings.deviceId === "string" && settings.deviceId ? settings.deviceId : null,
    label: track.label || "Default microphone",
    latencySeconds: isFiniteNumber(extendedSettings.latency) ? extendedSettings.latency : null,
    autoGainControl,
    echoCancellation,
    noiseSuppression,
    browserProcessingActive: autoGainControl === true
      || echoCancellation === true
      || noiseSuppression === true,
  };
}

export function microphoneErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === ANALYZER_CANCELLED) {
    return "Microphone start was cancelled.";
  }
  if (!(error instanceof DOMException)) {
    return error instanceof Error && error.message
      ? error.message
      : "Microphone analysis could not start. Check browser support and try again.";
  }
  switch (error.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was blocked. Allow microphone access in browser settings, then retry.";
    case "NotFoundError":
      return "No microphone was found. Connect an input device, then retry.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is busy or unavailable. Close other audio apps, then retry.";
    case "OverconstrainedError":
      return "The microphone cannot provide the requested input. Choose another device, then retry.";
    default:
      return "Microphone analysis could not start. Check the input device, then retry.";
  }
}

export class MicrophoneAnalyzer {
  private stream: MediaStream | null = null;
  private pendingStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private worklet: AudioWorkletNode | null = null;
  private silentOutput: GainNode | null = null;
  private contextLeased = false;
  private sensitivity: AnalysisSensitivity = "medium";
  private startPromise: Promise<void> | null = null;
  private transition = 0;

  constructor(
    private readonly audioLease: AudioContextLease,
    private readonly callbacks: MicrophoneAnalyzerCallbacks,
  ) {}

  get running(): boolean {
    return this.stream !== null;
  }

  get transitioning(): boolean {
    return this.startPromise !== null;
  }

  start(sensitivity: AnalysisSensitivity): Promise<void> {
    if (this.running) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.sensitivity = sensitivity;
    const transition = ++this.transition;
    const operation = this.startInternal(transition);
    this.startPromise = operation.finally(() => {
      if (this.startPromise === operation || this.startPromise !== null) this.startPromise = null;
    });
    return this.startPromise;
  }

  stop(): void {
    this.transition += 1;
    this.stopTracks(this.pendingStream);
    this.pendingStream = null;
    this.stopTracks(this.stream);
    this.stream = null;
    this.disconnectNodes();
    this.releaseContext();
    this.callbacks.onLevel(0);
  }

  setSensitivity(sensitivity: AnalysisSensitivity): void {
    this.sensitivity = sensitivity;
    this.worklet?.port.postMessage({ type: "sensitivity", value: sensitivity });
  }

  private async startInternal(transition: number): Promise<void> {
    let stream: MediaStream | null = null;
    try {
      const context = await this.audioLease.acquireAudioContext();
      this.contextLeased = true;
      this.assertCurrent(transition);
      if (!context.audioWorklet) {
        throw new Error("This browser does not support low-latency AudioWorklet analysis.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone capture requires HTTPS or localhost in a supported browser.");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
        },
        video: false,
      });
      this.pendingStream = stream;
      this.assertCurrent(transition);
      await context.audioWorklet.addModule(onsetProcessorUrl);
      this.assertCurrent(transition);

      const source = context.createMediaStreamSource(stream);
      const low = context.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 220;
      low.Q.value = 0.7;
      const mid = context.createBiquadFilter();
      mid.type = "bandpass";
      mid.frequency.value = 1_100;
      mid.Q.value = 0.65;
      const high = context.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 2_800;
      high.Q.value = 0.7;
      const worklet = new AudioWorkletNode(context, "ggcoder-onset-detector", {
        numberOfInputs: 3,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      this.source = source;
      this.filters = [low, mid, high];
      this.worklet = worklet;
      this.silentOutput = silentOutput;
      source.connect(low).connect(worklet, 0, 0);
      source.connect(mid).connect(worklet, 0, 1);
      source.connect(high).connect(worklet, 0, 2);
      worklet.connect(silentOutput).connect(context.destination);
      worklet.port.postMessage({ type: "sensitivity", value: this.sensitivity });
      worklet.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!isWorkletMessage(event.data)) return;
        if (event.data.type === "onset") {
          this.callbacks.onOnset(
            event.data.time,
            event.data.strength,
            event.data.detectorDelaySeconds,
          );
        } else {
          this.callbacks.onLevel(event.data.level);
        }
      };
      worklet.onprocessorerror = () => this.handleUnexpectedStop(
        "Low-latency microphone processing stopped. End the session and retry.",
      );
      for (const track of stream.getTracks()) {
        track.onended = () => this.handleUnexpectedStop(
          "The microphone disconnected. Reconnect it, then start a new session.",
        );
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new DOMException("No audio track", "NotFoundError");
      this.pendingStream = null;
      this.stream = stream;
      this.callbacks.onInputStatus(describeInputTrack(audioTrack));
    } catch (error) {
      this.stopTracks(stream);
      if (this.pendingStream === stream) this.pendingStream = null;
      this.disconnectNodes();
      this.releaseContext();
      throw error;
    }
  }

  private assertCurrent(transition: number): void {
    if (transition !== this.transition) throw new Error(ANALYZER_CANCELLED);
  }

  private handleUnexpectedStop(message: string): void {
    if (!this.stream) return;
    this.stop();
    this.callbacks.onUnexpectedStop(message);
  }

  private stopTracks(stream: MediaStream | null): void {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      track.onended = null;
      track.stop();
    }
  }

  private disconnectNodes(): void {
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.onprocessorerror = null;
      this.worklet.port.close();
    }
    this.source?.disconnect();
    for (const filter of this.filters) filter.disconnect();
    this.worklet?.disconnect();
    this.silentOutput?.disconnect();
    this.source = null;
    this.filters = [];
    this.worklet = null;
    this.silentOutput = null;
  }

  private releaseContext(): void {
    if (!this.contextLeased) return;
    this.contextLeased = false;
    this.audioLease.releaseAudioContext();
  }
}
