import { create } from "zustand";
import type { BeatGrid } from "@/lib/cpv/beat-grid";
import {
  appendClip,
  duplicateClip,
  normalizeClips,
  splitClipAt,
} from "@/lib/cpv/audio-track";
import { buildColorGrade } from "@/lib/cpv/color-match";
import { buildDemoPack } from "@/lib/cpv/demo";
import { buildCompositionAdjust } from "@/lib/cpv/composition";
import { shouldMirrorX } from "@/lib/cpv/motion";
import type { DraftReport } from "@/lib/cpv/plan-quality";
import type { ShotTags } from "@/lib/cpv/types";
import { fitAssetToSlot } from "@/lib/cpv/timing";
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_BEAT_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  type AnalysisResult,
  type AudioClip,
  type AudioSettings,
  type BeatSettings,
  type CPVStep,
  type EditKind,
  type EditorMode,
  type MatchSettings,
  type MediaAsset,
  type Slot,
} from "@/lib/cpv/types";

interface CPVState {
  step: CPVStep;
  reference: MediaAsset | null;
  analysis: AnalysisResult | null;
  assets: MediaAsset[];
  slots: Slot[];
  bgm: MediaAsset | null;
  audioClips: AudioClip[];
  mode: EditorMode;
  editKind: EditKind;
  beatSettings: BeatSettings;
  beatGrid: BeatGrid | null;
  draftReport: DraftReport | null;
  styleTarget: ShotTags | null;
  selectedSlotId: string | null;
  analyzeDuration: number;
  matchSettings: MatchSettings;
  audioSettings: AudioSettings;

  setStep: (step: CPVStep) => void;
  setReference: (asset: MediaAsset) => void;
  loadDemo: () => Promise<void>;
  setAnalysis: (result: AnalysisResult) => void;
  addAsset: (asset: MediaAsset) => void;
  updateAsset: (assetId: string, patch: Partial<MediaAsset>) => void;
  replaceSlot: (slotId: string, asset: MediaAsset) => void;
  updateSlot: (slotId: string, patch: Partial<Slot>) => void;
  restoreSlot: (slotId: string) => void;
  selectSlot: (slotId: string | null) => void;
  setBgm: (asset: MediaAsset | null) => void;
  setAudioClips: (clips: AudioClip[]) => void;
  addAudioClip: (asset: MediaAsset, timelineDuration: number, beatInterval?: number) => boolean;
  updateAudioClip: (id: string, patch: Partial<AudioClip>) => void;
  removeAudioClip: (id: string) => void;
  duplicateAudioClip: (id: string) => void;
  splitAudioClipAt: (time: number) => void;
  clearAudioClips: () => void;
  setMode: (mode: EditorMode) => void;
  setEditKind: (kind: EditKind) => void;
  setBeatSettings: (patch: Partial<BeatSettings>) => void;
  setBeatGrid: (grid: BeatGrid | null) => void;
  setDraftReport: (report: DraftReport | null) => void;
  setStyleTarget: (tags: ShotTags | null) => void;
  setAnalyzeDuration: (seconds: number) => void;
  setMatchSettings: (patch: Partial<MatchSettings>) => void;
  setAudioSettings: (patch: Partial<AudioSettings>) => void;
  reset: () => void;
}

const initial = {
  step: "home" as CPVStep,
  reference: null,
  analysis: null,
  assets: [],
  slots: [],
  bgm: null,
  audioClips: [],
  mode: "simple" as EditorMode,
  editKind: "style" as EditKind,
  beatSettings: { ...DEFAULT_BEAT_SETTINGS },
  beatGrid: null,
  draftReport: null,
  styleTarget: null,
  selectedSlotId: null,
  analyzeDuration: 0,
  matchSettings: { ...DEFAULT_MATCH_SETTINGS },
  audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
};

