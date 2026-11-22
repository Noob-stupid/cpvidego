import { BrowserMetadataProvider, Core, CoreConfig } from "@openvideo/core";
import { Compositor, Studio } from "@openvideo/engine-pixi";
import type { MediaAsset, Slot } from "./types";

interface RenderOptions {
  slots: Slot[];
  assets: MediaAsset[];
  reference: MediaAsset;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (progress: number) => void;
}

CoreConfig.setMetadataProvider(new BrowserMetadataProvider());

export async function renderTimelineToMp4({
  slots,
  assets,
  reference,
  duration,
  width = 1920,
  height = 1080,
  fps = 30,
  onProgress,
}: RenderOptions): Promise<Blob> {
  if (!slots.length) throw new Error("时间线没有可导出的镜头");

  const clipsPlan = slots
    .map((slot) => {
      const asset = assets.find((item) => item.id === slot.assetId);
      if (!asset) return null;
      const sourceIn = Math.max(0, slot.sourceIn);
      const sourceOut = Math.max(sourceIn + 0.05, slot.sourceOut);
      const speed = Math.min(8, Math.max(0.1, slot.speed || 1));
      const displaySeconds = (sourceOut - sourceIn) / speed;
      return { slot, asset, sourceIn, sourceOut, speed, displaySeconds };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!clipsPlan.length) throw new Error("没有可用的替换素材");

  const visualDuration = clipsPlan.reduce((sum, item) => sum + item.displaySeconds, 0);
  const timelineDuration = Math.max(duration, visualDuration) + 0.25;
  const totalUs = Math.round(timelineDuration * 1e6);

  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:-10000px;top:0;width:2px;height:2px;overflow:hidden;pointer-events:none;";
  document.body.appendChild(container);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  container.appendChild(canvas);

  const core = new Core({
    settings: {
      width,
      height,
      fps,
      duration: totalUs,
    },
  } as any);

  let studio: Studio | null = null;
  let compositor: Compositor | null = null;

  try {
    studio = new Studio({
      width,
      height,
      fps,
      interactivity: false,
      spacing: 20,
      backgroundColor: "#000000",
      artboardColor: "#000000",
      canvas,
      core,
      previewScale: 0.5,
    } as any);
    await studio.ready;

    let cursorUs = 0;
    for (const item of clipsPlan) {
      const displayUs = Math.max(1, Math.round(item.displaySeconds * 1e6));
      const display = { from: cursorUs, to: cursorUs + displayUs };
      const trim = {
        from: Math.round(item.sourceIn * 1e6),
        to: Math.round(item.sourceOut * 1e6),
      };
      await core.clip.add(
        {
          type: item.asset.kind === "image" ? "Image" : "Video",
          src: item.asset.url,
          name: item.asset.name,
          timing: {
            display,
            trim,
            duration: displayUs,
            playbackRate: item.speed,
          },
          playbackRate: item.speed,
          duration: displayUs,
          volume: 0,
          muted: true,
          metadata: item.asset.thumbnailUrl ? { previewUrl: item.asset.thumbnailUrl } : undefined,
        } as any,
        { objectFit: "contain" },
      );
      cursorUs += displayUs;
    }

    const audioDuration = Math.min(duration, timelineDuration);
    if (reference.url && audioDuration > 0.2) {
      await core.clip.add(
        {
          type: "Audio",
          src: reference.url,
          name: `${reference.name} · 原声`,
          timing: {
            display: { from: 0, to: Math.round(audioDuration * 1e6) },
            trim: { from: 0, to: Math.round(audioDuration * 1e6) },
            duration: Math.round(audioDuration * 1e6),
            playbackRate: 1,
          },
          playbackRate: 1,
          volume: 0.9,
        } as any,
        { objectFit: "contain" },
      );
    }

    studio.suspendRendering();
    const json = studio.exportToJSON();
    compositor = new Compositor({
      width,
      height,
      fps,
      backgroundColor: "#000000",
      format: "mp4",
      videoCodec: "avc1.640033",
      bitrate: 14_000_000,
      audio: true,
      audioCodec: "aac",
      audioSampleRate: 48_000,
      prioritizeSpeed: true,
    } as any);
    await compositor.initPixiApp();
    compositor.on("export:progress", (value: number) => onProgress?.(value));
    await compositor.loadFromJSON(json);
    const stream = compositor.output();
    const blob = await new Response(stream).blob();
    onProgress?.(1);
    return blob;
  } finally {
    try {
      compositor?.destroy();
    } catch {
      // ignore cleanup errors
    }
    try {
      studio?.destroy();
    } catch {
      // ignore cleanup errors
    }
    container.remove();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 500);
}