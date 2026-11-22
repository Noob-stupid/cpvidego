import { estimateMotion } from "./motion";

export interface SourceWindow {
  start: number;
  end: number;
  score: number;
  activity: number;
  motion: number;
  cuts: number;
  luma: number;
  saturation: number;
}

interface ScanOptions {
  duration: number;
  sampleFps?: number;
  window?: number;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("无法加载素材"));
  });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.002) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.onseeked = null;
      resolve();
    };
    video.onseeked = done;
    setTimeout(done, 900);
    video.currentTime = time;
  });
}

function gridOf(data: Uint8ClampedArray, width: number, height: number) {
  const gridWidth = 64;
  const gridHeight = 36;
  const gray = new Uint8Array(gridWidth * gridHeight);
  let sumLuma = 0;
  let sumSat = 0;
  let count = 0;
  for (let y = 0; y < gridHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(((y + 0.5) / gridHeight) * height));
    for (let x = 0; x < gridWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(((x + 0.5) / gridWidth) * width));
      const index = (sourceY * width + sourceX) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      gray[y * gridWidth + x] = luma;
      sumLuma += luma;
      sumSat += max === 0 ? 0 : (max - min) / max;
      count += 1;
    }
  }
  return {
    gray,
    gridWidth,
    gridHeight,
    luma: sumLuma / Math.max(1, count),
    saturation: sumSat / Math.max(1, count),
  };
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
  return sum / Math.max(1, Math.floor(a.length / 4));
}

export async function scanSourceWindows(
  url: string,
  options: ScanOptions,
): Promise<SourceWindow[]> {
  if (typeof document === "undefined") return [];
  const sampleFps = options.sampleFps ?? 2;
  const windowSize = options.window ?? 1.2;
  const duration = Math.max(0.5, options.duration);
  const video = await loadVideo(url);
  try {
    const width = 320;
    const height = Math.max(1, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];

    const step = 1 / sampleFps;
    const frames = Math.max(2, Math.floor(duration * sampleFps));
    const buckets = Math.max(1, Math.floor(duration / windowSize));
    const perBucket = Math.max(1, Math.floor(frames / buckets));

    const stats = Array.from({ length: buckets }, () => ({
      activity: 0,
      motion: 0,
      cuts: 0,
      luma: 0,
      saturation: 0,
      count: 0,
    }));

    let previous: Uint8Array | null = null;
    for (let i = 0; i < frames; i += 1) {
      if (options.signal?.aborted) break;
      const time = Math.min(duration - 0.05, i * step);
      await seek(video, time);
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const current = gridOf(image.data, width, height);
      const bucket = Math.min(buckets - 1, Math.floor(i / perBucket));
      const target = stats[bucket];
      target.luma += current.luma;
      target.saturation += current.saturation;
      target.count += 1;
      if (previous) {
        const diff = meanAbsDiff(previous, current.gray);
        const motion = estimateMotion(previous, current.gray, current.gridWidth, current.gridHeight);
        target.activity += diff;
        target.motion += motion.magnitude;
        if (diff > 26) target.cuts += 1;
      }
      previous = current.gray;
      options.onProgress?.((i + 1) / frames);
    }

    return stats
      .map((bucket, index) => {
        const divisor = Math.max(1, bucket.count);
        const activity = clamp(bucket.activity / divisor / 45, 0, 1);
        const motion = clamp(bucket.motion / divisor / 0.02, 0, 1);
        const cuts = bucket.cuts / Math.max(1, bucket.count - 1);
        const luma = bucket.luma / divisor;
        const saturation = bucket.saturation / divisor;
        const blankPenalty =
          luma < 16 ? 0.55 : luma > 238 && saturation < 0.06 ? 0.35 : 0;
        const start = index * windowSize;
        return {
          start,
          end: Math.min(duration, start + windowSize),
          activity,
          motion,
          cuts: clamp(cuts * 2.2, 0, 1),
          luma,
          saturation,
          score: clamp(
            activity * 0.4 + motion * 0.22 + clamp(cuts * 2.2, 0, 1) * 0.24 +
              saturation * 0.14 +
              (luma > 30 && luma < 230 ? 0.08 : 0) -
              blankPenalty,
            0,
            1,
          ),
        };
      })
      .filter((window) => window.end - window.start > 0.3);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/** 亮度合格的窗口：近黑与死白都不该被剪进成片。 */
export function usableWindows(windows: SourceWindow[]): SourceWindow[] {
  return windows.filter(
    (window) => window.luma >= 16 && !(window.luma > 238 && window.saturation < 0.06),
  );
}

/** 取分数最高且互不重叠的窗口；近黑/死白窗口直接排除，避免切到黑场。 */
export function pickHighlightWindows(
  windows: SourceWindow[],
  count: number,
  minGap = 0.4,
): SourceWindow[] {
  const usable = usableWindows(windows);
  const pool = usable.length >= Math.min(count, 4) ? usable : windows;
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const picked: SourceWindow[] = [];
  for (const window of sorted) {
    if (picked.length >= count) break;
    const overlaps = picked.some(
      (item) =>
        window.start < item.end + minGap && item.start < window.end + minGap,
    );
    if (overlaps) continue;
    picked.push(window);
  }
  return picked.sort((a, b) => a.start - b.start);
}
