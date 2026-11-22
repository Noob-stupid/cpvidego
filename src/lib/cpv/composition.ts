import type { CompositionAdjust, CompositionStats } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function compositionStatsFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): CompositionStats {
  const columns = 16;
  const rows = 9;
  const samples: { x: number; y: number; luma: number; saturation: number }[] = [];
  let totalLuma = 0;
  let totalWeight = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = Math.floor((column / columns) * width);
      const right = Math.max(left + 1, Math.floor(((column + 1) / columns) * width));
      const top = Math.floor((row / rows) * height);
      const bottom = Math.max(top + 1, Math.floor(((row + 1) / rows) * height));
      let sumLuma = 0;
      let sumSaturation = 0;
      let count = 0;
      for (let y = top; y < bottom; y += Math.max(1, Math.floor((bottom - top) / 3))) {
        for (let x = left; x < right; x += Math.max(1, Math.floor((right - left) / 3))) {
          const index = (y * width + x) * 4;
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          sumLuma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sumSaturation += max === 0 ? 0 : (max - min) / max;
          count += 1;
        }
      }
      if (!count) continue;
      const luma = sumLuma / count;
      const saturation = sumSaturation / count;
      samples.push({ x: (column + 0.5) / columns, y: (row + 0.5) / rows, luma, saturation });
      totalLuma += luma;
      totalWeight += 1;
    }
  }

  if (!samples.length) return { cx: 0.5, cy: 0.5, spread: 0.4 };
  const frameLuma = totalLuma / Math.max(1, totalWeight);
  let weightSum = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (const sample of samples) {
    const contrast = Math.abs(sample.luma - frameLuma) / 80;
    const brightness = 0.25 + (sample.luma / 255) * 0.75;
    const weight = (sample.saturation * 0.65 + clamp(contrast, 0, 1) * 0.35) * brightness;
    weightSum += weight;
    weightedX += sample.x * weight;
    weightedY += sample.y * weight;
  }
  if (weightSum < 0.0001) return { cx: 0.5, cy: 0.5, spread: 0.4 };
  const cx = weightedX / weightSum;
  const cy = weightedY / weightSum;
  let variance = 0;
  for (const sample of samples) {
    const contrast = Math.abs(sample.luma - frameLuma) / 80;
    const brightness = 0.25 + (sample.luma / 255) * 0.75;
    const weight = (sample.saturation * 0.65 + clamp(contrast, 0, 1) * 0.35) * brightness;
    variance += ((sample.x - cx) ** 2 + (sample.y - cy) ** 2) * weight;
  }
  const spread = clamp(Math.sqrt(variance / weightSum) * 2, 0, 1);
  return { cx: clamp(cx, 0, 1), cy: clamp(cy, 0, 1), spread };
}

export function buildCompositionAdjust(
  source?: CompositionStats,
  target?: CompositionStats,
): CompositionAdjust | undefined {
  if (!source || !target) return undefined;
  const shiftX = clamp((target.cx - source.cx) * 0.45, -0.045, 0.045);
  const shiftY = clamp((target.cy - source.cy) * 0.45, -0.04, 0.04);
  const spreadRatio = target.spread / Math.max(0.12, source.spread);
  const targetScale = clamp(1 + Math.max(0, spreadRatio - 1) * 0.16, 1, 1.09);
  const coverScale = 1 + 2 * Math.max(Math.abs(shiftX), Math.abs(shiftY)) + 0.004;
  const scale = clamp(Math.max(targetScale, coverScale), 1, 1.12);
  if (Math.abs(shiftX) < 0.002 && Math.abs(shiftY) < 0.002 && scale - 1 < 0.008) {
    return undefined;
  }
  return { scale, shiftX, shiftY };
}

export function scaleCompositionAdjust(
  adjust: CompositionAdjust,
  strength: number,
): CompositionAdjust {
  const amount = clamp(strength, 0, 1);
  const shiftX = adjust.shiftX * amount;
  const shiftY = adjust.shiftY * amount;
  const coverScale = 1 + 2 * Math.max(Math.abs(shiftX), Math.abs(shiftY)) + 0.004;
  const scale = clamp(
    Math.max(coverScale, 1 + (adjust.scale - 1) * amount),
    1,
    1.12,
  );
  return { scale, shiftX, shiftY };
}

export function composeTransform(
  mirrorX: boolean,
  composition?: CompositionAdjust,
): string | undefined {
  const parts: string[] = [];
  if (composition) {
    parts.push(
      `translate(${(composition.shiftX * 100).toFixed(2)}%, ${(
        composition.shiftY * 100
      ).toFixed(2)}%)`,
      `scale(${composition.scale.toFixed(3)})`,
    );
  }
  if (mirrorX) parts.push("scaleX(-1)");
  return parts.length ? parts.join(" ") : undefined;
}