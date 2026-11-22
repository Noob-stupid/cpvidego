import { buildAssetFromFile } from "../asset-build";
import type { MediaAsset } from "../types";
import type { SourceProvider } from "./sources";

export interface ImportOptions {
  limit?: number;
  maxBytes?: number;
  existingNames?: Set<string>;
  onProgress?: (done: number, total: number, name: string) => void;
}

export interface ImportResult {
  assets: MediaAsset[];
  skipped: string[];
}

const DEFAULT_MAX_BYTES = 60 * 1024 * 1024;

/** 把某个素材源的视频下载进本地库：去重、限体积、逐条进度，失败不中断整批。 */
export async function importFromSource(
  provider: SourceProvider,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const items = await provider.list(undefined, options.limit ?? 20);
  const seen = new Set<string>();
  const picked = [];
  for (const item of items) {
    if (item.kind !== "video") continue;
    if (/\.(mp3|wav|ogg|m4a)$/i.test(item.name)) continue;
    const stem = item.name.replace(/\.[^.]+$/, "");
    if (seen.has(stem)) continue;
    seen.add(stem);
    if (options.existingNames?.has(stem)) continue;
    if (item.size && item.size > maxBytes) continue;
    picked.push(item);
  }

  const assets: MediaAsset[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < picked.length; i += 1) {
    const item = picked[i];
    options.onProgress?.(i, picked.length, item.name);
    const blob = provider.resolve
      ? await provider.resolve(item)
      : item.fileUrl
        ? await fetch(item.fileUrl).then((response) => response.blob()).catch(() => null)
        : null;
    if (!blob) {
      skipped.push(`${item.name}：下载失败`);
      continue;
    }
    if (blob.size > maxBytes) {
      skipped.push(`${item.name}：超过体积上限`);
      continue;
    }
    const file = new File([blob], item.name.split("/").pop() ?? "clip.mp4", {
      type: blob.type || "video/mp4",
    });
    assets.push({ ...(await buildAssetFromFile(file)), sourceTag: provider.id });
  }
  options.onProgress?.(picked.length, picked.length, "完成");
  return { assets, skipped };
}
