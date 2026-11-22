import { buildColorGrade } from "./color-match";
import { buildCompositionAdjust } from "./composition";
import { shouldMirrorX } from "./motion";
import { tagCompatibility } from "./ai/tagging";
import { fitAssetToSlot } from "./timing";
import type { BeatPlan } from "./plan-beat";
import type { AnalysisResult, MediaAsset, Shot, ShotTags, Slot, SlotEffects } from "./types";

const round2 = (value: number) => Math.round(value * 100) / 100;

export function isUsableAsset(asset: MediaAsset) {
  if (asset.kind !== "video" || !asset.colorStats) return true;
  const { luma, saturation } = asset.colorStats;
  return luma >= 20 && !(luma > 242 && saturation < 0.04);
}

export function usablePool(userAssets: MediaAsset[]) {
  const usable = userAssets.filter(isUsableAsset);
  return usable.length ? usable : userAssets;
}

/** 与参考镜头的色调距离 + 复用惩罚，决定这一槽用哪条素材。 */
export function pickAssetForSlot(
  slot: Slot,
  pool: MediaAsset[],
  usage: Map<string, number>,
  targetTags?: ShotTags,
): MediaAsset {
  const fallback = pool[slot.index % Math.max(1, pool.length)] ?? pool[0];
  if (!slot.targetColor) return fallback;
  const scored = pool.filter((asset) => asset.colorStats);
  if (!scored.length) return fallback;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestAsset = fallback;
  for (const candidate of scored) {
    const stats = candidate.colorStats;
    if (!stats) continue;
    const lumaDistance = Math.abs(stats.luma - slot.targetColor.luma) / 255;
    const saturationDistance = Math.abs(stats.saturation - slot.targetColor.saturation);
    const contrastDistance = Math.abs(stats.contrast - slot.targetColor.contrast) / 80;
    const usagePenalty = (usage.get(candidate.id) ?? 0) * 0.12;
    const compat = targetTags ? tagCompatibility(candidate.tags, targetTags) : null;
    const stylePenalty = compat ? (1 - compat.score) * 0.3 : 0;
    const score =
      lumaDistance * 0.6 +
      saturationDistance * 0.25 +
      contrastDistance * 0.15 +
      usagePenalty +
      stylePenalty;
    if (score < bestScore) {
      bestScore = score;
      bestAsset = candidate;
    }
  }
  return bestAsset;
}

export function applyAssetToSlot(slot: Slot, asset: MediaAsset): Slot {
  const fitted = fitAssetToSlot(asset, slot.duration);
  return {
    ...slot,
    assetId: asset.id,
    ...fitted,
    volume: 1,
    thumbnailUrl: asset.thumbnailUrl || slot.thumbnailUrl,
    colorGrade:
      asset.colorStats && slot.targetColor
        ? buildColorGrade(asset.colorStats, slot.targetColor)
        : undefined,
    mirrorX: shouldMirrorX(slot.targetMotion, asset.motionStats),
    composition: buildCompositionAdjust(asset.compositionStats, slot.targetComposition),
  };
}

export interface DraftOptions {
  allowCrossSource?: boolean;
  useTags?: boolean;
  targetTags?: ShotTags;
}

export function assignAssets(
  slots: Slot[],
  userAssets: MediaAsset[],
  options: DraftOptions = {},
) {
  const scoped = options.allowCrossSource
    ? userAssets
    : userAssets.filter((asset) => !asset.sourceTag);
  let pool = usablePool(scoped.length ? scoped : userAssets);
  if (options.useTags && options.targetTags) {
    const filtered = pool.filter(
      (asset) => !tagCompatibility(asset.tags, options.targetTags).hardReject,
    );
    if (filtered.length) pool = filtered;
  }
  const usage = new Map<string, number>();
  const nextSlots = slots.map((slot) => {
    const asset = pickAssetForSlot(slot, pool, usage, options.useTags ? options.targetTags : undefined);
    usage.set(asset.id, (usage.get(asset.id) ?? 0) + 1);
    return applyAssetToSlot(slot, asset);
  });
  return {
    slots: nextSlots,
    pool,
    skipped: userAssets.length - pool.length,
    usedAssetCount: usage.size,
  };
}

/** 按参考镜头能量分配效果，阈值与既有 UI 行为保持一致。 */
export function autoEffects(slots: Slot[], shots: Shot[]): Slot[] {
  const maxDiff = Math.max(0.001, ...shots.map((shot) => shot.diff));
  return slots.map((slot) => {
    const shot = shots.find((item) => item.id === slot.shotId);
    const energy = Math.min(1, Math.max(0, (shot?.diff ?? 0) / maxDiff));
    const effects: SlotEffects = {};
    const rhythmFlash = slot.duration < 0.45 && slot.index % 3 === 0;
    if (energy > 0.38 || rhythmFlash) {
      effects.flash = rhythmFlash && energy <= 0.38 ? 0.3 : round2(0.32 + energy * 0.32);
    }
    // 震屏/故障只给真正的高能量重拍，避免按序号硬塞造成"莫名其妙的抖动"。
    if (energy > 0.62) {
      effects.shake = round2(0.2 + energy * 0.26);
    }
    if (slot.duration > 0.85) {
      effects.zoom =
        slot.index % 4 === 0 ? -round2(0.24 + energy * 0.12) : round2(0.3 + energy * 0.18);
    }
    if (energy > 0.78 && slot.index % 3 === 1) {
      effects.rgb = round2(0.27 + energy * 0.12);
    }
    if (energy > 0.88 && slot.index % 4 === 3) {
      effects.glitch = round2(0.23 + energy * 0.12);
    }
    return { ...slot, effects: Object.keys(effects).length ? effects : undefined };
  });
}

export interface StyleDraftResult {
  slots: Slot[];
  skipped: number;
  usedAssetCount: number;
}

/** 风格复刻一键初剪：选材 → 匹配 → 效果，一次算完，不需要人逐步点。 */
export function buildStyleDraft(
  analysis: AnalysisResult,
  slots: Slot[],
  assets: MediaAsset[],
  options: DraftOptions = {},
): StyleDraftResult {
  const userAssets = assets.filter((asset) => asset.origin === "user");
  if (!userAssets.length) return { slots, skipped: 0, usedAssetCount: 0 };
  const assigned = assignAssets(slots, userAssets, options);
  return {
    slots: autoEffects(assigned.slots, analysis.shots),
    skipped: assigned.skipped,
    usedAssetCount: assigned.usedAssetCount,
  };
}

const ROLE_LABEL: Record<string, string> = {
  hit: "重拍慢放",
  lead: "冲刺",
  fill: "过门",
};

/** 卡点初剪：单条长素材 + 节拍网格 → 可直接进预览/导出的槽位。 */
export function beatPlanToSlots(plan: BeatPlan, asset: MediaAsset): Slot[] {
  return plan.slots.map((spec) => ({
    id: `beat_${spec.index}`,
    index: spec.index,
    shotId: `beat_${spec.index}`,
    label: `${ROLE_LABEL[spec.role] ?? "镜头"} ${String(spec.index + 1).padStart(2, "0")}`,
    start: spec.start,
    end: spec.end,
    duration: spec.duration,
    thumbnailUrl: asset.thumbnailUrl ?? "",
    assetId: asset.id,
    sourceIn: spec.sourceIn,
    sourceOut: spec.sourceOut,
    speed: spec.speed,
    volume: spec.muted ? 0 : 1,
    effectTags: [spec.role],
    effects: Object.keys(spec.effects).length ? spec.effects : undefined,
    effectScale: 1,
  }));
}
