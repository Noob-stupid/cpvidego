import type { LibraryItem } from "./types";

export type GenerationKind = "api" | "local-bridge";

export interface GenerationRequest {
  prompt: string;
  durationSeconds?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  referenceImageUrl?: string;
  seed?: number;
}

export interface GeneratedClip {
  name: string;
  blob?: Blob;
  fileUrl?: string;
  duration?: number;
}

/**
 * 视频生成源接口（预留）。与素材库适配器同构：产出 LibraryItem 进入同一索引，
 * 之后由 AI 导演挑选、由确定性引擎剪辑，形成"AI 生 + AI 剪"全流程。
 * 两类实现方向：
 *  - api：云端视频生成模型（可灵 / Runway / Pika / Sora 等 OpenAI 式或自有协议）。
 *  - local-bridge：本机生成软件（ComfyUI / Stable Diffusion / Muse 等）经 localhost HTTP/WS 桥接，无需云端 API。
 */
export interface GenerationProvider {
  id: string;
  label: string;
  kind: GenerationKind;
  available(): Promise<boolean>;
  generate(request: GenerationRequest): Promise<GeneratedClip>;
}

export interface BridgeConfig {
  baseUrl: string;
  workflow?: string;
}

/** 本机桥接客户端骨架：约定 POST {baseUrl}/generate 返回 {video_url|blob}。未配置时明确不可用。 */
export function createLocalBridgeProvider(config: BridgeConfig): GenerationProvider {
  return {
    id: "local-bridge",
    label: "本机生成桥（ComfyUI/SD/Muse）",
    kind: "local-bridge",
    available: async () => {
      if (!config.baseUrl) return false;
      try {
        const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/health`);
        return response.ok;
      } catch {
        return false;
      }
    },
    generate: async (request) => {
      if (!config.baseUrl) throw new Error("未配置本机生成桥地址");
      const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, workflow: config.workflow }),
      });
      if (!response.ok) throw new Error(`生成桥返回 ${response.status}`);
      const data = (await response.json()) as { video_url?: string; name?: string };
      if (!data.video_url) throw new Error("生成桥未返回 video_url");
      return { name: data.name ?? "generated.mp4", fileUrl: data.video_url };
    },
  };
}

export function clipToLibraryItem(clip: GeneratedClip, id: string): LibraryItem {
  return {
    id,
    name: clip.name,
    kind: "video",
    duration: clip.duration,
    tags: ["ai-generated"],
    source: "local",
    fileUrl: clip.fileUrl,
  };
}

/** 预留清单：仅描述方向，不代表已实现。 */
export const RESERVED_GENERATION_DIRECTIONS = [
  { id: "api-video-gen", label: "云端视频生成 API", kind: "api" as const },
  { id: "comfyui", label: "ComfyUI 本机桥", kind: "local-bridge" as const },
  { id: "sd-muse", label: "Stable Diffusion / Muse 本机桥", kind: "local-bridge" as const },
];
