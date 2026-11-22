"use client";

import {
  AbsoluteFill,
  Img,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio, Video } from "@remotion/media";
import { renderMediaOnWeb } from "@remotion/web-renderer";
import { RgbFilterDefs } from "@/components/cpv/rgb-filter-defs";
import { clipVolumeAt } from "./audio-track";
import { computePanCurve, panAt, type PanCurve } from "./audio-pan";
import { colorFilter, scaleColorGrade, warmthTint } from "./color-match";
import { composeTransform, scaleCompositionAdjust } from "./composition";
import { computeEffectFrame, joinFilters, scaleEffects } from "./effects";
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  type AudioClip,
  type AudioSettings,
  type MatchSettings,
  type MediaAsset,
  type Slot,
  type SlotEffects,
} from "./types";

interface ClipPlan {
  src: string;
  kind: "video" | "image";
  from: number;
  durationInFrames: number;
  slotDuration: number;
  startSeconds: number;
  seed: number;
  startFrom: number;
  endAt: number;
  playbackRate: number;
  volume: number;
  filter?: string;
  transform?: string;
  tintColor?: string;
  tintOpacity?: number;
  effects?: SlotEffects;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function mediaStyle(clip: ClipPlan): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    objectFit: clip.kind === "image" ? "contain" : "cover",
    transform: clip.transform,
    transformOrigin: "center center",
  };
}

function TimelineClip({
  clip,
  panCurve,
  visualPanStrength,
}: {
  clip: ClipPlan;
  panCurve?: PanCurve | null;
  visualPanStrength: number;
}) {
  const frame = useCurrentFrame();
  const progress = clip.durationInFrames > 1 ? frame / (clip.durationInFrames - 1) : 0;
  const absoluteTime = clip.startSeconds + progress * clip.slotDuration;
  const audioPan = panAt(panCurve, absoluteTime);
  const effect = computeEffectFrame(
    clip.effects,
    progress,
    progress * clip.slotDuration,
    clip.seed,
    audioPan,
    visualPanStrength,
  );
  const filter = joinFilters(clip.filter, effect.filter);

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: effect.transform,
          filter: filter || undefined,
          transformOrigin: "center center",
          willChange: "transform, filter",
        }}
      >
        {clip.kind === "image" ? (
          <Img src={clip.src} style={mediaStyle(clip)} />
        ) : (
          <Video
            src={clip.src}
            trimBefore={clip.startFrom}
            trimAfter={clip.endAt}
            playbackRate={clip.playbackRate}
            muted
            style={mediaStyle(clip)}
          />
        )}
      </AbsoluteFill>
      {clip.tintColor && (
        <AbsoluteFill
          style={{
            backgroundColor: clip.tintColor,
            opacity: clip.tintOpacity,
            mixBlendMode: "soft-light",
          }}
        />
      )}
      {effect.scanlineOpacity > 0.001 && (
        <AbsoluteFill
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.22) 0px, rgba(255,255,255,0.22) 1px, transparent 1px, transparent 3px)",
            opacity: effect.scanlineOpacity,
            mixBlendMode: "overlay",
          }}
        />
      )}
      {effect.flashOpacity > 0.001 && (
        <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: effect.flashOpacity }} />
      )}
    </AbsoluteFill>
  );
}

interface TimelineCompositionProps {
  clips: ClipPlan[];
  audioClips: AudioClipPlan[];
  bed: "reference" | "bgm" | "none";
  bedSrc?: string;
  bgmSrc?: string;
  bgmVolume: number;
  bgmTrimBefore: number;
  panCurve?: PanCurve | null;
  visualPanStrength: number;
}

interface AudioClipPlan {
  src: string;
  from: number;
  durationInFrames: number;
  trimBefore: number;
  trimAfter: number;
  playbackRate: number;
  loop: boolean;
  baseVolume: number;
  fadeIn: number;
  fadeOut: number;
  duration: number;
}

