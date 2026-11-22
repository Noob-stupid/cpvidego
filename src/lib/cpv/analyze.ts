import { guess } from "web-audio-beat-detector";
import { colorStatsFromImageData } from "./color-match";
import { compositionStatsFromImageData } from "./composition";
import { aggregateMotion, estimateMotion, type FrameMotion } from "./motion";
import type {
  AnalysisEvent,
  AnalysisResult,
  ColorStats,
  CompositionStats,
  Shot,
} from "./types";

interface AnalyzeOptions {
  maxDuration?: number;
  sampleFps?: number;
  skipAudio?: boolean;
}

interface SampledFrame {
  time: number;
  thumbnail: string;
  diff: number;
  colorStats: ColorStats;
  compositionStats: CompositionStats | null;
  motion: FrameMotion;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("无法加载参考视频"));
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

function measureFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  detailed: boolean,
): {
  hist: number[];
  colorStats: ColorStats | null;
  compositionStats: CompositionStats | null;
  gray: Uint8Array | null;
} {
  const data = ctx.getImageData(0, 0, width, height).data;
  const bins = new Float32Array(48);
  const pixels = width * height;
  for (let i = 0; i < data.length; i += 4) {
    bins[Math.min(15, data[i] >> 4)] += 1;
    bins[16 + Math.min(15, data[i + 1] >> 4)] += 1;
    bins[32 + Math.min(15, data[i + 2] >> 4)] += 1;
  }
  for (let i = 0; i < 48; i++) bins[i] /= pixels;

  if (!detailed) {
    return { hist: Array.from(bins), colorStats: null, compositionStats: null, gray: null };
  }

  const gridWidth = 64;
  const gridHeight = 36;
  const gray = new Uint8Array(gridWidth * gridHeight);
  for (let y = 0; y < gridHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(((y + 0.5) / gridHeight) * height));
    for (let x = 0; x < gridWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(((x + 0.5) / gridWidth) * width));
      const index = (sourceY * width + sourceX) * 4;
      gray[y * gridWidth + x] =
        0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    }
  }

  return {
    hist: Array.from(bins),
    colorStats: colorStatsFromImageData(data, width, height),
    compositionStats: compositionStatsFromImageData(data, width, height),
    gray,
  };
}

function histogramDiff(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / 3;
}

async function refineCuts(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cuts: number[],
  onEvent: (event: AnalysisEvent) => void,
  signal: AbortSignal,
) {
  if (cuts.length > 20) return cuts;
  const refined: number[] = [];
  for (let c = 0; c < cuts.length; c++) {
    if (signal.aborted) break;
    const rough = cuts[c];
    let best = rough;
    let bestDiff = -1;
    for (const delta of [-0.16, 0, 0.16]) {
      const t = clamp(rough + delta, 0.02, Math.max(0.03, video.duration - 0.02));
      await seek(video, t);
      ctx.drawImage(video, 0, 0, width, height);
      const after = measureFrame(ctx, width, height, false).hist;
      await seek(video, Math.max(0.01, t - 1 / 30));
      ctx.drawImage(video, 0, 0, width, height);
      const before = measureFrame(ctx, width, height, false).hist;
      const d = histogramDiff(before, after);
      if (d > bestDiff) {
        bestDiff = d;
        best = t;
      }
    }
    refined.push(best);
    onEvent({
      type: "refine",
      timestamp: best,
      progress: 0.72 + ((c + 1) / cuts.length) * 0.14,
    });
  }
  return refined.sort((a, b) => a - b);
}

