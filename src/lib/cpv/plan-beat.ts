import type { BeatGrid } from "./beat-grid";
import type { SourceWindow } from "./scan-source";
import type { BeatDensity, SlotEffects } from "./types";

export type BeatRole = "lead" | "hit" | "fill";

export interface BeatPlanConfig {
  targetDuration: number;
  sourceDuration: number;
  density: BeatDensity;
  slowmo: number;
  leadIn: number;
  effectScale: number;
  musicStart?: number;
  minSlot?: number;
  maxSlot?: number;
}

export interface BeatSlotSpec {
  index: number;
  start: number;
  end: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  role: BeatRole;
  beatTime: number;
  strength: number;
  effects: SlotEffects;
  muted: boolean;
}

export interface BeatPlan {
  slots: BeatSlotSpec[];
  duration: number;
  musicStart: number;
  bpm: number;
  stats: {
    hits: number;
    leads: number;
    slowest: number;
    fastest: number;
    sourceReuse: number;
  };
}

export const DEFAULT_BEAT_CONFIG: Omit<BeatPlanConfig, "sourceDuration"> = {
  targetDuration: 30,
  density: "auto",
  slowmo: 0.7,
  leadIn: 0.55,
  effectScale: 1,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** 确定性抖动：同一素材每次生成的卡点片一致，便于回归测试。 */
function jitter(seed: number, amplitude: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * amplitude;
}

function buildBoundaries(grid: BeatGrid, config: BeatPlanConfig, musicStart: number) {
  const target = config.targetDuration;
  const minSlot = config.minSlot ?? 0.2;
  const maxSlot = config.maxSlot ?? 2.6;
  const maxStrength = Math.max(0.001, ...grid.strengths);
  const downbeatSet = new Set(grid.downbeats.map((value) => round3(value)));
  const times: { time: number; strength: number; downbeat: boolean }[] = [];

  const push = (time: number, strength: number, downbeat: boolean) => {
    const output = round3(time - musicStart);
    if (output <= 0.001 || output >= target - 0.05) return;
    if (times.length && output - times[times.length - 1].time < minSlot) return;
    times.push({ time: output, strength, downbeat });
  };

  if (grid.interval > 0 && grid.beats.length > 1) {
    const stride =
      config.density === "every4" ? 4 : config.density === "every2" ? 2 : 1;
    const autoStride = grid.bpm >= 150 ? 2 : 1;
    const step = config.density === "auto" ? autoStride : stride;
    const useHalf =
      config.density === "half" || (config.density === "auto" && grid.bpm > 0 && grid.bpm < 90);
    for (let i = 0; i < grid.beats.length; i += step) {
      const beat = grid.beats[i];
      const strength = grid.strengths[i] ?? 0.5;
      const downbeat = downbeatSet.has(round3(beat));
      const weak = strength < maxStrength * 0.3 && !downbeat;
      if (!weak || i % 2 === 0) push(beat, strength, downbeat);
      const next = grid.beats[i + step];
      if (useHalf && next != null) {
        push((beat + next) / 2, strength * 0.72, false);
      }
    }
  } else {
    const step = grid.interval > 0 ? grid.interval : 0.5;
    for (let time = musicStart + step; time < musicStart + target; time += step) {
      push(time, 0.5, false);
    }
  }

  const filled: typeof times = [];
  let previousTime = 0;
  for (const item of times) {
    while (item.time - previousTime > maxSlot) {
      const middle = round3(previousTime + maxSlot * 0.75);
      filled.push({ time: middle, strength: 0.35, downbeat: false });
      previousTime = middle;
    }
    filled.push(item);
    previousTime = item.time;
  }
  while (target - previousTime > maxSlot) {
    const middle = round3(previousTime + maxSlot * 0.75);
    filled.push({ time: middle, strength: 0.35, downbeat: false });
    previousTime = middle;
  }
  return filled;
}

function sourcePicker(
  windows: SourceWindow[],
  sourceDuration: number,
  needed: number,
  preferScore: boolean,
  recent: number[],
) {
  const candidates = windows.length
    ? [...windows].sort((a, b) => (preferScore ? b.score - a.score : a.start - b.start))
    : [];
  const fits = (start: number) => start + needed <= sourceDuration + 0.05;
  for (const window of candidates) {
    const start = clamp(window.start + jitter(window.start * 7, 0.12), 0, sourceDuration - needed);
    if (!fits(start)) continue;
    if (recent.some((used) => Math.abs(used - start) < 0.45)) continue;
    return round3(start);
  }
  // 窗口都用过时仍在合格池内挑最久未用的，绝不盲取到暗场。
  let bestStart: number | null = null;
  let bestDistance = -1;
  for (const window of candidates) {
    const start = window.start;
    if (!fits(start)) continue;
    const distance = recent.length
      ? Math.min(...recent.map((used) => Math.abs(used - start)))
      : Number.POSITIVE_INFINITY;
    if (distance > bestDistance) {
      bestDistance = distance;
      bestStart = start;
    }
  }
  if (bestStart != null) return round3(bestStart);

  const stride = Math.max(needed, sourceDuration / Math.max(1, recent.length + 2));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const start = round3(
      clamp(((recent.length + attempt) * stride) % Math.max(0.1, sourceDuration - needed), 0, sourceDuration - needed),
    );
    if (recent.some((used) => Math.abs(used - start) < 0.3)) continue;
    return start;
  }
  return round3(clamp(sourceDuration - needed, 0, sourceDuration));
}

