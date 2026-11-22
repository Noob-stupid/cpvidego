import { buildColorGrade } from "../color-match";
import { buildCompositionAdjust } from "../composition";
import { shouldMirrorX } from "../motion";
import { fitAssetToSlot } from "../timing";
import type { MediaAsset, Slot, SlotEffects } from "../types";
import type { EditProposal, SlotEffectPatch } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface ApplyResult {
  slots: Slot[];
  reasons: Record<string, string>;
  applied: number;
  rejected: string[];
}

function resolveSlot(slots: Slot[], ref: string | number): Slot | undefined {
  if (typeof ref === "number") return slots[ref];
  return slots.find((slot) => slot.id === ref || slot.shotId === ref);
}

const EFFECT_KEYS: (keyof SlotEffects)[] = ["flash", "shake", "zoom", "rgb", "glitch", "grade"];

/** 把 AI 的提案落到槽位上；只接受已知 id，越界/未知一律拒绝并记录。 */
export function applyProposal(
  slots: Slot[],
  assets: MediaAsset[],
  proposal: EditProposal,
): ApplyResult {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const next = slots.map((slot) => ({ ...slot }));
  const reasons: Record<string, string> = {};
  const rejected: string[] = [];
  let applied = 0;

  for (const assignment of proposal.assignments ?? []) {
    const slot = resolveSlot(next, assignment.slot);
    const asset = assetById.get(assignment.asset);
    if (!slot) {
      rejected.push(`未知槽位 ${assignment.slot}`);
      continue;
    }
    if (!asset) {
      rejected.push(`未知素材 ${assignment.asset}`);
      continue;
    }
    const fitted = fitAssetToSlot(asset, slot.duration);
    const index = next.findIndex((item) => item.id === slot.id);
    next[index] = {
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
    if (assignment.reason) reasons[slot.id] = assignment.reason;
    applied += 1;
  }

  for (const patch of proposal.effects ?? []) {
    const slot = resolveSlot(next, patch.slot);
    if (!slot) {
      rejected.push(`未知槽位 ${patch.slot}`);
      continue;
    }
    const index = next.findIndex((item) => item.id === slot.id);
    const effects: SlotEffects = { ...slot.effects };
    let touched = false;
    for (const key of EFFECT_KEYS) {
      const value = patch[key];
      if (value == null) continue;
      touched = true;
      const amount = clamp(value, key === "zoom" ? -1 : 0, 1);
      if (Math.abs(amount) < 0.01) delete effects[key];
      else effects[key] = amount;
    }
    if (touched) {
      next[index] = {
        ...slot,
        effects: Object.keys(effects).length ? effects : undefined,
      };
      applied += 1;
    }
  }

  for (const patch of proposal.speeds ?? []) {
    const slot = resolveSlot(next, patch.slot);
    const asset = slot ? assetById.get(slot.assetId) : undefined;
    if (!slot || !asset || asset.kind !== "video") {
      rejected.push(`无法变速 ${patch.slot}`);
      continue;
    }
    const speed = clamp(patch.speed, 0.25, 3);
    const limit = asset.duration ?? slot.sourceOut;
    const sourceOut = Math.min(limit, slot.sourceIn + slot.duration * speed);
    const index = next.findIndex((item) => item.id === slot.id);
    next[index] = {
      ...slot,
      sourceOut,
      speed: (sourceOut - slot.sourceIn) / slot.duration,
      volume: Math.abs(speed - 1) > 0.12 ? 0 : slot.volume,
    };
    applied += 1;
  }

  return { slots: next, reasons, applied, rejected };
}

export function sanitizeProposal(raw: unknown): EditProposal {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  const proposal: EditProposal = {};
  if (Array.isArray(value.assignments)) {
    proposal.assignments = value.assignments
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        slot: (item.slot as string | number) ?? "",
        asset: String(item.asset ?? ""),
        reason: typeof item.reason === "string" ? item.reason.slice(0, 200) : undefined,
      }))
      .filter((item) => item.asset);
  }
  if (Array.isArray(value.effects)) {
    proposal.effects = value.effects
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => {
        const patch: Record<string, unknown> = { slot: item.slot as string | number };
        for (const key of EFFECT_KEYS) {
          if (typeof item[key] === "number") patch[key] = item[key];
        }
        return patch;
      })
      .filter((patch) => EFFECT_KEYS.some((key) => typeof patch[key] === "number"))
      .map((patch) => patch as unknown as SlotEffectPatch);
  }
  if (Array.isArray(value.speeds)) {
    proposal.speeds = value.speeds
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        slot: (item.slot as string | number) ?? "",
        speed: typeof item.speed === "number" ? item.speed : 1,
      }));
  }
  if (value.audio && typeof value.audio === "object") {
    const audio = value.audio as Record<string, unknown>;
    proposal.audio = {};
    if (typeof audio.bgmVolume === "number") proposal.audio.bgmVolume = clamp(audio.bgmVolume, 0, 1);
    if (typeof audio.originalVolume === "number") {
      proposal.audio.originalVolume = clamp(audio.originalVolume, 0, 1);
    }
  }
  if (typeof value.summary === "string") proposal.summary = value.summary.slice(0, 600);
  return proposal;
}