export async function analyzeReference(
  file: File,
  options: AnalyzeOptions,
  onEvent: (event: AnalysisEvent) => void,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const maxDuration =
    options.maxDuration && options.maxDuration > 0
      ? options.maxDuration
      : Number.POSITIVE_INFINITY;
  const baseFps = options.sampleFps ?? 6;
  const url = URL.createObjectURL(file);
  let audioContext: AudioContext | null = null;

  try {
    const video = await loadVideo(url);
    if (signal.aborted) throw new Error("分析已取消");

    const duration = Math.min(video.duration || 0, maxDuration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("视频时长无效");

    // 长片自动降采样，保证整片分析耗时可控；切点仍会精修。
    const adaptiveFps = duration > 240 ? 2 : duration > 90 ? 3 : baseFps;
    let sampleStep = 1 / Math.min(baseFps, adaptiveFps);
    const maxFrames = 1200;
    if (duration / sampleStep > maxFrames) sampleStep = duration / maxFrames;
    const sampleFps = Math.round((1 / sampleStep) * 10) / 10;

    onEvent({ type: "stage", stage: "sample", label: "解码与抽帧", progress: 0.03 });

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法创建分析画布");

    const step = sampleStep;
    const total = Math.max(1, Math.ceil(duration / step));
    const sampled: SampledFrame[] = [];
    const diffs: number[] = [];
    const cuts: number[] = [];
    let lastCut = -1;
    let previousHistogram: number[] | null = null;
    let previousGray: Uint8Array | null = null;

    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new Error("分析已取消");
      const time = Math.min(duration, i * step + 0.02);
      await seek(video, time);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const measured = measureFrame(ctx, canvas.width, canvas.height, true);
      const diff = previousHistogram ? histogramDiff(previousHistogram, measured.hist) : 0;
      previousHistogram = measured.hist;
      diffs.push(diff);
      const motion =
        previousGray && measured.gray && diff < 0.16
          ? estimateMotion(previousGray, measured.gray)
          : { x: 0, y: 0, magnitude: 0 };
      if (measured.gray) previousGray = measured.gray;

      const thumbnail = canvas.toDataURL("image/jpeg", 0.58);
      sampled.push({
        time,
        thumbnail,
        diff,
        colorStats:
          measured.colorStats ??
          colorStatsFromImageData(
            ctx.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height,
          ),
        compositionStats: measured.compositionStats,
        motion,
      });

      const recent = diffs.slice(-24);
      const mean = recent.reduce((sum, v) => sum + v, 0) / Math.max(1, recent.length);
      const variance =
        recent.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / Math.max(1, recent.length);
      const threshold = clamp(mean + 1.25 * Math.sqrt(variance), 0.14, 0.55);

      if (i > 1 && diff > threshold && time - lastCut > 0.28) {
        lastCut = time;
        cuts.push(time);
        onEvent({ type: "cut", timestamp: time, progress: 0.05 + ((i + 1) / total) * 0.62 });
      }

      onEvent({
        type: "frame",
        timestamp: time,
        thumbnail,
        diff,
        progress: 0.05 + ((i + 1) / total) * 0.62,
      });
    }

    onEvent({ type: "stage", stage: "refine", label: "回看切点附近", progress: 0.7 });
    const refinedCuts = await refineCuts(
      video,
      ctx,
      canvas.width,
      canvas.height,
      cuts,
      onEvent,
      signal,
    );

    onEvent({ type: "stage", stage: "beat", label: "节拍与踩点", progress: 0.87 });
    let bpm: number | undefined;
    let beatAlignment: number | undefined;
    if (!options.skipAudio) {
      try {
        const AudioContextCtor =
          window.AudioContext ??
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioContextCtor) throw new Error("当前浏览器不支持音频分析");
        audioContext = new AudioContextCtor();
        const buffer = await file.arrayBuffer();
        const audio = await audioContext.decodeAudioData(buffer);
        const guessed = await guess(audio, 0, Math.min(duration, 30));
        bpm = Math.round(guessed.bpm);
        if (bpm > 0 && refinedCuts.length > 0) {
          const interval = 60 / bpm;
          const offset = guessed.offset ?? 0;
          let hits = 0;
          for (const cut of refinedCuts) {
            const phase = (((cut - offset) % interval) + interval) % interval;
            const distance = Math.min(phase, interval - phase);
            if (distance <= 0.08) hits += 1;
          }
          beatAlignment = hits / refinedCuts.length;
        }
        onEvent({ type: "bpm", bpm: bpm ?? 0, progress: 0.94 });
      } catch {
        bpm = undefined;
      }
    }

    const boundaries = [0, ...refinedCuts.filter((c) => c > 0.15 && c < duration - 0.15), duration];
    const shots: Shot[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      const shotDuration = end - start;
      if (shotDuration < 0.08) continue;
      const mid = start + shotDuration / 2;
      let closest = sampled[0];
      let closestDistance = Infinity;
      for (const frame of sampled) {
        const distance = Math.abs(frame.time - mid);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = frame;
        }
      }
      const tags: string[] = [];
      if (shotDuration < 0.55) tags.push("快切");
      if (shotDuration < 0.3) tags.push("闪切");
      if (shotDuration > 2.2) tags.push("长镜");
      const shotFrames = sampled.filter((frame) => frame.time >= start && frame.time < end);
      shots.push({
        id: `shot_${i}`,
        index: i,
        start,
        end,
        duration: shotDuration,
        thumbnailUrl: closest?.thumbnail ?? "",
        diff: closest?.diff ?? 0,
        tags,
        colorStats: closest?.colorStats,
        compositionStats: closest?.compositionStats ?? undefined,
        motionStats: aggregateMotion(shotFrames.map((frame) => frame.motion)),
      });
    }

    const averageShot =
      shots.reduce((sum, shot) => sum + shot.duration, 0) / Math.max(1, shots.length);

    const styleTags: string[] = [];
    if (averageShot < 0.8) styleTags.push("高燃快切");
    if (refinedCuts.length >= 20) styleTags.push("密集切点");
    if ((bpm ?? 0) >= 140) styleTags.push("高速节拍");
    if ((beatAlignment ?? 0) >= 0.45) styleTags.push("强踩点");
    if (styleTags.length === 0) styleTags.push("节奏剪辑");

    const result: AnalysisResult = {
      duration: video.duration,
      analyzedDuration: duration,
      width: video.videoWidth,
      height: video.videoHeight,
      sampleFps,
      cuts: refinedCuts,
      shots,
      bpm,
      beatAlignment,
      styleTags,
    };

    onEvent({ type: "done", result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析失败";
    onEvent({ type: "error", message });
    throw error;
  } finally {
    await audioContext?.close().catch(() => undefined);
    URL.revokeObjectURL(url);
  }
}
