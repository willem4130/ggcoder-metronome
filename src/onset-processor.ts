import { OnsetDetectorCore, type OnsetSensitivity } from "./onset-detector";

declare const currentTime: number;
declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][]): boolean;
}

type ProcessorCommand = { type: "sensitivity"; value: OnsetSensitivity };

function isProcessorCommand(value: unknown): value is ProcessorCommand {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "sensitivity"
    && (candidate.value === "low" || candidate.value === "medium" || candidate.value === "high");
}

class OnsetProcessor extends AudioWorkletProcessor {
  private readonly detector = new OnsetDetectorCore(sampleRate);
  private lastLevelReportTime = Number.NEGATIVE_INFINITY;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      if (isProcessorCommand(event.data)) this.detector.setSensitivity(event.data.value);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const result = this.detector.process(
      inputs[0]?.[0],
      inputs[1]?.[0],
      inputs[2]?.[0],
      currentTime,
    );
    if (result.detected) {
      this.port.postMessage({
        type: "onset",
        time: result.onsetTime,
        strength: result.strength,
        detectorDelaySeconds: result.algorithmicDelaySeconds,
      });
    }
    if (currentTime - this.lastLevelReportTime >= 0.05) {
      this.lastLevelReportTime = currentTime;
      this.port.postMessage({ type: "level", level: result.level });
    }
    return true;
  }
}

registerProcessor("ggcoder-onset-detector", OnsetProcessor);
