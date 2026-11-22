export type CPVStep = "home" | "upload" | "analyzing" | "dna" | "editor";
export type MediaKind = "video" | "image" | "audio";
export type EditorMode = "simple" | "track";
export type EditKind = "style" | "beat";
export type BeatDensity = "half" | "beat" | "every2" | "every4" | "auto";

export interface ShotTags {
  kind?: "anime" | "live" | "3d" | "other";
  letterbox?: boolean;
  shotSize?: "close" | "medium" | "wide";
  subject?: string;
  energy?: number;
  quality?: number;
}

export interface ColorStats {
  r: number;
  g: number;
  b: number;
  luma: number;
  saturation: number;
  contrast: number;
  warmth: number;
}

export interface ColorGrade {
  brightness: number;
  saturate: number;
  contrast: number;
  warmth: number;
}

export interface MotionStats {
  x: number;
  y: number;
  magnitude: number;
  coherence: number;
  shake: number;
}

export interface CompositionStats {
  cx: number;
  cy: number;
  spread: number;
}

export interface CompositionAdjust {
  scale: number;
  shiftX: number;
  shiftY: number;
}

export interface MatchSettings {
  color: boolean;
  motion: boolean;
  composition: boolean;
  strength: number;
}

export type EffectKind = "flash" | "shake" | "zoom" | "rgb" | "glitch" | "grade";
export type SlotEffects = Partial<Record<EffectKind, number>>;

export type AudioBed = "reference" | "bgm" | "none";

export interface AudioSettings {
  bed: AudioBed;
  bgmVolume: number;
  originalVolume: number;
  autoBalance: boolean;
  visualPan: boolean;
  visualPanStrength: number;
  bgmOffset: number;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  color: true,
  motion: true,
  composition: true,
  strength: 0.75,
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  bed: "reference",
  bgmVolume: 0.9,
  originalVolume: 0,
  autoBalance: true,
  visualPan: true,
  visualPanStrength: 0.75,
  bgmOffset: 0,
};

export interface BeatSettings {
  sourceAssetId: string | null;
  targetDuration: number;
  density: BeatDensity;
  slowmo: number;
  leadIn: number;
  effectScale: number;
  musicStart: number;
  scanHighlights: boolean;
}

export const DEFAULT_BEAT_SETTINGS: BeatSettings = {
  sourceAssetId: null,
  targetDuration: 30,
  density: "auto",
  slowmo: 0.7,
  leadIn: 0.55,
  effectScale: 1,
  musicStart: 0,
  scanHighlights: true,
};

export interface AudioClip {
  id: string;
  index: number;
  assetId: string;
  start: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
}

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  url: string;
  file?: File;
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
  origin: "reference" | "user";
  thumbnailUrl?: string;
  sourceIn?: number;
  sourceOut?: number;
  fileId?: string;
  groupName?: string;
  colorStats?: ColorStats;
  motionStats?: MotionStats;
  compositionStats?: CompositionStats;
  sourceTag?: string;
  tags?: ShotTags;
}

export interface Shot {
  id: string;
  index: number;
  start: number;
  end: number;
  duration: number;
  thumbnailUrl: string;
  diff: number;
  tags: string[];
  colorStats?: ColorStats;
  motionStats?: MotionStats;
  compositionStats?: CompositionStats;
}

export interface AnalysisResult {
  duration: number;
  analyzedDuration: number;
  width: number;
  height: number;
  sampleFps: number;
  cuts: number[];
  shots: Shot[];
  bpm?: number;
  beatAlignment?: number;
  styleTags: string[];
}

export interface Slot {
  id: string;
  index: number;
  shotId: string;
  label: string;
  start: number;
  end: number;
  duration: number;
  thumbnailUrl: string;
  assetId: string;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  volume?: number;
  locked?: boolean;
  effectTags: string[];
  targetColor?: ColorStats;
  colorGrade?: ColorGrade;
  targetMotion?: MotionStats;
  targetComposition?: CompositionStats;
  mirrorX?: boolean;
  composition?: CompositionAdjust;
  effects?: SlotEffects;
  effectScale?: number;
}

export type AnalysisEvent =
  | { type: "stage"; stage: string; label: string; progress: number }
  | { type: "frame"; timestamp: number; thumbnail: string; diff: number; progress: number }
  | { type: "cut"; timestamp: number; progress: number }
  | { type: "refine"; timestamp: number; progress: number }
  | { type: "bpm"; bpm: number; progress: number }
  | { type: "done"; result: AnalysisResult }
  | { type: "error"; message: string };
