import { buildAssetFromFile } from "./asset-build";
import { getVideoMeta } from "./media";
import type { MediaAsset } from "./types";

const DEMO_REFERENCE_PATH = "/demo/ref-beat.mp4";
const DEMO_ASSET_PATHS = [1, 2, 3, 4, 5, 6].map((i) => `/demo/asset-${i}.mp4`);

async function fetchAsFile(path: string): Promise<File> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`示例素材加载失败：${path}（${res.status}）`);
  const blob = await res.blob();
  const name = path.split("/").pop() ?? "demo.mp4";
  return new File([blob], name, { type: blob.type || "video/mp4" });
}

export async function buildDemoPack(): Promise<{ reference: MediaAsset; assets: MediaAsset[] }> {
  const file = await fetchAsFile(DEMO_REFERENCE_PATH);
  const meta = await getVideoMeta(file);
  const reference: MediaAsset = {
    id: "reference",
    kind: "video",
    name: "示例参考片 · 120BPM.mp4",
    url: URL.createObjectURL(file),
    file,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    size: file.size,
    origin: "reference",
  };
  const assets: MediaAsset[] = [];
  for (const path of DEMO_ASSET_PATHS) {
    assets.push(await buildAssetFromFile(await fetchAsFile(path)));
  }
  return { reference, assets };
}
