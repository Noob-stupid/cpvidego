import { makeVideoThumbnails } from "./media";
import type { MediaAsset, Slot } from "./types";

const BLACK = 16;
const WHITE = 244;

async function thumbLuma(dataUrl: string): Promise<number> {
  if (!dataUrl) return 128;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 18;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(128);
        return;
      }
      ctx.drawImage(image, 0, 0, 32, 18);
      const data = ctx.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        count += 1;
      }
      resolve(count ? sum / count : 128);
    };
    image.onerror = () => resolve(128);
    image.src = dataUrl;
  });
}

export interface BlackCheck {
  blackSlotIds: Set<string>;
  blackAssetIds: Set<string>;
}

/**
 * 选材后逐段抽帧校验：单帧统计代表不了整个镜头，含黑场的区间要被抓出来。
 * 每个素材只加载一次，按槽位数量分摊 seek。
 */
export async function detectBlackSlots(
  slots: Slot[],
  assets: MediaAsset[],
  onProgress?: (done: number, total: number) => void,
): Promise<BlackCheck> {
  const byAsset = new Map<string, { slot: Slot; times: number[] }[]>();
  for (const slot of slots) {
    const asset = assets.find((item) => item.id === slot.assetId);
    if (!asset || asset.kind !== "video") continue;
    const span = slot.sourceOut - slot.sourceIn;
    const times = [0.25, 0.5, 0.75].map((ratio) => slot.sourceIn + span * ratio);
    const list = byAsset.get(asset.id) ?? [];
    list.push({ slot, times });
    byAsset.set(asset.id, list);
  }
  const blackSlotIds = new Set<string>();
  const blackAssetIds = new Set<string>();
  const total = slots.length;
  let done = 0;
  for (const [assetId, items] of byAsset) {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) continue;
    const thumbs = await makeVideoThumbnails(
      asset.url,
      items.flatMap((item) => item.times),
    );
    for (let i = 0; i < items.length; i += 1) {
      const samples = thumbs.slice(i * 3, i * 3 + 3);
      const lumas = await Promise.all(samples.map((sample) => thumbLuma(sample ?? "")));
      if (lumas.some((luma) => luma < BLACK || luma > WHITE)) {
        blackSlotIds.add(items[i].slot.id);
        blackAssetIds.add(assetId);
      }
      done += 1;
      onProgress?.(done, total);
    }
  }
  return { blackSlotIds, blackAssetIds };
}