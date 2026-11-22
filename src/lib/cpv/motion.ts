import type { MotionStats } from "./types";

export interface FrameMotion {
  x: number;
  y: number;
  magnitude: number;
}

const ZERO_MOTION: FrameMotion = { x: 0, y: 0, magnitude: 0 };

export function estimateMotion(
  previous: Uint8Array,
  current: Uint8Array,
  width = 64,
  height = 36,
): FrameMotion {
  const searchX = 3;
  const searchY = 2;
  let bestSad = Number.POSITIVE_INFINITY;
  let bestDx = 0;
  let bestDy = 0;
  let zeroSad = Number.POSITIVE_INFINITY;

  for (let dy = -searchY; dy <= searchY; dy += 1) {
    const startY = Math.max(0, -dy);
    const endY = Math.min(height, height - dy);
    for (let dx = -searchX; dx <= searchX; dx += 1) {
      const startX = Math.max(0, -dx);
      const endX = Math.min(width, width - dx);
      let sum = 0;
      let count = 0;
      for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
          sum += Math.abs(current[(y + dy) * width + x + dx] - previous[y * width + x]);
          count += 1;
        }
      }
      if (!count) continue;
      const sad = sum / count;
      if (dx === 0 && dy === 0) zeroSad = sad;
      if (sad < bestSad) {
        bestSad = sad;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  if (!Number.isFinite(bestSad) || zeroSad - bestSad < 0.9) return ZERO_MOTION;
  const x = bestDx / width;
  const y = bestDy / height;
  return { x, y, magnitude: Math.hypot(x, y) };
}

export function aggregateMotion(frames: FrameMotion[]): MotionStats {
  if (!frames.length) {
    return { x: 0, y: 0, magnitude: 0, coherence: 0, shake: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  let sumMagnitude = 0;
  let positive = 0;
  let negative = 0;
  let flips = 0;
  let previousSign = 0;

  for (const frame of frames) {
    sumX += frame.x;
    sumY += frame.y;
    sumMagnitude += frame.magnitude;
    if (frame.magnitude < 0.0012) continue;
    const sign = Math.sign(frame.x || frame.y);
    if (!sign) continue;
    if (sign > 0) positive += 1;
    else negative += 1;
    if (previousSign && sign !== previousSign) flips += 1;
    previousSign = sign;
  }

  const moving = positive + negative;
  return {
    x: sumX / frames.length,
    y: sumY / frames.length,
    magnitude: sumMagnitude / frames.length,
    coherence: moving ? Math.max(positive, negative) / moving : 0,
    shake: moving > 2 ? flips / (moving - 1) : 0,
  };
}

export function shouldMirrorX(target?: MotionStats, source?: MotionStats) {
  if (!target || !source) return false;
  if (target.coherence < 0.55 || source.coherence < 0.55) return false;
  if (target.shake > 0.45 || source.shake > 0.45) return false;
  if (Math.abs(target.x) < 0.004 || Math.abs(source.x) < 0.004) return false;
  return Math.sign(target.x) !== Math.sign(source.x);
}