import type { MediaAsset, Slot } from "./types";

export interface MixReport {
  clipRms: number;
  bgmRms: number;
  clipDb: number;
  bgmDb: number;
  suggestedBgmVolume: number;
}

const rmsCache = new Map<string, Promise<number>>();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

async function measureRms(blob: Blob, maxSeconds = 45): Promise<number> {
  if (typeof window === "undefined") return 0;
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return 0;
  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const limit = Math.min(buffer.length, Math.floor(buffer.sampleRate * maxSeconds));
    let sum = 0;
    let count = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < limit; i += 8) {
        sum += data[i] * data[i];
        count += 1;
      }
    }
    return Math.sqrt(sum / Math.max(1, count));
  } catch {
    return 0;
  } finally {
    void context.close().catch(() => undefined);
  }
}

export function measureAssetRms(asset: MediaAsset): Promise<number> {
  const key = asset.url;
  if (!rmsCache.has(key)) {
    rmsCache.set(
      key,
      (async () => {
        const blob = (asset.file ??
          (await fetch(asset.url).then((response) => response.blob()))) as Blob;
        return measureRms(blob);
      })().catch(() => 0),
    );
  }
  return rmsCache.get(key) ?? Promise.resolve(0);
}

export async function analyzeMixLevels(
  slots: Slot[],
  assets: MediaAsset[],
  bgm: MediaAsset | null,
  originalVolume = 1,
): Promise<MixReport | null> {
  if (!bgm) return null;
  const weights = new Map<string, number>();
  for (const slot of slots) {
    const asset = assets.find((item) => item.id === slot.assetId);
    if (!asset || asset.kind !== "video") continue;
    weights.set(asset.id, (weights.get(asset.id) ?? 0) + Math.max(0.05, slot.duration));
  }

  let clipEnergy = 0;
  let clipDuration = 0;
  for (const [assetId, duration] of weights) {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) continue;
    const rms = await measureAssetRms(asset);
    if (rms > 0) {
      clipEnergy += rms * rms * duration;
      clipDuration += duration;
    }
  }
  const rawClipRms = clipDuration > 0 ? Math.sqrt(clipEnergy / clipDuration) : 0;
  const clipRms = rawClipRms * clamp(originalVolume, 0, 1);
  const bgmRms = await measureAssetRms(bgm);
  const clipDb = 20 * Math.log10(Math.max(clipRms, 1e-5));
  const bgmDb = 20 * Math.log10(Math.max(bgmRms, 1e-5));

  let targetGain: number;
  if (clipRms < 0.002) {
    // 素材原声关闭时音乐就是主音床，不应被压低。
    targetGain = 0.9;
  } else if (clipRms < 0.01) {
    targetGain = 0.6;
  } else {
    // Keep music under the material's sound without making it inaudible.
    const desiredBgmDb = Math.max(-28, Math.min(-12, clipDb - 5));
    targetGain = Math.pow(10, (desiredBgmDb - bgmDb) / 20);
  }

  return {
    clipRms,
    bgmRms,
    clipDb,
    bgmDb,
    suggestedBgmVolume: clamp(targetGain, 0.2, 0.95),
  };
}