export function buildBeatPlan(
  grid: BeatGrid,
  config: BeatPlanConfig,
  windows: SourceWindow[] = [],
): BeatPlan {
  const musicStart = config.musicStart ?? 0;
  const target = Math.max(1, config.targetDuration);
  const sourceDuration = Math.max(0.5, config.sourceDuration);
  const boundaries = buildBoundaries(grid, { ...config, targetDuration: target }, musicStart);
  const edges = [0, ...boundaries.map((item) => item.time), target];
  const downbeats = new Set(boundaries.filter((item) => item.downbeat).map((item) => item.time));

  const slowSpeed = clamp(1 - 0.68 * clamp(config.slowmo, 0, 1), 0.25, 1);
  const leadSpeed = clamp(1 + 1.3 * clamp(config.leadIn, 0, 1), 1, 2.6);
  const effectScale = clamp(config.effectScale, 0, 1.5);
  const recent: number[] = [];
  const slots: BeatSlotSpec[] = [];
  let reuse = 0;

  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = round3(edges[i]);
    const end = round3(edges[i + 1]);
    const duration = round3(Math.max(0.12, end - start));
    const boundary = boundaries[i - 1];
    const strength = boundary?.strength ?? 0.4;
    const isHit =
      config.slowmo > 0.05 &&
      duration >= 0.24 &&
      i > 0 &&
      (downbeats.has(start) || strength >= 0.62);
    const nextBoundary = boundaries[i];
    const nextDuration = round3((edges[i + 2] ?? target) - (edges[i + 1] ?? end));
    const nextIsHit =
      config.slowmo > 0.05 &&
      nextDuration >= 0.24 &&
      nextBoundary != null &&
      (nextBoundary.downbeat || nextBoundary.strength >= 0.62);
    const role: BeatRole = isHit ? "hit" : nextIsHit && config.leadIn > 0.05 ? "lead" : "fill";

    let speed = 1;
    if (role === "hit") speed = slowSpeed;
    else if (role === "lead") speed = leadSpeed;
    if (duration < 0.22) speed = clamp(speed, 0.6, 1.6);

    const needed = clamp(duration * speed, 0.12, sourceDuration);
    const actualSpeed = round3(clamp(needed / duration, 0.0625, 8));
    const sourceIn = sourcePicker(windows, sourceDuration, needed, role === "hit", recent);
    const sourceOut = round3(Math.min(sourceDuration, sourceIn + duration * actualSpeed));
    if (recent.some((used) => Math.abs(used - sourceIn) < 0.2)) reuse += 1;
    recent.push(sourceIn);
    if (recent.length > 6) recent.shift();

    const effects: SlotEffects = {};
    if (role === "hit") {
      effects.flash = round3(clamp(0.3 + strength * 0.4, 0, 1) * effectScale);
      effects.zoom = round3(clamp(0.34 + strength * 0.2, 0, 1) * effectScale);
      if (strength > 0.72) effects.shake = round3(0.3 * effectScale);
      if (strength > 0.86) effects.rgb = round3(0.3 * effectScale);
    } else if (role === "lead") {
      if (strength > 0.6) effects.glitch = round3(0.24 * effectScale);
      effects.zoom = round3(-0.2 * effectScale);
    } else if (i % 3 === 1) {
      effects.zoom = round3((i % 2 === 0 ? 0.22 : -0.18) * effectScale);
    }

    slots.push({
      index: i,
      start,
      end,
      duration,
      sourceIn,
      sourceOut,
      speed: actualSpeed,
      role: role,
      beatTime: round3(musicStart + start),
      strength: round3(strength),
      effects: Object.keys(effects).length ? effects : {},
      muted: Math.abs(actualSpeed - 1) > 0.12,
    });
  }

  const speeds = slots.map((slot) => slot.speed);
  return {
    slots,
    duration: target,
    musicStart,
    bpm: grid.bpm,
    stats: {
      hits: slots.filter((slot) => slot.role === "hit").length,
      leads: slots.filter((slot) => slot.role === "lead").length,
      slowest: speeds.length ? Math.min(...speeds) : 1,
      fastest: speeds.length ? Math.max(...speeds) : 1,
      sourceReuse: reuse,
    },
  };
}

/** 无节拍信息时的兜底：按固定间隔切，仍保留冲刺→慢放的结构。 */
export function fallbackGrid(duration: number, interval = 0.5): BeatGrid {
  const beats: number[] = [];
  const strengths: number[] = [];
  const downbeats: number[] = [];
  for (let time = 0; time < duration; time += interval) {
    beats.push(round3(time));
    const index = beats.length - 1;
    strengths.push(index % 4 === 0 ? 0.9 : index % 2 === 0 ? 0.6 : 0.4);
    if (index % 4 === 0) downbeats.push(round3(time));
  }
  return {
    bpm: Math.round(60 / interval),
    interval,
    offset: 0,
    beats,
    strengths,
    downbeats,
    confidence: 0,
    duration,
  };
}
