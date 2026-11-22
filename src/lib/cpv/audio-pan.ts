export interface PanCurve {
  sampleRate: number;
  duration: number;
  values: number[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export async function computePanCurve(blob: Blob, sampleRate = 30): Promise<PanCurve | null> {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (buffer.numberOfChannels < 2) return null;
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const frames = Math.max(1, Math.floor(buffer.duration * sampleRate));
    const windowSize = Math.max(1, Math.floor(buffer.sampleRate / sampleRate));
    const raw = new Array<number>(frames);
    let earlyMax = 0;
    let smooth = 0;
    const earlyLimit = Math.min(frames, sampleRate * 45);

    for (let i = 0; i < frames; i += 1) {
      const start = i * windowSize;
      const end = Math.min(left.length, start + windowSize);
      let leftEnergy = 0;
      let rightEnergy = 0;
      let count = 0;
      for (let j = start; j < end; j += 4) {
        leftEnergy += left[j] * left[j];
        rightEnergy += right[j] * right[j];
        count += 1;
      }
      const l = Math.sqrt(leftEnergy / Math.max(1, count));
      const r = Math.sqrt(rightEnergy / Math.max(1, count));
      const pan = clamp((r - l) / (r + l + 1e-5), -1, 1);
      smooth = smooth * 0.55 + pan * 0.45;
      raw[i] = smooth;
      if (i < earlyLimit) earlyMax = Math.max(earlyMax, Math.abs(smooth));
    }

    // Normalize against the section the demo actually uses; centered mixes still get visible peaks.
    const gain = earlyMax > 0.02 ? Math.min(3, 0.85 / earlyMax) : 0;
    const values = raw.map((value) => {
      const boosted = clamp(value * gain, -1, 1);
      return Math.sign(boosted) * Math.pow(Math.abs(boosted), 0.6);
    });
    return { sampleRate, duration: buffer.duration, values };
  } catch {
    return null;
  } finally {
    void context.close().catch(() => undefined);
  }
}

export function panAt(curve: PanCurve | null | undefined, time: number) {
  if (!curve || curve.values.length === 0) return 0;
  const duration = Math.max(0.01, curve.duration);
  const wrapped = ((time % duration) + duration) % duration;
  const index = Math.min(
    curve.values.length - 1,
    Math.max(0, Math.floor(wrapped * curve.sampleRate)),
  );
  return curve.values[index] ?? 0;
}