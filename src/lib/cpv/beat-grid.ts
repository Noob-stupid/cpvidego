export interface BeatGrid {
  bpm: number;
  interval: number;
  offset: number;
  beats: number[];
  strengths: number[];
  downbeats: number[];
  confidence: number;
  duration: number;
}

interface GridOptions {
  bpmHint?: number;
  maxSeconds?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function toMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) out[i] += data[i];
  }
  const gain = 1 / Math.max(1, buffer.numberOfChannels);
  for (let i = 0; i < length; i += 1) out[i] *= gain;
  return out;
}

/** 低通预滤波：让鼓点/低频主导包络，减少高频人声与镲片带来的假拍。 */
function lowPass(samples: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const out = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = 1 / (rc * sampleRate + 1);
  let previous = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    previous = 0;
    const source = pass === 0 ? samples : out;
    for (let i = 0; i < source.length; i += 1) {
      previous += alpha * (source[i] - previous);
      out[i] = previous;
    }
  }
  return out;
}

function buildEnvelope(samples: Float32Array, hop: number): Float32Array {
  const frames = Math.max(1, Math.floor(samples.length / hop));
  const env = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const start = i * hop;
    const end = Math.min(samples.length, start + hop);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 2) {
      sum += samples[j] * samples[j];
      count += 1;
    }
    env[i] = Math.sqrt(sum / Math.max(1, count));
  }
  const smooth = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const a = env[Math.max(0, i - 1)];
    const b = env[i];
    const c = env[Math.min(frames - 1, i + 1)];
    smooth[i] = (a + b + c) / 3;
  }
  return smooth;
}

/** 减去局部均值后的正差分，即近似 spectral flux 的起峰曲线。 */
export function onsetFlux(env: Float32Array, windowFrames: number): Float32Array {
  const frames = env.length;
  const flux = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    let count = 0;
    for (
      let j = Math.max(0, i - windowFrames);
      j <= Math.min(frames - 1, i + windowFrames);
      j += 4
    ) {
      sum += env[j];
      count += 1;
    }
    const mean = sum / Math.max(1, count);
    const diff = env[i] - (i > 0 ? env[i - 1] : env[i]);
    flux[i] = Math.max(0, diff) * (1 + Math.max(0, (env[i] - mean) / (mean + 1e-6)));
  }
  let max = 0;
  for (let i = 0; i < frames; i += 1) max = Math.max(max, flux[i]);
  if (max > 0) for (let i = 0; i < frames; i += 1) flux[i] /= max;
  return flux;
}

function fluxReduce(flux: Float32Array, lag: number, skip: number) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + lag < flux.length; i += skip) {
    sum += flux[i] * flux[i + lag];
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

export function tempoFromFlux(
  flux: Float32Array,
  fluxRate: number,
  bpmHint?: number,
): { bpm: number; score: number } {
  const minLag = Math.max(2, Math.floor((60 / 220) * fluxRate));
  const maxLag = Math.min(flux.length - 2, Math.ceil((60 / 55) * fluxRate));
  let bestLag = 0;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i + lag < flux.length; i += 1) {
      sum += flux[i] * flux[i + lag];
      energyA += flux[i] * flux[i];
      energyB += flux[i + lag] * flux[i + lag];
    }
    const normalized = sum / (Math.sqrt(energyA * energyB) + 1e-6);
    const half = Math.round(lag / 2);
    const double = Math.round(lag * 2);
    const support =
      (half >= 2 ? fluxReduce(flux, half, lag) : 0) * 0.35 +
      (double >= 2 && double < flux.length ? fluxReduce(flux, double, lag) : 0) * 0.25;
    const score = normalized + support;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 2) return { bpm: 0, score: 0 };
  let bpm = (60 * fluxRate) / bestLag;
  while (bpm < 70 && bpm * 2 <= 220) bpm *= 2;
  while (bpm > 190 && bpm / 2 >= 70) bpm /= 2;
  if (bpmHint && bpmHint >= 55 && bpmHint <= 220 && Math.abs(bpm - bpmHint) / bpmHint < 0.18) {
    bpm = bpmHint;
  }
  return { bpm: Math.round(bpm * 10) / 10, score: clamp(bestScore, 0, 1) };
}

function pickPeaks(flux: Float32Array, fluxRate: number, minInterval: number): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < flux.length - 1; i += 1) {
    if (flux[i] < 0.12) continue;
    if (flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      const time = i / fluxRate;
      const previousIndex = Math.round(peaks[peaks.length - 1] * fluxRate);
      if (peaks.length === 0 || time - peaks[peaks.length - 1] >= minInterval) peaks.push(time);
      else if (flux[i] > flux[previousIndex]) peaks[peaks.length - 1] = time;
      i += 1;
    }
  }
  return peaks;
}

