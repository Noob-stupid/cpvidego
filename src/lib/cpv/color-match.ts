import type { ColorGrade, ColorStats } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const NEUTRAL_COLOR_GRADE: ColorGrade = {
  brightness: 1,
  saturate: 1,
  contrast: 1,
  warmth: 0,
};

export function colorStatsFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ColorStats {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLuma = 0;
  let sumLumaSq = 0;
  let sumSaturation = 0;
  let sumWarmth = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 8) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    sumR += r;
    sumG += g;
    sumB += b;
    sumLuma += luma;
    sumLumaSq += luma * luma;
    sumSaturation += max === 0 ? 0 : (max - min) / max;
    sumWarmth += (r - b) / 255;
    count += 1;
  }

  const n = Math.max(1, count);
  const luma = sumLuma / n;
  const variance = Math.max(0, sumLumaSq / n - luma * luma);
  return {
    r: sumR / n,
    g: sumG / n,
    b: sumB / n,
    luma,
    saturation: sumSaturation / n,
    contrast: Math.sqrt(variance),
    warmth: sumWarmth / n,
  };
}

export async function readColorStats(url: string): Promise<ColorStats | null> {
  if (!url) return null;
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取画面色彩"));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) return null;
    const width = 64;
    const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    return colorStatsFromImageData(ctx.getImageData(0, 0, width, height).data, width, height);
  } catch {
    return null;
  }
}

export function buildColorGrade(source: ColorStats, target: ColorStats): ColorGrade {
  const lumaRatio = target.luma / Math.max(18, source.luma);
  const satRatio = target.saturation / Math.max(0.04, source.saturation);
  const contrastRatio = target.contrast / Math.max(6, source.contrast);
  return {
    brightness: clamp(1 + (lumaRatio - 1) * 0.55, 0.8, 1.26),
    saturate: clamp(1 + (satRatio - 1) * 0.5, 0.66, 1.45),
    contrast: clamp(1 + (contrastRatio - 1) * 0.4, 0.84, 1.2),
    warmth: clamp((target.warmth - source.warmth) * 0.55, -0.24, 0.24),
  };
}

export function scaleColorGrade(grade: ColorGrade, strength: number): ColorGrade {
  const amount = clamp(strength, 0, 1);
  return {
    brightness: 1 + (grade.brightness - 1) * amount,
    saturate: 1 + (grade.saturate - 1) * amount,
    contrast: 1 + (grade.contrast - 1) * amount,
    warmth: grade.warmth * amount,
  };
}

export function colorFilter(grade: ColorGrade): string {
  return `brightness(${grade.brightness.toFixed(3)}) saturate(${grade.saturate.toFixed(
    3,
  )}) contrast(${grade.contrast.toFixed(3)})`;
}

export function warmthTint(grade: ColorGrade): { color: string; opacity: number } | null {
  if (Math.abs(grade.warmth) < 0.012) return null;
  return {
    color: grade.warmth > 0 ? "rgb(255, 168, 88)" : "rgb(92, 148, 255)",
    opacity: Math.min(0.2, Math.abs(grade.warmth) * 0.55),
  };
}

export function hasColorGrade(grade?: ColorGrade): grade is ColorGrade {
  return Boolean(grade);
}