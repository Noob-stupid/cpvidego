import type { MediaAsset, ShotTags } from "../types";
import type { AIProvider, ChatMessage, VisionPart } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const TAG_SYSTEM = `你是镜头语义标注器。只依据给定采样帧输出一个 JSON 对象，字段：
kind: "anime"|"live"|"3d"|"other"（画面风格）
letterbox: 布尔（是否有烘录在画面里的黑边/侧边）
shotSize: "close"|"medium"|"wide"（景别）
subject: 简短中文主体描述
energy: 0-1（动作/冲突强度）
quality: 0-1（清晰度/构图质量）
不要输出 JSON 以外的任何文字。`;

export function buildTagMessages(assetName: string, frames: string[]): ChatMessage[] {
  const parts: VisionPart[] = [
    { type: "text", text: `素材：${assetName}。以下为采样帧，请按要求标注。` },
  ];
  for (const url of frames) parts.push({ type: "image_url", image_url: { url } });
  return [
    { role: "system", content: TAG_SYSTEM },
    { role: "user", content: parts },
  ];
}

const KINDS = ["anime", "live", "3d", "other"] as const;
const SIZES = ["close", "medium", "wide"] as const;

/** 容忍地解析模型返回的标签 JSON，非法字段丢弃。 */
export function parseTagResponse(text: string): ShotTags {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
  const tags: ShotTags = {};
  if (typeof raw.kind === "string" && (KINDS as readonly string[]).includes(raw.kind)) {
    tags.kind = raw.kind as ShotTags["kind"];
  }
  if (typeof raw.letterbox === "boolean") tags.letterbox = raw.letterbox;
  if (typeof raw.shotSize === "string" && (SIZES as readonly string[]).includes(raw.shotSize)) {
    tags.shotSize = raw.shotSize as ShotTags["shotSize"];
  }
  if (typeof raw.subject === "string") tags.subject = raw.subject.slice(0, 40);
  if (typeof raw.energy === "number") tags.energy = clamp(raw.energy, 0, 1);
  if (typeof raw.quality === "number") tags.quality = clamp(raw.quality, 0, 1);
  return tags;
}

export interface Compatibility {
  score: number;
  hardReject: boolean;
  reason?: string;
}

/** 风格硬过滤 + 兼容评分：黑边/异风格直接拒，景别与质量加分。 */
export function tagCompatibility(
  asset: ShotTags | undefined,
  target: ShotTags | undefined,
): Compatibility {
  if (!asset || !target) return { score: 0.5, hardReject: false };
  if (asset.letterbox) return { score: 0, hardReject: true, reason: "烘录黑边" };
  if (target.kind && asset.kind && asset.kind !== target.kind) {
    return { score: 0, hardReject: true, reason: `风格不符(${asset.kind}≠${target.kind})` };
  }
  let score = 0.6;
  if (target.shotSize && asset.shotSize === target.shotSize) score += 0.2;
  score += (asset.quality ?? 0.5) * 0.2;
  return { score: clamp(score, 0, 1), hardReject: false };
}

export async function tagAsset(
  provider: AIProvider,
  asset: MediaAsset,
  frames: string[],
): Promise<ShotTags> {
  const { message } = await provider.chat({
    messages: buildTagMessages(asset.name, frames),
    temperature: 0,
  });
  const text = typeof message.content === "string" ? message.content : "";
  return parseTagResponse(text);
}