/** 纯数学核：起峰曲线 → 节拍网格。不依赖任何 Web API，可直接单测。 */
export function gridFromFlux(
  flux: Float32Array,
  fluxRate: number,
  duration: number,
  options: GridOptions = {},
): BeatGrid {
  const tempo = tempoFromFlux(flux, fluxRate, options.bpmHint);
  const peaks = pickPeaks(flux, fluxRate, 0.16);
  let averageGap = 0;
  if (peaks.length >= 4) {
    let sum = 0;
    for (let i = 1; i < peaks.length; i += 1) sum += peaks[i] - peaks[i - 1];
    averageGap = sum / (peaks.length - 1);
  }

  const bpm =
    tempo.bpm > 0 && tempo.score > 0.12
      ? tempo.bpm
      : averageGap > 0.2
        ? clamp(Math.round(60 / averageGap), 60, 200)
        : 0;

  if (bpm <= 0) {
    return {
      bpm: 0,
      interval: 0,
      offset: peaks[0] ?? 0,
      beats: peaks,
      strengths: peaks.map((time) => flux[clamp(Math.round(time * fluxRate), 0, flux.length - 1)] ?? 0),
      downbeats: [],
      confidence: 0,
      duration,
    };
  }

  const interval = 60 / bpm;
  const searchWindow = Math.min(duration, Math.max(interval * 4, 4));
  const gridFrames = Math.max(4, Math.floor(searchWindow * fluxRate));
  const stepFrames = Math.max(1, Math.round(interval * fluxRate));
  let bestOffset = 0;
  let bestPhaseScore = 0;
  const maxStart = Math.max(1, Math.floor(interval * fluxRate));
  for (let start = 0; start < maxStart; start += 1) {
    let sum = 0;
    let count = 0;
    for (let i = start; i < gridFrames; i += stepFrames) {
      sum += flux[i];
      count += 1;
    }
    const score = count > 0 ? sum / count : 0;
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestOffset = start;
    }
  }

  const tolerance = Math.min(0.09, interval * 0.22);
  const beats: number[] = [];
  const strengths: number[] = [];
  for (let time = bestOffset / fluxRate; time < duration; time += interval) {
    let snapped = time;
    let best = Number.POSITIVE_INFINITY;
    for (const peak of peaks) {
      const distance = Math.abs(peak - time);
      if (distance < best && distance <= tolerance) {
        best = distance;
        snapped = peak;
      }
    }
    if (beats.length > 0 && snapped - beats[beats.length - 1] < interval * 0.5) continue;
    beats.push(snapped);
    strengths.push(flux[clamp(Math.round(snapped * fluxRate), 0, flux.length - 1)] ?? bestPhaseScore);
  }

  let offsetIndex = 0;
  let offsetScore = -1;
  for (let phase = 0; phase < 4; phase += 1) {
    let sum = 0;
    let count = 0;
    for (let i = phase; i < beats.length; i += 4) {
      sum += strengths[i] ?? 0;
      count += 1;
    }
    const score = count > 0 ? sum / count : 0;
    if (score > offsetScore) {
      offsetScore = score;
      offsetIndex = phase;
    }
  }
  const downbeats: number[] = [];
  for (let i = offsetIndex; i < beats.length; i += 4) downbeats.push(beats[i]);

  return {
    bpm,
    interval,
    offset: beats[0] ?? 0,
    beats,
    strengths,
    downbeats,
    confidence: clamp(tempo.score * 0.7 + bestPhaseScore * 0.6, 0, 1),
    duration,
  };
}

export async function detectBeatGrid(
  blob: Blob,
  options: { maxSeconds?: number; bpmHint?: number } = {},
): Promise<BeatGrid | null> {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const maxSeconds = options.maxSeconds ?? 90;
    const samplesAll = toMono(audio);
    const sampleCount = Math.min(samplesAll.length, Math.round(audio.sampleRate * maxSeconds));
    const samples = samplesAll.subarray(0, sampleCount);
    const duration = sampleCount / audio.sampleRate;
    if (duration < 1) return null;

    const hop = Math.max(64, Math.round(audio.sampleRate / 86));
    const env = buildEnvelope(lowPass(samples, 190, audio.sampleRate), hop);
    const fluxRate = audio.sampleRate / hop;
    const flux = onsetFlux(env, Math.round(fluxRate * 0.75));
    return gridFromFlux(flux, fluxRate, duration, options);
  } catch {
    return null;
  } finally {
    void context.close().catch(() => undefined);
  }
}

/** 音乐开头有静音时，把网格推到第一个有效拍。 */
export function trimGridToFirstHit(grid: BeatGrid, minStrength = 0.18): BeatGrid {
  if (!grid.beats.length) return grid;
  let start = grid.beats.findIndex((_, index) => (grid.strengths[index] ?? 0) >= minStrength);
  if (start < 0) start = 0;
  const beats = grid.beats.slice(start);
  const strengths = grid.strengths.slice(start);
  return {
    ...grid,
    offset: beats[0] ?? 0,
    beats,
    strengths,
    downbeats: grid.downbeats.filter((time) => time >= (beats[0] ?? 0)),
  };
}

export function beatsInRange(grid: BeatGrid, from: number, to: number): number[] {
  return grid.beats.filter((time) => time >= from && time < to);
}

/** 求 BGM 起始偏移，使输出切点尽量落在拍上（风格复刻换 BGM 时用）。 */
export function alignBedOffset(grid: BeatGrid, cutTimes: number[], tolerance = 0.08): number {
  if (grid.interval <= 0 || !grid.beats.length || !cutTimes.length) return 0;
  let bestOffset = 0;
  let bestHits = -1;
  const steps = 48;
  for (let i = 0; i < steps; i += 1) {
    const offset = (i / steps) * grid.interval;
    let hits = 0;
    for (const cut of cutTimes) {
      const musicTime = cut + offset;
      const distance = Math.min(...grid.beats.map((beat) => Math.abs(beat - musicTime)));
      if (distance <= tolerance) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestOffset = offset;
    }
  }
  return Math.round(bestOffset * 1000) / 1000;
}