export const useCPVStore = create<CPVState>((set, get) => ({
  ...initial,

  setStep: (step) => set({ step }),

  setReference: (asset) =>
    set({
      reference: asset,
      step: "analyzing",
      assets: [asset],
      analysis: null,
      slots: [],
      selectedSlotId: null,
    }),
  loadDemo: async () => {
    const { reference, assets } = await buildDemoPack();
    set({
      ...initial,
      reference,
      step: "analyzing",
      assets: [reference, ...assets],
    });
  },
  setAnalysis: (result) => {
    const { reference } = get();
    const referenceId = reference?.id ?? "reference";
    const slots: Slot[] = result.shots.map((shot) => ({
      id: `slot_${shot.index}`,
      index: shot.index,
      shotId: shot.id,
      label: `镜头 ${String(shot.index + 1).padStart(2, "0")}`,
      start: shot.start,
      end: shot.end,
      duration: shot.duration,
      thumbnailUrl: shot.thumbnailUrl,
      assetId: referenceId,
      sourceIn: shot.start,
      sourceOut: shot.end,
      speed: 1,
      volume: 1,
      effectTags: shot.tags,
      targetColor: shot.colorStats,
      targetMotion: shot.motionStats,
      targetComposition: shot.compositionStats,
    }));
    set({
      analysis: result,
      slots,
      selectedSlotId: slots[0]?.id ?? null,
      step: "dna",
      editKind: "style",
      beatGrid: null,
      draftReport: null,
  styleTarget: null,
    });
  },

  addAsset: (asset) =>
    set((state) => ({
      assets: state.assets.some((item) => item.id === asset.id)
        ? state.assets
        : [...state.assets, asset],
    })),

  updateAsset: (assetId, patch) =>
    set((state) => ({
      assets: state.assets.map((asset) =>
        asset.id === assetId ? { ...asset, ...patch } : asset,
      ),
    })),

  replaceSlot: (slotId, asset) =>
    set((state) => ({
      slots: state.slots.map((slot) => {
        if (slot.id !== slotId) return slot;
        const fitted = fitAssetToSlot(asset, slot.duration);
        const colorGrade =
          asset.colorStats && slot.targetColor
            ? buildColorGrade(asset.colorStats, slot.targetColor)
            : undefined;
        return {
          ...slot,
          assetId: asset.id,
          ...fitted,
          volume: 1,
          thumbnailUrl: asset.thumbnailUrl || slot.thumbnailUrl,
          colorGrade,
          mirrorX: shouldMirrorX(slot.targetMotion, asset.motionStats),
          composition: buildCompositionAdjust(
            asset.compositionStats,
            slot.targetComposition,
          ),
        };
      }),
    })),

  updateSlot: (slotId, patch) =>
    set((state) => ({
      slots: state.slots.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot)),
    })),

  restoreSlot: (slotId) =>
    set((state) => {
      const reference = state.reference;
      if (!reference) return state;
      return {
        slots: state.slots.map((slot) => {
          if (slot.id !== slotId) return slot;
          const shot = state.analysis?.shots.find((item) => item.id === slot.shotId);
          return {
            ...slot,
            assetId: reference.id,
            sourceIn: slot.start,
            sourceOut: slot.end,
            speed: 1,
            volume: 1,
            thumbnailUrl: shot?.thumbnailUrl || slot.thumbnailUrl,
            colorGrade: undefined,
            mirrorX: undefined,
            composition: undefined,
          };
        }),
      };
    }),

  selectSlot: (selectedSlotId) => set({ selectedSlotId }),

  setBgm: (bgm) => set({ bgm }),

  setAudioClips: (clips) => set({ audioClips: normalizeClips(clips) }),

  addAudioClip: (asset, timelineDuration, beatInterval = 0) => {
    const { audioClips } = get();
    const clip = appendClip(audioClips, asset, timelineDuration, beatInterval);
    if (!clip) return false;
    set({ audioClips: normalizeClips([...audioClips, clip]) });
    return true;
  },

  updateAudioClip: (id, patch) =>
    set((state) => ({
      audioClips: normalizeClips(
        state.audioClips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)),
      ),
    })),

  removeAudioClip: (id) =>
    set((state) => ({
      audioClips: normalizeClips(state.audioClips.filter((clip) => clip.id !== id)),
    })),

  duplicateAudioClip: (id) =>
    set((state) => ({ audioClips: duplicateClip(state.audioClips, id) })),

  splitAudioClipAt: (time) =>
    set((state) => ({ audioClips: splitClipAt(state.audioClips, time) })),

  clearAudioClips: () => set({ audioClips: [] }),

  setMode: (mode) => set({ mode }),

  setEditKind: (editKind) => set({ editKind }),

  setBeatSettings: (patch) =>
    set((state) => ({ beatSettings: { ...state.beatSettings, ...patch } })),

  setBeatGrid: (beatGrid) => set({ beatGrid }),

  setDraftReport: (draftReport) => set({ draftReport }),

  setStyleTarget: (styleTarget) => set({ styleTarget }),

  setAnalyzeDuration: (analyzeDuration) => set({ analyzeDuration }),

  setMatchSettings: (patch) =>
    set((state) => ({ matchSettings: { ...state.matchSettings, ...patch } })),

  setAudioSettings: (patch) =>
    set((state) => ({ audioSettings: { ...state.audioSettings, ...patch } })),

  reset: () =>
    set({
      ...initial,
      beatSettings: { ...DEFAULT_BEAT_SETTINGS },
      matchSettings: { ...DEFAULT_MATCH_SETTINGS },
      audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
    }),
}));