function AudioTrackClip({ clip }: { clip: AudioClipPlan }) {
  const { fps } = useVideoConfig();
  const volume = (frame: number) =>
    clipVolumeAt(
      {
        volume: clip.baseVolume,
        fadeIn: clip.fadeIn,
        fadeOut: clip.fadeOut,
        duration: clip.duration,
      },
      frame / fps,
    );
  return (
    <Sequence from={clip.from} durationInFrames={clip.durationInFrames}>
      <Audio
        src={clip.src}
        trimBefore={clip.trimBefore}
        trimAfter={clip.trimAfter}
        playbackRate={clip.playbackRate}
        loop={clip.loop}
        volume={volume}
      />
    </Sequence>
  );
}

function TimelineComposition({
  clips,
  audioClips,
  bed,
  bedSrc,
  bgmSrc,
  bgmVolume,
  bgmTrimBefore,
  panCurve,
  visualPanStrength,
}: TimelineCompositionProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000", overflow: "hidden" }}>
      <RgbFilterDefs />
      {clips.map((clip, index) => (
        <Sequence key={index} from={clip.from} durationInFrames={clip.durationInFrames}>
          <TimelineClip
            clip={clip}
            panCurve={panCurve}
            visualPanStrength={visualPanStrength}
          />
          {clip.kind === "video" && clip.volume > 0.001 && (
            <Audio
              src={clip.src}
              trimBefore={clip.startFrom}
              trimAfter={clip.endAt}
              playbackRate={clip.playbackRate}
              volume={clip.volume}
            />
          )}
        </Sequence>
      ))}
      {audioClips.map((clip, index) => (
        <AudioTrackClip key={`audio-${index}`} clip={clip} />
      ))}
      {audioClips.length === 0 && bed === "reference" && bedSrc && bgmVolume > 0.001 && (
        <Audio src={bedSrc} volume={bgmVolume} />
      )}
      {audioClips.length === 0 && bed === "bgm" && bgmSrc && bgmVolume > 0.001 && (
        <Audio src={bgmSrc} loop volume={bgmVolume} trimBefore={bgmTrimBefore} />
      )}
    </AbsoluteFill>
  );
}

interface RenderOptions {
  slots: Slot[];
  assets: MediaAsset[];
  reference: MediaAsset;
  bgm?: MediaAsset | null;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  matchSettings?: MatchSettings;
  audioSettings?: AudioSettings;
  bgmStartSeconds?: number;
  audioClips?: AudioClip[];
  onProgress?: (progress: number) => void;
}

