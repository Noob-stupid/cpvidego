import { readImageMatchStats } from "./image-stats";
import { getVideoMeta, isImageFile, isVideoFile, makeVideoThumbnail } from "./media";
import type { MediaAsset } from "./types";
import { generateUUID } from "@/utils/id";

export async function buildAssetFromFile(file: File): Promise<MediaAsset> {
  const id = generateUUID();
  const url = URL.createObjectURL(file);
  if (isVideoFile(file)) {
    const meta = await getVideoMeta(file).catch(() => null);
    const thumbnailUrl = await makeVideoThumbnail(url, Math.min(1, (meta?.duration ?? 2) * 0.2));
    const stats = await readImageMatchStats(thumbnailUrl);
    return {
      id,
      kind: "video",
      name: file.name,
      url,
      file,
      duration: meta?.duration,
      width: meta?.width,
      height: meta?.height,
      size: file.size,
      origin: "user",
      groupName: file.name.replace(/\.[^.]+$/, ""),
      thumbnailUrl,
      colorStats: stats?.color,
      compositionStats: stats?.composition,
    };
  }
  if (isImageFile(file)) {
    const stats = await readImageMatchStats(url);
    return {
      id,
      kind: "image",
      name: file.name,
      url,
      file,
      size: file.size,
      origin: "user",
      groupName: "图片",
      thumbnailUrl: url,
      colorStats: stats?.color,
      compositionStats: stats?.composition,
    };
  }
  return {
    id,
    kind: "audio",
    name: file.name,
    url,
    file,
    size: file.size,
    origin: "user",
    groupName: "音乐",
  };
}
