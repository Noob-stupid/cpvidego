import type {
  ColorStats,
  CompositionStats,
  MediaAsset,
  MotionStats,
  Shot,
  Slot,
} from "../src/lib/cpv/types";

export function colorStats(patch: Partial<ColorStats> = {}): ColorStats {
  return {
    r: 120,
    g: 110,
    b: 100,
    luma: 112,
    saturation: 0.3,
    contrast: 42,
    warmth: 0.05,
    ...patch,
  };
}

export function motionStats(patch: Partial<MotionStats> = {}): MotionStats {
  return { x: 0, y: 0, magnitude: 0, coherence: 0, shake: 0, ...patch };
}

export function compositionStats(patch: Partial<CompositionStats> = {}): CompositionStats {
  return { cx: 0.5, cy: 0.5, spread: 0.4, ...patch };
}

export function asset(id: string, patch: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    kind: "video",
    name: `${id}.mp4`,
    url: `blob:${id}`,
    origin: "user",
    duration: 20,
    width: 1920,
    height: 1080,
    ...patch,
  };
}

export function shot(index: number, start: number, duration: number, patch: Partial<Shot> = {}): Shot {
  return {
    id: `shot_${index}`,
    index,
    start,
    end: start + duration,
    duration,
    thumbnailUrl: "",
    diff: 0.2,
    tags: [],
    ...patch,
  };
}

export function slot(index: number, start: number, duration: number, patch: Partial<Slot> = {}): Slot {
  return {
    id: `slot_${index}`,
    index,
    shotId: `shot_${index}`,
    label: `镜头 ${index + 1}`,
    start,
    end: start + duration,
    duration,
    thumbnailUrl: "",
    assetId: "reference",
    sourceIn: start,
    sourceOut: start + duration,
    speed: 1,
    volume: 1,
    effectTags: [],
    ...patch,
  };
}

export function timeline(count: number, duration = 0.5): Slot[] {
  return Array.from({ length: count }, (_, index) => slot(index, index * duration, duration));
}
