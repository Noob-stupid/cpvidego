import { colorStatsFromImageData } from "./color-match";
import { compositionStatsFromImageData } from "./composition";
import type { ColorStats, CompositionStats } from "./types";

export interface ImageMatchStats {
  color: ColorStats;
  composition: CompositionStats;
}

export async function readImageMatchStats(url: string): Promise<ImageMatchStats | null> {
  if (!url) return null;
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取画面信息"));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) return null;
    const width = 96;
    const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    return {
      color: colorStatsFromImageData(data, width, height),
      composition: compositionStatsFromImageData(data, width, height),
    };
  } catch {
    return null;
  }
}