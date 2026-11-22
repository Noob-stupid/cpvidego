import type { MediaAsset } from "../types";
import type { LibraryItem } from "./types";

export interface MaterialLibraryProvider {
  id: string;
  label: string;
  list(query?: string, limit?: number): Promise<LibraryItem[]>;
}

const round = (value: number | undefined, digits = 2) =>
  value == null ? undefined : Math.round(value * 10 ** digits) / 10 ** digits;

export function localLibrary(assets: MediaAsset[]): MaterialLibraryProvider {
  return {
    id: "local",
    label: "本地素材库",
    list: async (query, limit = 60) => {
      const pool = assets.filter((asset) => asset.origin === "user");
      const filtered = query
        ? pool.filter((asset) =>
            `${asset.name} ${asset.groupName ?? ""}`.toLowerCase().includes(query.toLowerCase()),
          )
        : pool;
      return filtered.slice(0, limit).map((asset) => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind === "image" ? "image" : "video",
        duration: round(asset.duration),
        width: asset.width,
        height: asset.height,
        color: asset.colorStats,
        motion: asset.motionStats,
        composition: asset.compositionStats,
        tags: asset.groupName ? [asset.groupName] : [],
        source: "local" as const,
        previewUrl: asset.thumbnailUrl,
      }));
    },
  };
}

interface PexelsVideoFile {
  link: string;
  quality: string;
  width: number;
  height: number;
}

interface PexelsVideo {
  id: number;
  duration: number;
  width: number;
  height: number;
  image: string;
  video_files: PexelsVideoFile[];
  user?: { name?: string };
}

export function pexelsLibrary(): MaterialLibraryProvider {
  return {
    id: "pexels",
    label: "Pexels 在线素材库",
    list: async (query, limit = 12) => {
      const params = new URLSearchParams({ type: "video", per_page: String(limit) });
      if (query) params.set("query", query);
      const response = await fetch(`/api/pexels?${params.toString()}`);
      if (!response.ok) throw new Error("Pexels 素材库不可用（未配置 Key 或网络失败）");
      const data = (await response.json()) as { videos?: PexelsVideo[] };
      return (data.videos ?? []).map((video) => {
        const file =
          [...(video.video_files ?? [])].sort((a, b) => a.width - b.width)[0] ?? null;
        return {
          id: `pexels:${video.id}`,
          name: `Pexels ${video.id} · ${video.user?.name ?? "stock"}`,
          kind: "video" as const,
          duration: video.duration,
          width: video.width,
          height: video.height,
          tags: query ? [query] : ["stock"],
          source: "pexels" as const,
          previewUrl: video.image,
          fileUrl: file?.link,
        };
      });
    },
  };
}

/** 给模型看的紧凑索引：只保留决策需要的统计量，避免塞满上下文。 */
export function buildLibraryIndex(items: LibraryItem[]): string {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      dur: item.duration,
      luma: item.color ? Math.round(item.color.luma) : undefined,
      sat: item.color ? round(item.color.saturation) : undefined,
      contrast: item.color ? Math.round(item.color.contrast) : undefined,
      panX: item.motion ? round(item.motion.x, 3) : undefined,
      cx: item.composition ? round(item.composition.cx) : undefined,
      cy: item.composition ? round(item.composition.cy) : undefined,
      tags: item.tags,
      src: item.source,
    })),
  );
}

export function buildTimelineIndex(slots: {
  id: string;
  index: number;
  duration: number;
  targetColor?: { luma: number; saturation: number };
  assetId: string;
}[]): string {
  return JSON.stringify(
    slots.map((slot) => ({
      id: slot.id,
      i: slot.index,
      dur: round(slot.duration),
      wantLuma: slot.targetColor ? Math.round(slot.targetColor.luma) : undefined,
      wantSat: slot.targetColor ? round(slot.targetColor.saturation) : undefined,
      now: slot.assetId,
    })),
  );
}
