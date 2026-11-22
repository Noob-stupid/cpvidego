import type { AudioClip, MediaAsset } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;

export const MIN_CLIP = 0.2;
export const MAX_SPEED = 2;
export const MIN_SPEED = 0.4;

/** 统一整理音频轨：排序、消重叠、保证速度自洽，循环段允许源短于段长。 */
export function normalizeClips(clips: AudioClip[]): AudioClip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start || a.index - b.index);
  let cursor = 0;
  return sorted.map((clip, index) => {
    const start = round3(Math.max(cursor, clip.start));
    const duration = round3(Math.max(MIN_CLIP, clip.duration));
    cursor = start + duration;
    const sourceLength = Math.max(0.05, clip.sourceOut - clip.sourceIn);
    let used: number;
    let speed: number;
    if (clip.loop) {
      used = sourceLength;
      speed = 1;
    } else {
      const wanted = clamp(clip.speed, MIN_SPEED, MAX_SPEED);
      used = Math.min(sourceLength, duration * wanted);
      speed = used / duration;
    }
    return {
      ...clip,
      index,
      start,
      duration,
      sourceIn: round3(clip.sourceIn),
      sourceOut: round3(clip.sourceIn + used),
      speed: round3(speed),
      volume: round3(clamp(clip.volume, 0, 2)),
      fadeIn: round3(clamp(clip.fadeIn, 0, duration / 2)),
      fadeOut: round3(clamp(clip.fadeOut, 0, duration / 2)),
    };
  });
}

export function clipEnd(clip: AudioClip) {
  return round3(clip.start + clip.duration);
}

/** 追加一段音乐：默认接在上段之后，时长吸附到节拍。 */
export function appendClip(
  clips: AudioClip[],
  asset: MediaAsset,
  timelineDuration: number,
  beatInterval = 0,
): AudioClip | null {
  const available = Math.max(0.5, asset.duration ?? 0);
  if (available <= 0.2) return null;
  const last = clips[clips.length - 1];
  const start = last ? clipEnd(last) : 0;
  if (start >= timelineDuration) return null;
  const wanted = timelineDuration - start;
  const duration = beatInterval > 0
    ? round3(Math.max(MIN_CLIP, Math.floor(wanted / beatInterval) * beatInterval))
    : round3(wanted);
  return {
    id: `ac_${Math.random().toString(36).slice(2, 9)}`,
    index: clips.length,
    assetId: asset.id,
    start,
    duration: round3(Math.max(MIN_CLIP, duration)),
    sourceIn: 0,
    sourceOut: round3(Math.min(available, Math.max(MIN_CLIP, duration))),
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: round3(Math.min(1.2, Math.max(0, duration) * 0.08)),
    loop: available < duration,
  };
}

/** 复制一段（用于"副歌再来一次"），插到原段之后并把后续段推后。 */
export function duplicateClip(clips: AudioClip[], id: string): AudioClip[] {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return clips;
  const source = clips[index];
  const copy: AudioClip = {
    ...source,
    id: `ac_${Math.random().toString(36).slice(2, 9)}`,
    start: clipEnd(source),
  };
  const shifted = clips.map((clip, i) =>
    i > index ? { ...clip, start: round3(clip.start + source.duration) } : clip,
  );
  return normalizeClips([...shifted.slice(0, index + 1), copy, ...shifted.slice(index + 1)]);
}

/** 在给定时间点切分包含它的段。 */
export function splitClipAt(clips: AudioClip[], time: number): AudioClip[] {
  const target = clips.find((clip) => time > clip.start + 0.05 && time < clipEnd(clip) - 0.05);
  if (!target) return clips;
  const left = round3(time - target.start);
  const rightDuration = round3(target.duration - left);
  if (left < MIN_CLIP || rightDuration < MIN_CLIP) return clips;
  const consumed = target.loop ? left * target.speed : left * target.speed;
  const leftClip: AudioClip = {
    ...target,
    duration: left,
    sourceOut: round3(target.sourceIn + consumed),
    fadeOut: 0,
  };
  const rightClip: AudioClip = {
    ...target,
    id: `ac_${Math.random().toString(36).slice(2, 9)}`,
    start: round3(time),
    duration: rightDuration,
    sourceIn: round3(target.sourceIn + consumed),
    sourceOut: target.sourceOut,
    fadeIn: 0,
  };
  return normalizeClips(
    clips.flatMap((clip) => (clip.id === target.id ? [leftClip, rightClip] : [clip])),
  );
}

/** 音量自动化：淡入淡出用线性斜坡，Remotion 与预览共用同一口径。 */
export function clipVolumeAt(
  clip: Pick<AudioClip, "volume" | "fadeIn" | "fadeOut" | "duration">,
  localTime: number,
) {
  const base = clip.volume;
  const inLength = Math.max(0.001, clip.fadeIn);
  const outLength = Math.max(0.001, clip.fadeOut);
  const rise = clip.fadeIn > 0 ? clamp(localTime / inLength, 0, 1) : 1;
  const fall =
    clip.fadeOut > 0 ? clamp((clip.duration - localTime) / outLength, 0, 1) : 1;
  return clamp(base * Math.min(rise, fall), 0, 2);
}

export function audioTrackEnd(clips: AudioClip[]) {
  return clips.length ? round3(Math.max(...clips.map(clipEnd))) : 0;
}

/** 预览用：找出覆盖当前输出时间的段。 */
export function activeClipAt(clips: AudioClip[], outputTime: number): AudioClip | null {
  return clips.find((clip) => outputTime >= clip.start && outputTime < clipEnd(clip)) ?? null;
}
