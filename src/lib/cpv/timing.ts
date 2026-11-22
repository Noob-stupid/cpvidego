import type { MediaAsset } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface FittedSource {
  sourceIn: number;
  sourceOut: number;
  speed: number;
}

export interface FitLimits {
  minSpeed?: number;
  maxSpeed?: number;
}

/**
 * 槽位时长固定为参考切点间隔；素材取段长度自适应，使速度落在观感安全区。
 * 取段太短就多用一点原片、太长就少用一点，避免 7× 快进或近静止。
 */
export function fitAssetToSlot(
  asset: MediaAsset,
  slotDuration: number,
  limits: FitLimits = {},
): FittedSource {
  const minSpeed = limits.minSpeed ?? 0.4;
  const maxSpeed = limits.maxSpeed ?? 2.5;
  const duration = Math.max(0.1, slotDuration);
  if (asset.kind === "image") {
    return { sourceIn: 0, sourceOut: duration, speed: 1 };
  }
  const sourceIn = Math.max(0, asset.sourceIn ?? 0);
  const available = Math.max(0.05, (asset.duration ?? sourceIn + duration) - sourceIn);
  const hasRange = asset.sourceIn != null || asset.sourceOut != null;
  const trimmed = hasRange
    ? Math.max(0.05, (asset.sourceOut ?? sourceIn + duration) - sourceIn)
    : duration;
  const desired = clamp(trimmed, minSpeed * duration, maxSpeed * duration);
  // 需要变长时最多只多取 0.35s，避免把黑场/转场也拉进来。
  const used = Math.min(available, desired > trimmed ? Math.min(desired, trimmed + 0.35) : desired);
  const sourceOut = sourceIn + used;
  const speed = clamp(used / duration, 0.0625, 8);
  return { sourceIn, sourceOut, speed };
}

export function sourceSpeedForSlot(sourceIn: number, sourceOut: number, slotDuration: number) {
  return clamp((sourceOut - sourceIn) / Math.max(0.1, slotDuration), 0.0625, 8);
}