export async function renderTimelineToMp4({
  slots,
  assets,
  reference,
  bgm,
  duration,
  width = 1920,
  height = 1080,
  fps = 30,
  matchSettings = DEFAULT_MATCH_SETTINGS,
  audioSettings = DEFAULT_AUDIO_SETTINGS,
  bgmStartSeconds = 0,
  audioClips = [],
  onProgress,
}: RenderOptions): Promise<Blob> {
  if (!slots.length) throw new Error("时间线没有可导出的镜头");

  const clips: ClipPlan[] = [];
  let visualFrames = 0;

  for (const slot of slots) {
    const asset = assets.find((item) => item.id === slot.assetId);
    if (!asset) continue;

    const startFrame = Math.max(0, Math.round(slot.start * fps));
    const endAtSeconds = Number.isFinite(slot.end)
      ? slot.end
      : slot.start + slot.duration;
    const endFrame = Math.max(startFrame + 1, Math.round(endAtSeconds * fps));
    const durationInFrames = endFrame - startFrame;

    const sourceIn = Math.max(0, slot.sourceIn);
    const sourceOut = Math.max(sourceIn + 0.05, slot.sourceOut);
    const sourceInFrame = Math.round(sourceIn * fps);
    const sourceOutFrame = Math.max(sourceInFrame + 1, Math.round(sourceOut * fps));
    const playbackRate =
      asset.kind === "image"
        ? 1
        : clamp((sourceOutFrame - sourceInFrame) / durationInFrames, 0.0625, 8);

    const colorGrade =
      matchSettings.color && slot.colorGrade
        ? scaleColorGrade(slot.colorGrade, matchSettings.strength)
        : null;
    const tint = colorGrade ? warmthTint(colorGrade) : null;
    const transform = composeTransform(
      Boolean(matchSettings.motion && slot.mirrorX),
      matchSettings.composition && slot.composition
        ? scaleCompositionAdjust(slot.composition, matchSettings.strength)
        : undefined,
    );

    clips.push({
      src: asset.url,
      kind: asset.kind === "image" ? "image" : "video",
      from: startFrame,
      durationInFrames,
      slotDuration: slot.duration,
      startSeconds: slot.start,
      seed: slot.index,
      startFrom: sourceInFrame,
      endAt: sourceOutFrame,
      playbackRate,
      volume: (slot.volume ?? 1) * audioSettings.originalVolume,
      filter: colorGrade ? colorFilter(colorGrade) : undefined,
      transform,
      tintColor: tint?.color,
      tintOpacity: tint?.opacity,
      effects: scaleEffects(slot.effects, slot.effectScale ?? 1),
    });
    visualFrames = Math.max(visualFrames, endFrame);
  }

  if (!clips.length) throw new Error("没有可用的替换素材");

  const audioFrames = Math.round(duration * fps);
  const totalFrames = Math.max(1, visualFrames, audioFrames);
  const bed = audioSettings.bed;
  const bedAsset = bed === "reference" ? reference : bed === "bgm" ? bgm : null;
  let panCurve: PanCurve | null = null;
  if (bedAsset && audioSettings.visualPan) {
    try {
      const blob = (bedAsset.file ??
        (await fetch(bedAsset.url).then((response) => response.blob()))) as Blob;
      panCurve = await computePanCurve(blob);
    } catch {
      panCurve = null;
    }
  }
  const audioPlan: AudioClipPlan[] = [];
  for (const clip of audioClips) {
    const asset = assets.find((item) => item.id === clip.assetId) ?? (bgm?.id === clip.assetId ? bgm : undefined);
    if (!asset) continue;
    const from = Math.max(0, Math.round(clip.start * fps));
    const durationInFrames = Math.max(1, Math.round(clip.duration * fps));
    const trimBefore = Math.max(0, Math.round(clip.sourceIn * fps));
    const trimAfter = Math.max(trimBefore + 1, Math.round(clip.sourceOut * fps));
    audioPlan.push({
      src: asset.url,
      from,
      durationInFrames,
      trimBefore,
      trimAfter,
      playbackRate: clip.loop ? 1 : Math.max(0.0625, clip.speed),
      loop: clip.loop,
      baseVolume: clip.volume,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
      duration: clip.duration,
    });
  }

  const props = {
    clips,
    audioClips: audioPlan,
    bed,
    bedSrc: bed === "reference" ? reference.url : undefined,
    bgmSrc: bed === "bgm" ? bgm?.url : undefined,
    bgmVolume: audioSettings.bgmVolume,
    bgmTrimBefore: bed === "bgm" ? Math.max(0, Math.round(bgmStartSeconds * fps)) : 0,
    panCurve,
    visualPanStrength: audioSettings.visualPanStrength,
  };

  const { getBlob } = await renderMediaOnWeb({
    composition: {
      id: "cpvidego-timeline",
      component: TimelineComposition,
      durationInFrames: totalFrames,
      fps,
      width,
      height,
      defaultProps: props,
    },
    inputProps: props,
    onProgress: (progress: { progress: number }) => {
      onProgress?.(progress.progress);
    },
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    videoBitrate: "high",
    audioBitrate: "high",
    hardwareAcceleration: "prefer-hardware",
  });

  return getBlob();
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