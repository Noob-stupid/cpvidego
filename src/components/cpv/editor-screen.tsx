"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiArrowLeftLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiDownloadLine,
  RiFilmLine,
  RiFolderLine,
  RiFullscreenLine,
  RiImageLine,
  RiLayoutGridLine,
  RiListOrdered,
  RiMagicLine,
  RiMusic2Line,
  RiPauseFill,
  RiPlayFill,
  RiRestartLine,
  RiScissorsCutLine,
  RiUploadLine,
} from "@remixicon/react";
import { Brand } from "@/components/cpv/brand";
import { DraftPanel } from "@/components/cpv/draft-panel";
import { RgbFilterDefs } from "@/components/cpv/rgb-filter-defs";
import { SwipePreview } from "@/components/cpv/swipe-preview";
import { analyzeReference } from "@/lib/cpv/analyze";
import { clipVolumeAt } from "@/lib/cpv/audio-track";
import { buildAssetFromFile } from "@/lib/cpv/asset-build";
import { AudioTrackPanel } from "@/components/cpv/audio-track-panel";
import { analyzeMixLevels, type MixReport } from "@/lib/cpv/audio-mix";
import { computePanCurve, panAt, type PanCurve } from "@/lib/cpv/audio-pan";
import { buildColorGrade, colorFilter, scaleColorGrade, warmthTint } from "@/lib/cpv/color-match";
import {
  buildCompositionAdjust,
  composeTransform,
  scaleCompositionAdjust,
} from "@/lib/cpv/composition";
import {
  computeEffectFrame,
  effectCount,
  effectLabels,
  EFFECT_LABELS,
  EFFECT_ORDER,
  joinFilters,
  scaleEffects,
} from "@/lib/cpv/effects";
import { readImageMatchStats } from "@/lib/cpv/image-stats";
import {
  formatDurationLabel,
  formatTime,
  isVideoFile,
  mediaSizeError,
} from "@/lib/cpv/media";
import { shouldMirrorX } from "@/lib/cpv/motion";
import { downloadBlob, renderTimelineToMp4 } from "@/lib/cpv/render-remotion";
import { fitAssetToSlot, sourceSpeedForSlot } from "@/lib/cpv/timing";
import type { AudioBed, EffectKind, MediaAsset, Slot, SlotEffects } from "@/lib/cpv/types";
import { useCPVStore } from "@/stores/cpv-store";
import { useLibraryStore } from "@/stores/library-store";
import { generateUUID } from "@/utils/id";
import { cn } from "@/lib/utils";

const SPEEDS = [0.5, 1, 1.5, 2];

const round2 = (value: number) => Math.round(value * 100) / 100;

export function EditorScreen() {
  const reference = useCPVStore((s) => s.reference);
  const analysis = useCPVStore((s) => s.analysis);
  const assets = useCPVStore((s) => s.assets);
  const slots = useCPVStore((s) => s.slots);
  const bgm = useCPVStore((s) => s.bgm);
  const audioClips = useCPVStore((s) => s.audioClips);
  const mode = useCPVStore((s) => s.mode);
  const editKind = useCPVStore((s) => s.editKind);
  const selectedSlotId = useCPVStore((s) => s.selectedSlotId);
  const matchSettings = useCPVStore((s) => s.matchSettings);
  const audioSettings = useCPVStore((s) => s.audioSettings);
  const setMode = useCPVStore((s) => s.setMode);
  const selectSlot = useCPVStore((s) => s.selectSlot);
  const replaceSlot = useCPVStore((s) => s.replaceSlot);
  const updateSlot = useCPVStore((s) => s.updateSlot);
  const setMatchSettings = useCPVStore((s) => s.setMatchSettings);
  const setAudioSettings = useCPVStore((s) => s.setAudioSettings);
  const restoreSlot = useCPVStore((s) => s.restoreSlot);
  const addAsset = useCPVStore((s) => s.addAsset);
  const setBgm = useCPVStore((s) => s.setBgm);
  const setStep = useCPVStore((s) => s.setStep);
  const saveCurrentProject = useLibraryStore((s) => s.saveCurrentProject);
  const refreshProjects = useLibraryStore((s) => s.refreshProjects);
  const storageWarning = useLibraryStore((s) => s.storageWarning);
  const bedAsset =
    audioSettings.bed === "reference" ? reference : audioSettings.bed === "bgm" ? bgm : null;
  const bedSrc = bedAsset?.url;

  const [swipeOpen, setSwipeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [relativeTime, setRelativeTime] = useState(0);
  const [bounceSlot, setBounceSlot] = useState<string | null>(null);
  const [flipSlot, setFlipSlot] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [splitPct, setSplitPct] = useState(62);
  const [expanded, setExpanded] = useState(false);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [sequenceActive, setSequenceActive] = useState(false);
  const [sequenceIndex, setSequenceIndex] = useState(0);
  const [pendingSequenceStart, setPendingSequenceStart] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBlobUrl, setExportBlobUrl] = useState<string | null>(null);
  const [assetPreview, setAssetPreview] = useState<MediaAsset | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [activeGroup, setActiveGroup] = useState("all");
  const [openSlotGroups, setOpenSlotGroups] = useState<Record<string, boolean>>({});
  const [openLibrarySections, setOpenLibrarySections] = useState<Record<string, boolean>>({});
  const [bgmPan, setBgmPan] = useState<PanCurve | null>(null);
  const [mixReport, setMixReport] = useState<MixReport | null>(null);
  const [mixAnalyzing, setMixAnalyzing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const slotInputRef = useRef<HTMLInputElement>(null);
  const bgmInputRef = useRef<HTMLInputElement>(null);
  const poolInputRef = useRef<HTMLInputElement>(null);
  const extractInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgmAudioRef = useRef<HTMLAudioElement>(null);
  const audioClipRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const effectLayerRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const scanlineRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Record<string, HTMLElement | null>>({});
  const extractControllerRef = useRef<AbortController | null>(null);
  const rangeRef = useRef<{
    start: number;
    end: number;
    loops: number;
    count: number;
  } | null>(null);
  const sequenceRef = useRef<{ active: boolean; index: number }>({ active: false, index: 0 });
  const sequenceSlotRef = useRef<Slot | null>(null);
  const sequenceSettledRef = useRef(true);
  const pendingPlayRef = useRef<{
    start: number;
    end: number;
    loops: number;
    speed: number;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const slotsRef = useRef<Slot[]>(slots);
  const historyRef = useRef<Slot[][]>([]);
  const futureRef = useRef<Slot[][]>([]);
  const historyBaseRef = useRef<Slot[] | null>(null);
  const historyTimerRef = useRef<number | null>(null);
  const historySkipRef = useRef(false);

  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedAsset = selectedSlot
    ? assets.find((asset) => asset.id === selectedSlot.assetId) ?? null
    : null;
  const previewUrl = selectedAsset?.url ?? reference?.url ?? null;
  const isReferenceSlot = selectedSlot?.assetId === reference?.id;
  const isImageSlot = selectedAsset?.kind === "image";
  const selectedColorGrade =
    matchSettings.color && selectedSlot?.colorGrade && !isReferenceSlot
      ? scaleColorGrade(selectedSlot.colorGrade, matchSettings.strength)
      : null;
  const selectedFilter = selectedColorGrade ? colorFilter(selectedColorGrade) : undefined;
  const selectedTint = selectedColorGrade ? warmthTint(selectedColorGrade) : null;
  const selectedTransform =
    selectedSlot && !isReferenceSlot
      ? composeTransform(
          Boolean(matchSettings.motion && selectedSlot.mirrorX),
          matchSettings.composition && selectedSlot.composition
            ? scaleCompositionAdjust(selectedSlot.composition, matchSettings.strength)
            : undefined,
        )
      : undefined;
  const userAssets = useMemo(
    () => assets.filter((asset) => asset.origin === "user" && asset.kind !== "audio"),
    [assets],
  );
  const groupedAssets = useMemo(() => {
    const groups = new Map<string, MediaAsset[]>();
    for (const asset of userAssets) {
      const key = asset.groupName || "未分组";
      const list = groups.get(key) ?? [];
      list.push(asset);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .map(([name, items]) => ({ name, items }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [userAssets]);
  const slotGroups = useMemo(() => groupSlotsByTime(slots, 5), [slots]);
  const materialSections = useMemo(() => {
    if (activeGroup === "all") {
      return groupedAssets.map((group) => ({
        key: `source:${group.name}`,
        label: group.name,
        hint: `${group.items.length} 个素材`,
        items: group.items,
      }));
    }
    const group = groupedAssets.find((item) => item.name === activeGroup);
    return groupAssetsByTime(group?.items ?? [], 10).map((section) => ({
      key: `time:${section.start}`,
      label: `${formatTime(section.start)}–${formatTime(section.end)}`,
      hint: `${section.items.length} 个镜头`,
      items: section.items,
    }));
  }, [activeGroup, groupedAssets]);
  const audioSlotKey = useMemo(
    () =>
      slots
        .map(
          (slot) =>
            `${slot.assetId}:${slot.sourceIn.toFixed(2)}:${slot.sourceOut.toFixed(2)}:${
              slot.volume ?? 1
            }`,
        )
        .join("|"),
    [slots],
  );

  function flash(message: string) {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  }

  function bgmStartAt(seconds: number) {
    const audio = bgmAudioRef.current;
    if (!audio || !bedSrc) return;
    const state = useCPVStore.getState();
    const offset =
      state.audioSettings.bed === "bgm"
        ? state.editKind === "beat"
          ? state.beatSettings.musicStart
          : state.audioSettings.bgmOffset
        : 0;
    audio.volume = audioSettings.bgmVolume;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const wrapped =
      duration > 0
        ? ((Math.max(0, seconds + offset) % duration) + duration) % duration
        : Math.max(0, seconds + offset);
    const target = duration > 0 ? Math.min(wrapped, Math.max(0, duration - 0.05)) : wrapped;
    try {
      audio.currentTime = target;
    } catch {
      // Metadata may not be ready yet; loadedmetadata retries.
    }
    void audio.play().catch(() => undefined);
  }

  function bgmPause() {
    bgmAudioRef.current?.pause();
  }

  function applyPreviewEffects() {
    const layer = effectLayerRef.current;
    if (!layer) return;
    const state = useCPVStore.getState();
    const slot = state.slots.find((item) => item.id === state.selectedSlotId);
    if (!slot) {
      layer.style.transform = "none";
      layer.style.filter = "none";
      if (flashRef.current) flashRef.current.style.opacity = "0";
      if (scanlineRef.current) scanlineRef.current.style.opacity = "0";
      return;
    }
    const asset = state.assets.find((item) => item.id === slot.assetId);
    const isImage = asset?.kind === "image";
    const video = videoRef.current;
    const outputTime =
      !isImage && video
        ? Math.max(
            0,
            Math.min(
              slot.duration,
              (video.currentTime - slot.sourceIn) / Math.max(0.0625, slot.speed),
            ),
          )
        : slot.duration * 0.5;
    const progress = slot.duration > 0 ? outputTime / slot.duration : 0;
    const audio = bgmAudioRef.current;
    const audioTime =
      audio && !audio.paused && Number.isFinite(audio.currentTime)
        ? audio.currentTime
        : slot.start +
          outputTime +
          (state.editKind === "beat" ? state.beatSettings.musicStart : 0);
    const audioPan =
      state.audioSettings.visualPan && bgmPan ? panAt(bgmPan, audioTime) : 0;
    const effect = computeEffectFrame(
      scaleEffects(slot.effects, slot.effectScale ?? 1),
      isImage ? 0.5 : progress,
      outputTime,
      slot.index,
      audioPan,
      state.audioSettings.visualPanStrength,
    );
    const colorGrade =
      state.matchSettings.color && slot.colorGrade && slot.assetId !== state.reference?.id
        ? scaleColorGrade(slot.colorGrade, state.matchSettings.strength)
        : null;
    layer.style.transform = effect.transform;
    layer.style.filter = joinFilters(colorGrade ? colorFilter(colorGrade) : undefined, effect.filter) || "none";
    if (flashRef.current) flashRef.current.style.opacity = String(effect.flashOpacity);
    if (scanlineRef.current) scanlineRef.current.style.opacity = String(effect.scanlineOpacity);
    tickAudioTrack(slot.start + outputTime, isPlaying);
  }

  /** 音乐轨预览：按输出时间同步每个音频段（循环/变速/淡变与导出口径一致）。 */
  function tickAudioTrack(outputTime: number, playing: boolean) {
    const state = useCPVStore.getState();
    const clips = state.audioClips;
    if (!clips.length) return;
    for (const clip of clips) {
      const element = audioClipRefs.current[clip.id];
      if (!element) continue;
      const local = outputTime - clip.start;
      if (!playing || local < 0 || local >= clip.duration) {
        if (!element.paused) element.pause();
        continue;
      }
      const sourceLength = Math.max(0.05, clip.sourceOut - clip.sourceIn);
      const raw = local * (clip.loop ? 1 : clip.speed);
      const within = clip.loop
        ? ((raw % sourceLength) + sourceLength) % sourceLength
        : Math.min(raw, sourceLength);
      const target = clip.sourceIn + within;
      if (Math.abs(element.currentTime - target) > 0.35) {
        try {
          element.currentTime = target;
        } catch {
          // Metadata 未就绪时忽略，下一帧重试。
        }
      }
      element.volume = clipVolumeAt(clip, local);
      if (element.paused) void element.play().catch(() => undefined);
    }
  }

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      applyPreviewEffects();
      if (isPlaying) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    isPlaying,
    selectedSlotId,
    selectedSlot?.effects,
    selectedSlot?.speed,
    selectedSlot?.sourceIn,
    selectedSlot?.effectScale,
    matchSettings.color,
    matchSettings.strength,
    bgmPan,
    audioSettings.visualPan,
    audioSettings.visualPanStrength,
  ]);

  useEffect(() => {
    if (bgmAudioRef.current) bgmAudioRef.current.volume = audioSettings.bgmVolume;
  }, [audioSettings.bgmVolume, bgm]);

  useEffect(() => {
    if (videoRef.current && selectedSlot) {
      videoRef.current.volume =
        (selectedSlot.volume ?? 1) * audioSettings.originalVolume;
    }
  }, [bgm, audioSettings.originalVolume, selectedSlot?.volume, selectedSlotId]);

  useEffect(() => {
    let cancelled = false;
    setBgmPan(null);
    const file = bedAsset?.file;
    if (!file) return;
    void computePanCurve(file).then((curve) => {
      if (!cancelled) setBgmPan(curve);
    });
    return () => {
      cancelled = true;
    };
  }, [bedAsset?.url, bedAsset?.file]);

  useEffect(() => {
    if (!bedAsset || audioSettings.bed === "none" || !audioSettings.autoBalance) {
      setMixReport(null);
      setMixAnalyzing(false);
      return;
    }
    let cancelled = false;
    setMixAnalyzing(true);
    void analyzeMixLevels(slots, assets, bedAsset, audioSettings.originalVolume)
      .then((report) => {
        if (cancelled) return;
        setMixAnalyzing(false);
        setMixReport(report);
        if (report) setAudioSettings({ bgmVolume: report.suggestedBgmVolume });
      })
      .catch(() => {
        if (!cancelled) setMixAnalyzing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bedAsset?.url, audioSlotKey, audioSettings.bed, audioSettings.autoBalance, audioSettings.originalVolume]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
      extractControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!reference) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveCurrentProject();
    }, 900);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [slots, assets, bgm, reference, matchSettings, audioSettings, saveCurrentProject]);

  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    const resolveStats = async () => {
      const state = useCPVStore.getState();
      const shots = state.analysis?.shots ?? [];
      const assetPatches = new Map<string, Partial<MediaAsset>>();
      const slotPatches = new Map<string, Partial<Slot> & { assetId: string }>();
      const imageStatsCache = new Map<string, ReturnType<typeof readImageMatchStats>>();
      const readStats = (url?: string) => {
        if (!url) return Promise.resolve(null);
        if (!imageStatsCache.has(url)) imageStatsCache.set(url, readImageMatchStats(url));
        return imageStatsCache.get(url) ?? Promise.resolve(null);
      };

      for (const slot of state.slots) {
        if (slot.assetId === state.reference?.id) continue;
        const asset = state.assets.find((item) => item.id === slot.assetId);
        if (!asset) continue;
        const shot = shots.find((item) => item.id === slot.shotId);

        let assetColor = asset.colorStats;
        let assetComposition = asset.compositionStats;
        if ((!assetColor || !assetComposition) && asset.thumbnailUrl) {
          const read = await readStats(asset.thumbnailUrl);
          if (cancelled) return;
          if (read) {
            assetColor = assetColor ?? read.color;
            assetComposition = assetComposition ?? read.composition;
            assetPatches.set(asset.id, {
              colorStats: assetColor,
              compositionStats: assetComposition,
            });
          }
        }

        let targetColor = slot.targetColor ?? shot?.colorStats;
        let targetComposition = slot.targetComposition ?? shot?.compositionStats;
        if ((!targetColor || !targetComposition) && shot?.thumbnailUrl) {
          const read = await readStats(shot.thumbnailUrl);
          if (cancelled) return;
          if (read) {
            targetColor = targetColor ?? read.color;
            targetComposition = targetComposition ?? read.composition;
          }
        }

        const patch: Partial<Slot> & { assetId: string } = { assetId: asset.id };
        if (!slot.colorGrade && assetColor && targetColor) {
          patch.colorGrade = buildColorGrade(assetColor, targetColor);
        }
        if (!slot.composition && assetComposition && targetComposition) {
          patch.composition = buildCompositionAdjust(assetComposition, targetComposition);
        }
        if (slot.mirrorX === undefined && slot.targetMotion && asset.motionStats) {
          patch.mirrorX = shouldMirrorX(slot.targetMotion, asset.motionStats);
        }
        if (!slot.targetColor && targetColor) patch.targetColor = targetColor;
        if (!slot.targetComposition && targetComposition) {
          patch.targetComposition = targetComposition;
        }
        if (asset.kind !== "image") {
          const expectedSpeed = sourceSpeedForSlot(
            slot.sourceIn,
            slot.sourceOut,
            slot.duration,
          );
          if (Math.abs((slot.speed ?? 1) - expectedSpeed) > 0.004) {
            patch.speed = expectedSpeed;
          }
        }
        if (Object.keys(patch).length > 1) slotPatches.set(slot.id, patch);
      }

      if (!cancelled && (assetPatches.size || slotPatches.size)) {
        useCPVStore.setState((current) => ({
          assets: current.assets.map((asset) => {
            const patch = assetPatches.get(asset.id);
            return patch ? { ...asset, ...patch } : asset;
          }),
          slots: current.slots.map((slot) => {
            const patch = slotPatches.get(slot.id);
            if (!patch || slot.assetId !== patch.assetId) return slot;
            return {
              ...slot,
              colorGrade: slot.colorGrade ?? patch.colorGrade,
              composition: slot.composition ?? patch.composition,
              mirrorX: slot.mirrorX ?? patch.mirrorX,
              targetColor: slot.targetColor ?? patch.targetColor,
              targetComposition: slot.targetComposition ?? patch.targetComposition,
              speed: patch.speed ?? slot.speed,
            };
          }),
        }));
      }
    };
    void resolveStats();
    return () => {
      cancelled = true;
    };
  }, [reference?.url, analysis]);

  useEffect(() => {
    if (slotsRef.current === slots) return;
    if (historySkipRef.current) {
      historySkipRef.current = false;
      slotsRef.current = slots;
      return;
    }
    if (!historyBaseRef.current) historyBaseRef.current = slotsRef.current;
    slotsRef.current = slots;
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = window.setTimeout(() => {
      if (historyBaseRef.current) {
        historyRef.current.push(historyBaseRef.current);
        if (historyRef.current.length > 60) historyRef.current.shift();
        futureRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
      }
      historyBaseRef.current = null;
      historyTimerRef.current = null;
    }, 500);
  }, [slots]);

  useEffect(() => {
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = null;
    historyBaseRef.current = null;
    historyRef.current = [];
    futureRef.current = [];
    slotsRef.current = useCPVStore.getState().slots;
    setCanUndo(false);
    setCanRedo(false);
  }, [reference?.url]);

  useEffect(() => {
    if (expanded) return;
    slotRefs.current[selectedSlotId ?? ""]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedSlotId, expanded]);

  useEffect(() => {
    if (!selectedSlot) return;
    const group = slotGroups.find((item) => item.slots.some((slot) => slot.id === selectedSlot.id));
    if (!group) return;
    setOpenSlotGroups((current) =>
      current[group.key] ? current : { ...current, [group.key]: true },
    );
  }, [selectedSlotId, slotGroups, selectedSlot]);

  useEffect(() => {
    setOpenLibrarySections({});
  }, [activeGroup]);

  useEffect(() => {
    if (!pendingSequenceStart || !slots.length) return;
    setPendingSequenceStart(false);
    startSequence(0);
  }, [pendingSequenceStart, slots]);

  function stopSequence() {
    sequenceRef.current = { active: false, index: 0 };
    sequenceSlotRef.current = null;
    sequenceSettledRef.current = true;
    setSequenceActive(false);
    setSequenceIndex(0);
    rangeRef.current = null;
    bgmPause();
    for (const element of Object.values(audioClipRefs.current)) {
      if (element && !element.paused) element.pause();
    }
    videoRef.current?.pause();
  }

  function selectSlotManually(slotId: string) {
    if (sequenceRef.current.active) stopSequence();
    selectSlot(slotId);
  }

  function startSequence(startIndex = 0) {
    if (!slots.length) return;
    const slot = slots[startIndex];
    if (!slot) return;
    sequenceRef.current = { active: true, index: startIndex };
    sequenceSlotRef.current = slot;
    sequenceSettledRef.current = false;
    setSequenceActive(true);
    setSequenceIndex(startIndex);
    bgmStartAt(slot.start);
    pendingPlayRef.current = {
      start: slot.sourceIn,
      end: slot.sourceOut,
      loops: 1,
      speed: slot.speed,
    };
    if (selectedSlot?.id === slot.id && videoRef.current && videoRef.current.readyState >= 1) {
      pendingPlayRef.current = null;
      playRange(slot.sourceIn, slot.sourceOut, 1, slot.speed);
    } else {
      selectSlot(slot.id);
    }
  }

  function replaceAllWithMaterials() {
    if (!userAssets.length) {
      flash("先上传或从视频提取素材");
      return;
    }
    const usableAssets = userAssets.filter(
      (asset) =>
        asset.kind !== "video" ||
        !asset.colorStats ||
        (asset.colorStats.luma >= 12 &&
          !(asset.colorStats.luma > 242 && asset.colorStats.saturation < 0.04)),
    );
    const pool = usableAssets.length ? usableAssets : userAssets;
    const scored = pool.filter((asset) => asset.colorStats);
    const usage = new Map<string, number>();
    const nextSlots = slots.map((slot, index) => {
      let asset = pool[index % pool.length];
      if (slot.targetColor && scored.length) {
        let bestScore = Number.POSITIVE_INFINITY;
        let bestAsset = asset;
        for (const candidate of scored) {
          const stats = candidate.colorStats;
          if (!stats) continue;
          const lumaDistance = Math.abs(stats.luma - slot.targetColor.luma) / 255;
          const saturationDistance = Math.abs(
            stats.saturation - slot.targetColor.saturation,
          );
          const contrastDistance = Math.abs(stats.contrast - slot.targetColor.contrast) / 80;
          const usagePenalty = (usage.get(candidate.id) ?? 0) * 0.12;
          const score =
            lumaDistance * 0.6 +
            saturationDistance * 0.25 +
            contrastDistance * 0.15 +
            usagePenalty;
          if (score < bestScore) {
            bestScore = score;
            bestAsset = candidate;
          }
        }
        asset = bestAsset;
      }
      usage.set(asset.id, (usage.get(asset.id) ?? 0) + 1);
      const fitted = fitAssetToSlot(asset, slot.duration);
      return {
        ...slot,
        assetId: asset.id,
        ...fitted,
        volume: 1,
        thumbnailUrl: asset.thumbnailUrl || slot.thumbnailUrl,
        colorGrade:
          asset.colorStats && slot.targetColor
            ? buildColorGrade(asset.colorStats, slot.targetColor)
            : undefined,
        mirrorX: shouldMirrorX(slot.targetMotion, asset.motionStats),
        composition: buildCompositionAdjust(asset.compositionStats, slot.targetComposition),
      };
    });
    useCPVStore.setState({
      slots: nextSlots,
      selectedSlotId: nextSlots[0]?.id ?? null,
      mode: "simple",
    });
    setActiveGroup(pool[0]?.groupName ?? "all");
    setPendingSequenceStart(true);
    const skipped = userAssets.length - pool.length;
    flash(
      skipped > 0
        ? `已替换 ${nextSlots.length} 个槽位，跳过 ${skipped} 个纯黑镜头`
        : `已用素材替换全部 ${nextSlots.length} 个槽位，开始整片播放`,
    );
  }

  async function startExport() {
    if (!reference || !analysis || exporting) return;
    setExporting(true);
    setExportProgress(0);
    setExportError(null);
    if (exportBlobUrl) {
      URL.revokeObjectURL(exportBlobUrl);
      setExportBlobUrl(null);
    }
    try {
      let exportAudioSettings = audioSettings;
      const mixBed = audioSettings.bed === "reference" ? reference : bgm;
      if (mixBed && audioSettings.bed !== "none" && audioSettings.autoBalance) {
        const report = await analyzeMixLevels(
          slots,
          assets,
          mixBed,
          audioSettings.originalVolume,
        );
        if (report) {
          exportAudioSettings = {
            ...audioSettings,
            bgmVolume: report.suggestedBgmVolume,
          };
          setAudioSettings({ bgmVolume: report.suggestedBgmVolume });
        }
      }
      const state = useCPVStore.getState();
      const blob = await renderTimelineToMp4({
        slots,
        assets,
        reference,
        bgm,
        duration: analysis.analyzedDuration,
        matchSettings,
        audioSettings: exportAudioSettings,
        bgmStartSeconds:
          audioSettings.bed === "bgm"
            ? state.editKind === "beat"
              ? state.beatSettings.musicStart
              : audioSettings.bgmOffset
            : 0,
        audioClips: state.audioClips,
        onProgress: setExportProgress,
      });
      const url = URL.createObjectURL(blob);
      setExportBlobUrl(url);
      downloadBlob(
        blob,
        `${reference.name.replace(/\.[^.]+$/, "")}-cpvidego-1080p.mp4`,
      );
      flash("1080p 成片已生成，开始下载");
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  function closeExport() {
    if (exportBlobUrl) {
      URL.revokeObjectURL(exportBlobUrl);
      setExportBlobUrl(null);
    }
    setExportError(null);
    setExportOpen(false);
  }

  useEffect(() => {
    if (!draggingSplit) return;
    const onMove = (event: PointerEvent) => {
      const rect = mainRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(94, Math.max(46, pct)));
    };
    const onUp = () => {
      setDraggingSplit(false);
      setSplitPct((current) => {
        if (current >= 91) {
          setExpanded(true);
          return 62;
        }
        return current;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [draggingSplit]);

  async function goHome() {
    await saveCurrentProject();
    await refreshProjects();
    setStep("home");
  }

  function clampZoom(value: number) {
    return Math.min(12, Math.max(1, value));
  }

  function focusSelectedTimeline() {
    if (!selectedSlot || !analysis) return;
    const duration = Math.max(0.1, analysis.analyzedDuration);
    const next = clampZoom((duration / Math.max(0.4, selectedSlot.duration)) * 0.35);
    setTimelineZoom(next);
    window.setTimeout(() => {
      const el = timelineScrollRef.current;
      if (!el) return;
      el.scrollLeft = Math.max(
        0,
        (selectedSlot.start / duration) * el.scrollWidth - el.clientWidth / 2,
      );
    }, 60);
  }

  function slotOutputDuration(slot: Slot) {
    return Math.max(0.1, slot.duration);
  }

  function playRange(start: number, end: number, loops: number, speed: number) {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < 1) {
      pendingPlayRef.current = { start, end, loops, speed };
      return;
    }
    video.pause();
    video.playbackRate = speed;
    video.currentTime = start;
    rangeRef.current = { start, end, loops, count: 0 };
    setRelativeTime(0);
    void video.play().catch(() => undefined);
    if (!sequenceRef.current.active) bgmStartAt(selectedSlot?.start ?? 0);
  }

  function playSelected(loops = 1) {
    if (!selectedSlot || isImageSlot) return;
    playRange(selectedSlot.sourceIn, selectedSlot.sourceOut, loops, selectedSlot.speed);
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video || !selectedSlot || isImageSlot) return;
    video.pause();
    video.playbackRate = selectedSlot.speed;
    video.volume = (selectedSlot.volume ?? 1) * audioSettings.originalVolume;
    video.currentTime = Math.min(
      selectedSlot.sourceIn,
      Math.max(0, (video.duration || selectedSlot.sourceIn) - 0.05),
    );
    setRelativeTime(0);
    const pending = pendingPlayRef.current;
    if (pending) {
      pendingPlayRef.current = null;
      window.setTimeout(
        () => playRange(pending.start, pending.end, pending.loops, pending.speed),
        60,
      );
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || !selectedSlot) return;
    const speed = Math.max(0.25, selectedSlot.speed);
    setRelativeTime(Math.max(0, (video.currentTime - selectedSlot.sourceIn) / speed));
    const sequence = sequenceRef.current;
    if (sequence.active) {
      const seqSlot = sequenceSlotRef.current;
      if (!seqSlot) return;
      if (pendingPlayRef.current) return;
      if (!sequenceSettledRef.current) {
        if (Math.abs(video.currentTime - seqSlot.sourceIn) > 0.15) return;
        sequenceSettledRef.current = true;
      }
      if (video.currentTime >= seqSlot.sourceOut - 0.03) {
        const next = sequence.index + 1;
        if (next < slots.length) {
          const nextSlot = slots[next];
          sequenceRef.current = { active: true, index: next };
          sequenceSlotRef.current = nextSlot;
          sequenceSettledRef.current = false;
          setSequenceIndex(next);
          pendingPlayRef.current = {
            start: nextSlot.sourceIn,
            end: nextSlot.sourceOut,
            loops: 1,
            speed: nextSlot.speed,
          };
          selectSlot(nextSlot.id);
        } else {
          sequenceRef.current = { active: false, index: 0 };
          sequenceSlotRef.current = null;
          sequenceSettledRef.current = true;
          setSequenceActive(false);
          setSequenceIndex(0);
          rangeRef.current = null;
          video.pause();
        }
      }
      return;
    }
    const range = rangeRef.current;
    if (!range) return;
    if (video.currentTime >= range.end - 0.03) {
      range.count += 1;
      if (range.count < range.loops) {
        video.currentTime = range.start;
      } else {
        rangeRef.current = null;
        video.pause();
      }
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedSlot || isImageSlot) return;
    video.pause();
    video.playbackRate = selectedSlot.speed;
    video.volume = (selectedSlot.volume ?? 1) * audioSettings.originalVolume;
    if (video.readyState >= 1) {
      const pending = pendingPlayRef.current;
      if (pending) {
        pendingPlayRef.current = null;
        playRange(pending.start, pending.end, pending.loops, pending.speed);
        return;
      }
      video.currentTime = Math.min(
        selectedSlot.sourceIn,
        Math.max(0, (video.duration || selectedSlot.sourceIn) - 0.05),
      );
      setRelativeTime(0);
    }
  }, [selectedSlotId, selectedSlot?.speed, selectedSlot?.sourceIn, selectedSlot?.volume, isImageSlot]);

  async function buildAsset(file: File): Promise<MediaAsset> {
    return buildAssetFromFile(file);
  }

  function handleReplace(slot: Slot, asset: MediaAsset) {
    selectSlot(slot.id);
    replaceSlot(slot.id, asset);
    setBounceSlot(slot.id);
    setFlipSlot(slot.id);
    window.setTimeout(() => setBounceSlot(null), 700);
    window.setTimeout(() => setFlipSlot(null), 700);
    const nextSlot = useCPVStore.getState().slots.find((item) => item.id === slot.id) ?? slot;
    pendingPlayRef.current = {
      start: nextSlot.sourceIn,
      end: nextSlot.sourceOut,
      loops: 2,
      speed: nextSlot.speed,
    };
    flash(`已替换「${slot.label}」，自动播放本段`);
  }

  function openReplace(slotId: string) {
    setReplaceTarget(slotId);
    slotInputRef.current?.click();
  }

  async function onSlotFile(file: File | undefined) {
    if (!file || !replaceTarget) return;
    const sizeError = mediaSizeError(file);
    if (sizeError) {
      flash(sizeError);
      return;
    }
    const slot = slots.find((item) => item.id === replaceTarget);
    if (!slot) return;
    const asset = await buildAsset(file);
    if (asset.kind === "audio") {
      flash("视频槽位需要视频或图片");
      return;
    }
    addAsset(asset);
    handleReplace(slot, asset);
    setReplaceTarget(null);
    if (slotInputRef.current) slotInputRef.current.value = "";
  }

  async function onPoolFiles(files: FileList | null) {
    if (!files?.length) return;
    let added = 0;
    for (const file of Array.from(files)) {
      const sizeError = mediaSizeError(file);
      if (sizeError) {
        flash(sizeError);
        continue;
      }
      const asset = await buildAsset(file);
      addAsset(asset);
      if (asset.kind === "audio" && !bgm) setBgm(asset);
      added += 1;
    }
    if (added) flash(`已加入 ${added} 个素材`);
    if (poolInputRef.current) poolInputRef.current.value = "";
  }

  async function onExtractFile(file: File | undefined) {
    if (!file) return;
    if (!isVideoFile(file)) {
      flash("请选择视频文件");
      return;
    }
    const sizeError = mediaSizeError(file);
    if (sizeError) {
      flash(sizeError);
      return;
    }
    setExtracting(true);
    setExtractProgress(0);
    const controller = new AbortController();
    extractControllerRef.current = controller;
    const url = URL.createObjectURL(file);
    try {
      const result = await analyzeReference(
        file,
        { sampleFps: 6, skipAudio: true },
        (event) => {
          if (event.type === "frame" || event.type === "cut") {
            setExtractProgress(event.progress);
          }
          if (event.type === "done") setExtractProgress(0.98);
        },
        controller.signal,
      );
      const base = file.name.replace(/\.[^.]+$/, "");
      const sharedFileId = generateUUID();
      const created = result.shots.map((shot, index) => ({
        id: generateUUID(),
        kind: "video" as const,
        name: `${base} · 镜头 ${String(index + 1).padStart(2, "0")}`,
        url,
        file,
        fileId: sharedFileId,
        groupName: base,
        duration: result.duration,
        width: result.width,
        height: result.height,
        size: file.size,
        origin: "user" as const,
        thumbnailUrl: shot.thumbnailUrl,
        sourceIn: shot.start,
        sourceOut: shot.end,
        colorStats: shot.colorStats,
        motionStats: shot.motionStats,
        compositionStats: shot.compositionStats,
      }));
      created.forEach(addAsset);
      setActiveGroup(base);
      setLibraryOpen(true);
      flash(`从视频提取了 ${created.length} 个镜头`);
      setExtractProgress(1);
    } catch (error) {
      if (!controller.signal.aborted) flash("提取失败，请换一个视频");
    } finally {
      setExtracting(false);
      extractControllerRef.current = null;
      if (extractInputRef.current) extractInputRef.current.value = "";
    }
  }

  async function onBgmFile(file: File | undefined) {
    if (!file) return;
    const sizeError = mediaSizeError(file);
    if (sizeError) {
      flash(sizeError);
      return;
    }
    const asset = await buildAsset(file);
    setBgm(asset);
    flash("音乐槽已替换");
    if (bgmInputRef.current) bgmInputRef.current.value = "";
  }

  function onDropAsset(event: React.DragEvent, slot: Slot) {
    event.preventDefault();
    const assetId = event.dataTransfer.getData("application/x-cpv-asset");
    const asset = userAssets.find((item) => item.id === assetId);
    if (!asset) return;
    handleReplace(slot, asset);
  }

  function changeSpeed(value: number) {
    if (!selectedSlot || isImageSlot) return;
    const limit = isReferenceSlot
      ? analysis?.analyzedDuration ?? selectedSlot.sourceOut
      : selectedAsset?.duration ?? analysis?.analyzedDuration ?? selectedSlot.sourceOut;
    const nextOut = Math.min(limit, selectedSlot.sourceIn + selectedSlot.duration * value);
    const speed = sourceSpeedForSlot(selectedSlot.sourceIn, nextOut, selectedSlot.duration);
    updateSlot(selectedSlot.id, { speed, sourceOut: nextOut });
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
    setRelativeTime((current) => current);
    flash(
      Math.abs(speed - value) > 0.05
        ? `素材长度有限，实际 ${speed.toFixed(2)}×`
        : `速度 ${speed.toFixed(2)}×`,
    );
  }

  function fitToSlot() {
    if (!selectedSlot || isImageSlot) return;
    const speed = sourceSpeedForSlot(
      selectedSlot.sourceIn,
      selectedSlot.sourceOut,
      selectedSlot.duration,
    );
    updateSlot(selectedSlot.id, { speed });
    if (videoRef.current) videoRef.current.playbackRate = speed;
    flash(`已按槽位对齐：${speed.toFixed(2)}×`);
  }

  function cycleEffect(kind: EffectKind) {
    if (!selectedSlot) return;
    const current = selectedSlot.effects?.[kind] ?? 0;
    let next = 0;
    if (kind === "zoom") {
      next = current === 0 ? 0.55 : current > 0 ? -0.55 : 0;
    } else {
      next = current === 0 ? 0.55 : current > 0.7 ? 0 : 0.85;
    }
    const effects: SlotEffects = { ...selectedSlot.effects };
    if (Math.abs(next) < 0.01) delete effects[kind];
    else effects[kind] = next;
    updateSlot(selectedSlot.id, { effects });
    if (Math.abs(next) < 0.01) {
      flash(`已关闭${EFFECT_LABELS[kind]}`);
    } else if (kind === "zoom") {
      flash(next > 0 ? "推近" : "拉远");
    } else {
      flash(`${EFFECT_LABELS[kind]} ${Math.round(next * 100)}%`);
    }
  }

  function toggleSpeedBoost() {
    if (!selectedSlot || isImageSlot) return;
    const boosted = selectedSlot.speed >= 1.2;
    changeSpeed(boosted ? 1 : 1.5);
  }

  function applyAutoEffects() {
    if (!analysis) return;
    const maxDiff = Math.max(0.001, ...analysis.shots.map((shot) => shot.diff));
    const nextSlots = slots.map((slot) => {
      const shot = analysis.shots.find((item) => item.id === slot.shotId);
      const energy = Math.min(1, Math.max(0, (shot?.diff ?? 0) / maxDiff));
      const effects: SlotEffects = {};
      const rhythmFlash = slot.duration < 0.45 && slot.index % 3 === 0;
      const rhythmShake = slot.duration < 0.38 && slot.index % 5 === 1;
      if (energy > 0.38 || rhythmFlash) {
        effects.flash =
          rhythmFlash && energy <= 0.38 ? 0.3 : round2(0.32 + energy * 0.32);
      }
      if (energy > 0.58 || rhythmShake) {
        effects.shake =
          rhythmShake && energy <= 0.58 ? 0.28 : round2(0.22 + energy * 0.3);
      }
      if (slot.duration > 0.85) {
        effects.zoom =
          slot.index % 4 === 0
            ? -round2(0.24 + energy * 0.12)
            : round2(0.3 + energy * 0.18);
      }
      if ((energy > 0.72 && slot.index % 3 === 1) || slot.index % 17 === 5) {
        effects.rgb = round2(0.27 + energy * 0.12);
      }
      if ((energy > 0.84 && slot.index % 4 === 3) || slot.index % 19 === 7) {
        effects.glitch = round2(0.23 + energy * 0.12);
      }
      return { ...slot, effects: Object.keys(effects).length ? effects : undefined };
    });
    useCPVStore.setState({ slots: nextSlots });
    flash("已按镜头能量自动加效果");
  }

  function clearEffects() {
    useCPVStore.setState({
      slots: slots.map((slot) => ({ ...slot, effects: undefined })),
    });
    flash("已清空全部效果");
  }

  function commitHistoryBurst() {
    if (historyTimerRef.current) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    if (historyBaseRef.current) {
      historyRef.current.push(historyBaseRef.current);
      if (historyRef.current.length > 60) historyRef.current.shift();
      historyBaseRef.current = null;
    }
  }

  function undo() {
    commitHistoryBurst();
    const previous = historyRef.current.pop();
    if (!previous) return;
    stopSequence();
    const currentSelected = useCPVStore.getState().selectedSlotId;
    futureRef.current.push(slotsRef.current);
    historySkipRef.current = true;
    slotsRef.current = previous;
    useCPVStore.setState({
      slots: previous,
      selectedSlotId: previous.some((slot) => slot.id === currentSelected)
        ? currentSelected
        : previous[0]?.id ?? null,
    });
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    flash("已撤销");
  }

  function redo() {
    const next = futureRef.current.pop();
    if (!next) return;
    stopSequence();
    const currentSelected = useCPVStore.getState().selectedSlotId;
    historyRef.current.push(slotsRef.current);
    if (historyRef.current.length > 60) historyRef.current.shift();
    historySkipRef.current = true;
    slotsRef.current = next;
    useCPVStore.setState({
      slots: next,
      selectedSlotId: next.some((slot) => slot.id === currentSelected)
        ? currentSelected
        : next[0]?.id ?? null,
    });
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
    flash("已重做");
  }

  function nudgeTrim(which: "in" | "out", frames: number) {
    if (!selectedSlot || isImageSlot) return;
    const current = which === "in" ? selectedSlot.sourceIn : selectedSlot.sourceOut;
    updateTrim(which, current + frames / 30);
    flash(`已微调 ${frames > 0 ? "+" : ""}${frames} 帧`);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function resetClip() {
    if (!selectedSlot) return;
    const sourceIn = isReferenceSlot ? selectedSlot.start : selectedAsset?.sourceIn ?? 0;
    const sourceOut = isReferenceSlot
      ? selectedSlot.end
      : selectedAsset?.sourceOut ??
        Math.min(
          selectedAsset?.duration ?? sourceIn + selectedSlot.duration,
          sourceIn + selectedSlot.duration,
        );
    const speed = sourceSpeedForSlot(sourceIn, sourceOut, selectedSlot.duration);
    updateSlot(selectedSlot.id, {
      sourceIn,
      sourceOut,
      speed,
      volume: 1,
    });
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.playbackRate = speed;
      video.volume = audioSettings.originalVolume;
      video.currentTime = sourceIn;
    }
    setRelativeTime(0);
    flash("片段已重置");
  }

  function updateTrim(which: "in" | "out", value: number) {
    if (!selectedSlot) return;
    const trimMax = isReferenceSlot
      ? analysis?.analyzedDuration ?? selectedSlot.sourceOut
      : selectedAsset?.duration ?? analysis?.analyzedDuration ?? selectedSlot.sourceOut;
    if (which === "in") {
      const sourceIn = Math.max(0, Math.min(value, selectedSlot.sourceOut - 0.05));
      const speed = sourceSpeedForSlot(sourceIn, selectedSlot.sourceOut, selectedSlot.duration);
      updateSlot(selectedSlot.id, { sourceIn, speed });
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = sourceIn;
        videoRef.current.playbackRate = speed;
      }
    } else {
      const sourceOut = Math.min(trimMax, Math.max(value, selectedSlot.sourceIn + 0.05));
      const speed = sourceSpeedForSlot(selectedSlot.sourceIn, sourceOut, selectedSlot.duration);
      updateSlot(selectedSlot.id, { sourceOut, speed });
      if (videoRef.current) videoRef.current.playbackRate = speed;
    }
    setRelativeTime(0);
  }

  if (!reference || !analysis || !selectedSlot) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#f4f2ec] text-[#6c675e]">
        <p className="text-[12px]">还没有可编辑的时间线。</p>
        <button
          type="button"
          onClick={() => setStep("upload")}
          className="border border-[#161616] bg-[#161616] px-3 py-2 text-[11px] text-white"
        >
          重新开始
        </button>
      </div>
    );
  }

  const trimMax = isReferenceSlot
    ? analysis.analyzedDuration
    : selectedAsset?.duration ?? analysis.analyzedDuration;
  const outputDuration = slotOutputDuration(selectedSlot);

  return (
    <div className="flex min-h-dvh flex-col bg-[#f4f2ec] text-[#161616]">
      <RgbFilterDefs />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1ddd4] bg-[#f4f2ec] px-4 py-3 md:px-6">
        <div className="flex items-center gap-4">
          <Brand compact />
          <div className="hidden h-5 w-px bg-[#ddd8cf] sm:block" />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep("dna")}
              className="flex items-center gap-1.5 text-[10px] text-[#8a857b] hover:text-[#161616]"
            >
              <RiArrowLeftLine className="size-3.5" aria-hidden="true" />
              分析结果
            </button>
            <button
              type="button"
              onClick={() => void goHome()}
              className="flex items-center gap-1.5 text-[10px] text-[#8a857b] hover:text-[#161616]"
            >
              <RiFolderLine className="size-3.5" aria-hidden="true" />
              项目库
            </button>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium">
              {reference.name.replace(/\.[^.]+$/, "")} · 项目
            </div>
            <div className="text-[9px] text-[#a39d92]">
              {editKind === "beat" ? "单素材卡点 · " : ""}
              {analysis.shots.length} 槽位 · {analysis.bpm ? `${analysis.bpm} BPM` : "未检测 BPM"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex border border-[#ddd8cf] bg-white">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              className="flex size-7 items-center justify-center text-[#6c675e] hover:bg-[#f6f4ef] disabled:opacity-30"
              aria-label="撤销"
              title="撤销 Ctrl+Z"
            >
              <RiArrowGoBackLine className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              className="flex size-7 items-center justify-center border-l border-[#ddd8cf] text-[#6c675e] hover:bg-[#f6f4ef] disabled:opacity-30"
              aria-label="重做"
              title="重做 Ctrl+Shift+Z"
            >
              <RiArrowGoForwardLine className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex border border-[#ddd8cf] bg-white">
            <button
              type="button"
              onClick={() => setMode("simple")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-[10px]",
                mode === "simple" ? "bg-[#161616] text-white" : "text-[#6c675e] hover:bg-[#f6f4ef]",
              )}
            >
              <RiLayoutGridLine className="size-3.5" aria-hidden="true" />
              简单替换
            </button>
            <button
              type="button"
              onClick={() => setMode("track")}
              className={cn(
                "flex items-center gap-1.5 border-l border-[#ddd8cf] px-2.5 py-1.5 text-[10px]",
                mode === "track" ? "bg-[#161616] text-white" : "text-[#6c675e] hover:bg-[#f6f4ef]",
              )}
            >
              <RiListOrdered className="size-3.5" aria-hidden="true" />
              轨道编辑
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSwipeOpen(true)}
            className="hidden items-center gap-1.5 border border-[#ddd8cf] bg-white px-3 py-1.5 text-[10px] text-[#161616] hover:bg-[#f6f4ef] md:flex"
          >
            <RiFullscreenLine className="size-3.5" aria-hidden="true" />
            滑动预览
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("cpv:run-draft"))}
            className="flex items-center gap-1.5 border border-[#161616] px-3 py-1.5 text-[10px] font-medium text-[#161616] hover:bg-[#f4f2ec]"
        >
            <RiMagicLine className="size-3.5" aria-hidden="true" />
            一键初剪
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="flex items-center gap-1.5 bg-[#161616] px-3 py-1.5 text-[10px] font-medium text-white hover:bg-[#2b2b2b]"
          >
            <RiDownloadLine className="size-3.5" aria-hidden="true" />
            导出 1080p
          </button>
        </div>
      </header>

      {storageWarning && (
        <div className="border-b border-[#e5c98f] bg-[#fbf3e2] px-4 py-1.5 text-[10px] text-[#8a6d1f]">
          {storageWarning}
        </div>
      )}

      <div className="border-b border-[#e1ddd4] bg-white/70 px-4 py-1.5 text-[10px] text-[#8a857b]">
        选一个镜头 → 点“替换” → 自动播放这一小段；右侧按 5 秒分组收纳，点开一组查看。
      </div>

      <main ref={mainRef} className="flex flex-1 flex-col lg:flex-row">
        <section
          className={cn("w-full p-3 md:p-5", expanded ? "lg:w-full" : "lg:w-[var(--split)]")}
          style={{ ["--split" as string]: `${splitPct}%` }}
        >
          <div className="border border-[#ddd8cf] bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="size-1.5 bg-[#d9482b]" />
                <span className="text-[10px] font-medium">{selectedSlot.label}</span>
                <span className="font-mono text-[9px] text-[#8a857b]">
                  {formatTime(selectedSlot.sourceIn, true)}
                </span>
                <span className="border border-[#e1ddd4] bg-[#faf9f6] px-1.5 py-0.5 text-[9px] text-[#6c675e]">
                  {isReferenceSlot ? "原片" : selectedAsset?.name ?? "我的素材"}
                </span>
                {sequenceActive && (
                  <span className="border border-[#d9482b]/30 bg-[#fbf3f0] px-1.5 py-0.5 text-[8px] text-[#a33722]">
                    整片 {sequenceIndex + 1}/{slots.length}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="flex items-center gap-1.5 border border-[#ddd8cf] px-2 py-1 text-[9px] text-[#6c675e] hover:bg-[#f6f4ef]"
              >
                <RiFullscreenLine className="size-3" aria-hidden="true" />
                {expanded ? "收起素材栏" : "满宽预览"}
              </button>
            </div>

            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <div
                ref={effectLayerRef}
                className="absolute inset-0"
                style={{
                  transformOrigin: "center center",
                  filter: selectedFilter,
                  willChange: "transform, filter",
                }}
              >
                {previewUrl && isImageSlot ? (
                  <img
                    src={previewUrl}
                    alt=""
                    className="h-full w-full object-contain"
                    style={{
                      transform: selectedTransform,
                      transformOrigin: "center center",
                    }}
                  />
                ) : previewUrl ? (
                  <video
                    key={previewUrl}
                    ref={videoRef}
                    src={previewUrl}
                    playsInline
                    className="h-full w-full object-cover"
                    style={{
                      transform: selectedTransform,
                      transformOrigin: "center center",
                    }}
                    onLoadedMetadata={handleLoadedMetadata}
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => {
                      setIsPlaying(false);
                      if (!sequenceRef.current.active) bgmPause();
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[11px] text-[#a39d92]">
                    选择右侧素材开始预览
                  </div>
                )}
              </div>
              {selectedTint && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundColor: selectedTint.color,
                    opacity: selectedTint.opacity,
                    mixBlendMode: "soft-light",
                  }}
                />
              )}
              <div
                ref={scanlineRef}
                className="pointer-events-none absolute inset-0 opacity-0"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, rgba(255,255,255,0.22) 0px, rgba(255,255,255,0.22) 1px, transparent 1px, transparent 3px)",
                  mixBlendMode: "overlay",
                }}
              />
              <div
                ref={flashRef}
                className="pointer-events-none absolute inset-0 bg-white opacity-0"
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => (isPlaying ? videoRef.current?.pause() : playSelected(1))}
                className="flex size-7 items-center justify-center bg-[#161616] text-white hover:bg-[#2b2b2b] disabled:opacity-40"
                aria-label={isPlaying ? "暂停" : "播放本段"}
                disabled={isImageSlot}
              >
                {isPlaying ? (
                  <RiPauseFill className="size-3.5" aria-hidden="true" />
                ) : (
                  <RiPlayFill className="size-3.5" aria-hidden="true" />
                )}
              </button>
              <span className="font-mono text-[9px] tabular-nums text-[#6c675e]">
                {formatTime(relativeTime, true)} / {formatDurationLabel(outputDuration)}
              </span>
              <button
                type="button"
                onClick={() => playSelected(2)}
                disabled={isImageSlot}
                className="border border-[#ddd8cf] px-2 py-1 text-[9px] text-[#6c675e] hover:bg-[#f6f4ef] disabled:opacity-40"
              >
                循环本段 ×2
              </button>
              <button
                type="button"
                onClick={() => (sequenceActive ? stopSequence() : startSequence(0))}
                className={cn(
                  "border px-2 py-1 text-[9px]",
                  sequenceActive
                    ? "border-[#d9482b] bg-[#fbf3f0] text-[#a33722]"
                    : "border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]",
                )}
              >
                {sequenceActive ? "停止整片" : "整片播放"}
              </button>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openReplace(selectedSlot.id)}
                  className="flex items-center gap-1.5 bg-[#d9482b] px-2.5 py-1.5 text-[9px] font-medium text-white hover:bg-[#bd3d24]"
                >
                  <RiUploadLine className="size-3" aria-hidden="true" />
                  替换素材
                </button>
                {!isReferenceSlot && (
                  <button
                    type="button"
                    onClick={() => {
                      restoreSlot(selectedSlot.id);
                      flash("已还原原片镜头");
                    }}
                    className="border border-[#ddd8cf] px-2.5 py-1.5 text-[9px] text-[#6c675e] hover:bg-[#f6f4ef]"
                  >
                    还原
                  </button>
                )}
              </div>
            </div>

            <div className="mt-2 space-y-1.5 border-t border-[#eeeae1] pt-2">
              <div className="flex flex-wrap items-center gap-2 text-[9px] text-[#6c675e]">
                <span className="w-8">速度</span>
                {SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => changeSpeed(speed)}
                    className={cn(
                      "border px-1.5 py-0.5 font-mono",
                      Math.abs(selectedSlot.speed - speed) < 0.01
                        ? "border-[#161616] bg-[#161616] text-white"
                        : "border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]",
                    )}
                  >
                    {speed}×
                  </button>
                ))}
                <input
                  type="range"
                  min={0.0625}
                  max={4}
                  step={0.01}
                  value={selectedSlot.speed}
                  onChange={(event) => changeSpeed(Number(event.target.value))}
                  className="w-20 accent-[#d9482b]"
                  aria-label="播放速度"
                />
                <span className="font-mono text-[#161616]">{selectedSlot.speed.toFixed(2)}×</span>
                <button
                  type="button"
                  onClick={fitToSlot}
                  className="border border-[#ddd8cf] px-1.5 py-0.5 text-[#6c675e] hover:bg-[#f6f4ef]"
                >
                  适配槽位
                </button>
                <button
                  type="button"
                  onClick={resetClip}
                  className="border border-[#ddd8cf] px-1.5 py-0.5 text-[#6c675e] hover:bg-[#f6f4ef]"
                >
                  重置
                </button>
                <span className="ml-auto font-mono text-[#a39d92]">
                  输出 {formatDurationLabel(outputDuration)} / 槽位{" "}
                  {formatDurationLabel(selectedSlot.duration)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[9px] text-[#6c675e]">
                <span className="w-8">入点</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.1, trimMax - 0.1)}
                  step={0.05}
                  value={selectedSlot.sourceIn}
                  onChange={(event) => updateTrim("in", Number(event.target.value))}
                  className="w-24 accent-[#d9482b]"
                  aria-label="入点"
                />
                <span className="font-mono text-[#161616]">
                  {formatTime(selectedSlot.sourceIn, true)}
                </span>
                <span className="ml-2 w-8">出点</span>
                <input
                  type="range"
                  min={0.1}
                  max={trimMax}
                  step={0.05}
                  value={Math.min(selectedSlot.sourceOut, trimMax)}
                  onChange={(event) => updateTrim("out", Number(event.target.value))}
                  className="w-24 accent-[#d9482b]"
                  aria-label="出点"
                />
                <span className="font-mono text-[#161616]">
                  {formatTime(selectedSlot.sourceOut, true)}
                </span>
                <span className="ml-1 flex items-center gap-0.5" title="按 1/30s 微调">
                  <button
                    type="button"
                    onClick={() => nudgeTrim("in", -1)}
                    disabled={isImageSlot}
                    className="border border-[#ddd8cf] bg-white px-1 py-0.5 text-[7px] text-[#6c675e] hover:bg-[#f6f4ef] disabled:opacity-40"
                  >
                    入−
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeTrim("in", 1)}
                    disabled={isImageSlot}
                    className="border border-[#ddd8cf] bg-white px-1 py-0.5 text-[7px] text-[#6c675e] hover:bg-[#f6f4ef] disabled:opacity-40"
                  >
                    入+
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeTrim("out", -1)}
                    disabled={isImageSlot}
                    className="border border-[#ddd8cf] bg-white px-1 py-0.5 text-[7px] text-[#6c675e] hover:bg-[#f6f4ef] disabled:opacity-40"
                  >
                    出−
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeTrim("out", 1)}
                    disabled={isImageSlot}
                    className="border border-[#ddd8cf] bg-white px-1 py-0.5 text-[7px] text-[#6c675e] hover:bg-[#f6f4ef] disabled:opacity-40"
                  >
                    出+
                  </button>
                </span>
                <span className="ml-2 w-8">音量</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={selectedSlot.volume ?? 1}
                  onChange={(event) => {
                    const volume = Number(event.target.value);
                    updateSlot(selectedSlot.id, { volume });
                    if (videoRef.current) {
                      videoRef.current.volume =
                        volume * audioSettings.originalVolume;
                    }
                  }}
                  className="w-16 accent-[#d9482b]"
                  aria-label="音量"
                />
                <span className="font-mono text-[#161616]">
                  {Math.round((selectedSlot.volume ?? 1) * 100)}%
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[9px] text-[#6c675e]">
                <span className="w-8">匹配</span>
                <button
                  type="button"
                  onClick={() => setMatchSettings({ color: !matchSettings.color })}
                  className={cn(
                    "border px-1.5 py-0.5",
                    matchSettings.color
                      ? "border-[#161616] bg-[#161616] text-white"
                      : "border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]",
                  )}
                  title="按参考镜头调整亮度、饱和度、对比度和冷暖"
                >
                  色彩
                </button>
                <button
                  type="button"
                  onClick={() => setMatchSettings({ motion: !matchSettings.motion })}
                  className={cn(
                    "border px-1.5 py-0.5",
                    matchSettings.motion
                      ? "border-[#161616] bg-[#161616] text-white"
                      : "border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]",
                  )}
                  title="镜头横移方向相反时自动水平镜像"
                >
                  运动
                </button>
                <button
                  type="button"
                  onClick={() => setMatchSettings({ composition: !matchSettings.composition })}
                  className={cn(
                    "border px-1.5 py-0.5",
                    matchSettings.composition
                      ? "border-[#161616] bg-[#161616] text-white"
                      : "border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]",
                  )}
                  title="按主体位置和画面分布微调位移与缩放"
                >
                  构图
                </button>
                <span className="ml-1 w-8">强度</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(matchSettings.strength * 100)}
                  onChange={(event) =>
                    setMatchSettings({ strength: Number(event.target.value) / 100 })
                  }
                  className="w-20 accent-[#d9482b]"
                  aria-label="匹配强度"
                />
                <span className="w-7 font-mono text-[#161616]">
                  {Math.round(matchSettings.strength * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateSlot(selectedSlot.id, { mirrorX: !selectedSlot.mirrorX })
                  }
                  disabled={isReferenceSlot}
                  className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[#6c675e] hover:bg-[#f6f4ef] disabled:opacity-40"
                >
                  {selectedSlot.mirrorX ? "取消镜像" : "水平镜像"}
                </button>
                <span className="ml-auto font-mono text-[#a39d92]">
                  {isReferenceSlot
                    ? "参考镜头"
                    : selectedSlot.colorGrade || selectedSlot.composition || selectedSlot.mirrorX
                      ? "已自动匹配"
                      : "等待匹配数据"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[9px] text-[#6c675e]">
                <span className="w-8">效果</span>
                {EFFECT_ORDER.map((kind) => {
                  const value = selectedSlot.effects?.[kind] ?? 0;
                  const active = Math.abs(value) > 0.01;
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => cycleEffect(kind)}
                      className={cn(
                        "border px-1.5 py-0.5",
                        active
                          ? "border-[#161616] bg-[#161616] text-white"
                          : "border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]",
                      )}
                      title={`${EFFECT_LABELS[kind]}：点一次中，两次强，三次关`}
                    >
                      {EFFECT_LABELS[kind]}
                      {kind === "zoom" && active ? (value > 0 ? "·推" : "·拉") : ""}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={toggleSpeedBoost}
                  className={cn(
                    "border px-1.5 py-0.5",
                    selectedSlot.speed >= 1.2
                      ? "border-[#161616] bg-[#161616] text-white"
                      : "border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]",
                  )}
                  title="在 1× 和 1.5× 之间切换"
                >
                  变速
                </button>
                <button
                  type="button"
                  onClick={applyAutoEffects}
                  className="border border-[#d9482b]/40 bg-[#fbf3f0] px-1.5 py-0.5 text-[#a33722] hover:bg-[#f7e8e3]"
                >
                  自动
                </button>
                <button
                  type="button"
                  onClick={clearEffects}
                  className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[#6c675e] hover:bg-[#f6f4ef]"
                >
                  清空
                </button>
                <span className="ml-1">效果强度</span>
                <input
                  type="range"
                  min={0}
                  max={150}
                  step={5}
                  value={Math.round((selectedSlot.effectScale ?? 1) * 100)}
                  onChange={(event) =>
                    updateSlot(selectedSlot.id, {
                      effectScale: Number(event.target.value) / 100,
                    })
                  }
                  className="w-16 accent-[#d9482b]"
                  aria-label="效果强度"
                />
                <span className="w-7 font-mono text-[#161616]">
                  {Math.round((selectedSlot.effectScale ?? 1) * 100)}%
                </span>
                <span className="ml-auto font-mono text-[#a39d92]">
                  {effectCount(selectedSlot.effects)} 项
                  {effectCount(selectedSlot.effects) > 0
                    ? ` · ${effectLabels(selectedSlot.effects).join(" / ")}`
                    : " · 未加效果"}
                </span>
              </div>
            </div>
          </div>

          {mode === "track" && (
            <div className="mt-3 border border-[#ddd8cf] bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#8a857b]">
                <span className="flex items-center gap-1.5">
                  <RiScissorsCutLine className="size-3" aria-hidden="true" />
                  多轨时间线
                  <span className="text-[#a39d92]">V1 · A1 · T1</span>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTimelineZoom(1)}
                    className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[9px] hover:bg-[#f6f4ef]"
                  >
                    适应窗口
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimelineZoom((current) => clampZoom(current / 1.5))}
                    className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[10px] hover:bg-[#f6f4ef]"
                    aria-label="缩小时间线"
                  >
                    −
                  </button>
                  <span className="w-10 text-center font-mono text-[9px] text-[#161616]">
                    {Math.round(timelineZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setTimelineZoom((current) => clampZoom(current * 1.5))}
                    className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[10px] hover:bg-[#f6f4ef]"
                    aria-label="放大时间线"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={focusSelectedTimeline}
                    className="border border-[#161616] bg-white px-1.5 py-0.5 text-[9px] text-[#161616] hover:bg-[#f6f4ef]"
                  >
                    放大选中
                  </button>
                </div>
              </div>

              <div ref={timelineScrollRef} className="overflow-x-auto pb-1">
                <div style={{ width: `${timelineZoom * 100}%` }} className="min-w-full">
                  <TimelineRuler duration={analysis.analyzedDuration} zoom={timelineZoom} />
                  <div className="space-y-1.5">
                    <TrackLane
                      label="V"
                      slots={slots}
                      selectedId={selectedSlot.id}
                      onSelect={selectSlotManually}
                    />
                    <div className="flex items-center gap-2">
                      <span className="w-4 font-mono text-[8px] text-[#a39d92]">A</span>
                      <div className="flex h-6 flex-1 items-center border border-[#e1ddd4] bg-[#faf9f6] px-2 text-[8px] text-[#8a857b]">
                        {bgm?.name ?? "音乐槽为空"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4 font-mono text-[8px] text-[#a39d92]">T</span>
                      <div className="flex h-6 flex-1 items-center border border-dashed border-[#e1ddd4] px-2 text-[8px] text-[#a39d92]">
                        文字槽 · 下一步接入
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-1 flex items-center justify-between text-[9px] text-[#a39d92]">
                <span>基础轨 V1 / A1 / T1；叠加层 V2 与音效层 A2 后续加入。</span>
                <span className="font-mono">{analysis.cuts.length} cuts</span>
              </div>
            </div>
          )}
        </section>

        {!expanded && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整素材栏宽度"
            onPointerDown={() => setDraggingSplit(true)}
            className="hidden w-2 cursor-col-resize items-center justify-center border-l border-[#e1ddd4] lg:flex"
          >
            <div className={cn("h-10 w-px bg-[#c9c3b8]", draggingSplit && "bg-[#161616]")} />
          </div>
        )}

        {!expanded && (
          <aside className="w-full border-t border-[#e1ddd4] lg:min-w-0 lg:flex-1 lg:border-l lg:border-t-0">
            <div className="sticky top-0 z-10 border-b border-[#e1ddd4] bg-[#f4f2ec]/95 px-4 py-3 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[11px] font-medium">可替换素材</h2>
                  <p className="mt-0.5 text-[9px] text-[#8a857b]">
                    {slots.length} 个镜头 · 按时间顺序
                  </p>
                </div>
                {userAssets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setLibraryOpen(true)}
                    className="flex items-center gap-1.5 border border-[#ddd8cf] bg-white px-2.5 py-1.5 text-[9px] text-[#161616] hover:bg-[#f6f4ef]"
                  >
                    <RiFolderLine className="size-3" aria-hidden="true" />
                    素材库 {userAssets.length}
                  </button>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => poolInputRef.current?.click()}
                  className="flex items-center gap-1.5 border border-[#ddd8cf] bg-white px-2.5 py-1.5 text-[9px] text-[#161616] hover:bg-[#f6f4ef]"
                >
                  <RiAddLine className="size-3" aria-hidden="true" />
                  上传素材
                </button>
                <button
                  type="button"
                  onClick={() => extractInputRef.current?.click()}
                  className="flex items-center gap-1.5 border border-[#ddd8cf] bg-white px-2.5 py-1.5 text-[9px] text-[#161616] hover:bg-[#f6f4ef]"
                >
                  <RiScissorsCutLine className="size-3" aria-hidden="true" />
                  从视频提取
                </button>
                {userAssets.length > 0 && editKind !== "beat" && (
                  <button
                    type="button"
                    onClick={replaceAllWithMaterials}
                    className="flex items-center gap-1.5 border border-[#d9482b]/40 bg-[#fbf3f0] px-2.5 py-1.5 text-[9px] text-[#a33722] hover:bg-[#f7e8e3]"
                  >
                    <RiCheckLine className="size-3" aria-hidden="true" />
                    全部替换
                  </button>
                )}
              </div>

              {userAssets.length === 0 && (
                <div className="mt-2 rounded-lg border border-dashed border-[#ddd8cf] bg-white px-2.5 py-2 text-[9px] leading-4 text-[#8a857b]">
                  还没有替换素材。先上传，或从另一个视频提取镜头。
                </div>
              )}

              <div className="mt-2 border border-[#ddd8cf] bg-white">
                <div className="flex items-center justify-between px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <RiMusic2Line className="size-3.5 shrink-0 text-[#d9482b]" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="truncate text-[9px] font-medium">音乐槽</div>
                      <div className="truncate text-[8px] text-[#8a857b]">{bgm?.name ?? "未替换"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {bedSrc && (
                      <button
                        type="button"
                        onClick={() => {
                          const audio = bgmAudioRef.current;
                          if (!audio) return;
                          if (audio.paused) bgmStartAt(selectedSlot?.start ?? 0);
                          else audio.pause();
                        }}
                        className="border border-[#ddd8cf] p-1 text-[#6c675e] hover:bg-[#f6f4ef]"
                        aria-label="试听音乐"
                      >
                        <RiPlayFill className="size-3" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => bgmInputRef.current?.click()}
                      className="border border-[#ddd8cf] p-1 text-[#6c675e] hover:bg-[#f6f4ef]"
                      aria-label="替换音乐"
                    >
                      <RiRestartLine className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-[#eeeae1] px-2.5 py-1.5 text-[8px] text-[#6c675e]">
                  <span className="font-medium">音乐床</span>
                  <select
                    value={audioSettings.bed}
                    onChange={(event) =>
                      setAudioSettings({ bed: event.target.value as AudioBed })
                    }
                    className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[8px]"
                    aria-label="音乐床来源"
                  >
                    <option value="reference">参考片原声</option>
                    <option value="bgm">自选 BGM</option>
                    <option value="none">无音乐</option>
                  </select>
                  <span className="text-[#a39d92]">
                    {audioSettings.bed === "reference"
                      ? "沿用参考片音乐与踩点（复刻默认）"
                      : audioSettings.bed === "bgm"
                        ? "循环自选音乐"
                        : "仅素材原声"}
                  </span>
                </div>
                {bedSrc && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-[#eeeae1] px-2.5 py-1.5 text-[8px] text-[#6c675e]">
                    <span className="font-medium">混音</span>
                    <label className="flex items-center gap-1">
                      原声
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(audioSettings.originalVolume * 100)}
                        onChange={(event) =>
                          setAudioSettings({
                            originalVolume: Number(event.target.value) / 100,
                          })
                        }
                        className="w-14 accent-[#d9482b]"
                        aria-label="原声音量"
                      />
                      <span className="w-6 font-mono">
                        {Math.round(audioSettings.originalVolume * 100)}%
                      </span>
                    </label>
                    <label className="flex items-center gap-1">
                      音乐
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(audioSettings.bgmVolume * 100)}
                        onChange={(event) =>
                          setAudioSettings({
                            bgmVolume: Number(event.target.value) / 100,
                            autoBalance: false,
                          })
                        }
                        className="w-14 accent-[#d9482b]"
                        aria-label="音乐音量"
                      />
                      <span className="w-6 font-mono">
                        {Math.round(audioSettings.bgmVolume * 100)}%
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setAudioSettings({ autoBalance: !audioSettings.autoBalance })
                      }
                      className={cn(
                        "border px-1.5 py-0.5",
                        audioSettings.autoBalance
                          ? "border-[#161616] bg-[#161616] text-white"
                          : "border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]",
                      )}
                      title="按素材实际响度自动压低 BGM；手动拖动音乐滑杆会接管"
                    >
                      {audioSettings.autoBalance ? "自动平衡" : "手动混音"}
                    </button>
                    <span className="ml-auto text-[#a39d92]">
                      {mixAnalyzing
                        ? "分析响度…"
                        : mixReport
                          ? `素材 ${mixReport.clipDb.toFixed(0)}dB · 音乐 ${mixReport.bgmDb.toFixed(0)}dB`
                          : "BGM 从 0s 循环"}
                    </span>
                  </div>
                )}
                {bedSrc && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-[#eeeae1] px-2.5 py-1.5 text-[8px] text-[#6c675e]">
                    <button
                      type="button"
                      onClick={() =>
                        setAudioSettings({ visualPan: !audioSettings.visualPan })
                      }
                      className={cn(
                        "border px-1.5 py-0.5",
                        audioSettings.visualPan
                          ? "border-[#161616] bg-[#161616] text-white"
                          : "border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]",
                      )}
                      title="按音乐左右声道能量轻推画面"
                    >
                      声像跟拍
                    </button>
                    <label className="flex items-center gap-1">
                      幅度
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(audioSettings.visualPanStrength * 100)}
                        onChange={(event) =>
                          setAudioSettings({
                            visualPanStrength: Number(event.target.value) / 100,
                          })
                        }
                        className="w-14 accent-[#d9482b]"
                        aria-label="声像跟拍幅度"
                      />
                      <span className="w-6 font-mono">
                        {Math.round(audioSettings.visualPanStrength * 100)}%
                      </span>
                    </label>
                    <span className="ml-auto text-[#a39d92]">
                      {bgmPan ? "已分析左右声道" : "分析左右声道…"}
                    </span>
                  </div>
                )}
              </div>

              {userAssets.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between px-0.5 text-[9px] text-[#8a857b]">
                    <span>最近素材</span>
                    <button
                      type="button"
                      onClick={() => setLibraryOpen(true)}
                      className="hover:text-[#161616]"
                    >
                      全部 {userAssets.length} ›
                    </button>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                    {userAssets.slice(0, 6).map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData("application/x-cpv-asset", asset.id);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => setAssetPreview(asset)}
                        className="group relative h-10 w-16 shrink-0 cursor-grab overflow-hidden rounded border border-[#ddd8cf] bg-white text-left active:cursor-grabbing"
                        title={`${asset.name} · 点击预览，拖到镜头卡片替换`}
                      >
                        {asset.thumbnailUrl ? (
                          <img
                            src={asset.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[#a39d92]">
                            <RiImageLine className="size-3.5" aria-hidden="true" />
                          </div>
                        )}
                      </button>
                    ))}
                    {userAssets.length > 6 && (
                      <button
                        type="button"
                        onClick={() => setLibraryOpen(true)}
                        className="flex h-10 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded border border-dashed border-[#d8d3c9] bg-white text-[8px] text-[#8a857b] hover:border-[#161616]/40"
                      >
                        <RiFolderLine className="size-3.5" aria-hidden="true" />
                        全部
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 p-3">
              <DraftPanel />
              <AudioTrackPanel />
              <div className="flex items-center justify-between px-1 text-[9px] text-[#8a857b]">
                <span>按 5 秒分组 · 点开查看镜头</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenSlotGroups(Object.fromEntries(slotGroups.map((item) => [item.key, true])))
                    }
                    className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[8px] hover:bg-[#f6f4ef]"
                  >
                    展开全部
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenSlotGroups({})}
                    className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[8px] hover:bg-[#f6f4ef]"
                  >
                    收起全部
                  </button>
                </div>
              </div>
              {slotGroups.map((group) => {
                const open = openSlotGroups[group.key] ?? false;
                const hasSelected = group.slots.some((item) => item.id === selectedSlot.id);
                return (
                  <section
                    key={group.key}
                    className="overflow-hidden rounded-xl border border-[#e1ddd4] bg-white"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenSlotGroups((current) => ({ ...current, [group.key]: !open }))
                      }
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#faf9f6]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {open ? (
                          <RiArrowDownSLine className="size-3.5 text-[#8a857b]" aria-hidden="true" />
                        ) : (
                          <RiArrowRightSLine className="size-3.5 text-[#8a857b]" aria-hidden="true" />
                        )}
                        <span className="font-mono text-[11px] text-[#161616]">
                          {formatTime(group.start)}–{formatTime(group.end)}
                        </span>
                        <span className="text-[10px] text-[#8a857b]">{group.slots.length} 个镜头</span>
                        {hasSelected && (
                          <span className="rounded-full bg-[#fbf3f0] px-1.5 py-0.5 text-[8px] text-[#a33722]">
                            当前
                          </span>
                        )}
                      </span>
                      <span className="text-[9px] text-[#a39d92]">{open ? "收起" : "展开"}</span>
                    </button>
                    {open && (
                      <div className="space-y-2 border-t border-[#eeeae1] p-2">
                        {group.slots.map((slot) => {
                          const asset = assets.find((item) => item.id === slot.assetId);
                          const replaced = slot.assetId !== reference.id;
                          const displayGrade =
                            matchSettings.color && slot.colorGrade
                              ? scaleColorGrade(slot.colorGrade, matchSettings.strength)
                              : null;
                          const displayFilter = displayGrade
                            ? colorFilter(displayGrade)
                            : undefined;
                          const displayTint = displayGrade
                            ? warmthTint(displayGrade)
                            : null;
                          const displayTransform = composeTransform(
                            Boolean(matchSettings.motion && slot.mirrorX),
                            matchSettings.composition && slot.composition
                              ? scaleCompositionAdjust(slot.composition, matchSettings.strength)
                              : undefined,
                          );
                          const matchTags = [
                            displayGrade ? "色彩" : null,
                            matchSettings.motion && slot.mirrorX ? "镜像" : null,
                            matchSettings.composition && slot.composition ? "构图" : null,
                          ].filter((tag): tag is string => Boolean(tag));
                          return (
                  <article
                    key={slot.id}
                    ref={(element) => {
                      slotRefs.current[slot.id] = element;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => onDropAsset(event, slot)}
                    onClick={() => selectSlotManually(slot.id)}
                    className={cn(
                      "cursor-pointer border bg-white transition-colors",
                      selectedSlot.id === slot.id
                        ? "border-[#161616] shadow-[inset_2px_0_0_#d9482b]"
                        : "border-[#e1ddd4] hover:border-[#161616]/35",
                      bounceSlot === slot.id && "cpv-bounce motion-reduce:animate-none",
                      flipSlot === slot.id && "cpv-flip motion-reduce:animate-none",
                    )}
                  >
                    <div className="flex items-center justify-between border-b border-[#eeeae1] px-2.5 py-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-[9px] text-[#a39d92]">
                          {String(slot.index + 1).padStart(2, "0")}
                        </span>
                        <span className="truncate text-[10px] font-medium">{slot.label}</span>
                        <span className="shrink-0 font-mono text-[8px] text-[#a39d92]">
                          {formatTime(slot.sourceIn, true)}
                        </span>
                        {Math.abs(slot.speed - 1) > 0.01 && (
                          <span className="shrink-0 border border-[#ddd8cf] px-1 font-mono text-[7px] text-[#6c675e]">
                            {slot.speed.toFixed(2)}×
                          </span>
                        )}
                        {effectCount(slot.effects) > 0 && (
                          <span className="shrink-0 border border-[#d9482b]/25 bg-[#fbf3f0] px-1 font-mono text-[7px] text-[#a33722]">
                            FX{effectCount(slot.effects)}
                          </span>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 border px-1.5 py-0.5 text-[8px]",
                          replaced
                            ? "border-[#161616] bg-[#161616] text-white"
                            : "border-[#e1ddd4] bg-[#faf9f6] text-[#8a857b]",
                        )}
                      >
                        {replaced ? "已替换" : "原片"}
                      </span>
                    </div>

                    <div className="relative aspect-video bg-[#f0ede6]">
                      {slot.thumbnailUrl ? (
                        <img
                          src={slot.thumbnailUrl}
                          alt={`${slot.label} 预览`}
                          className="h-full w-full object-cover"
                          style={{
                            filter: displayFilter,
                            transform: displayTransform,
                            transformOrigin: "center center",
                          }}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[#a39d92]">
                          <RiFilmLine className="size-4" aria-hidden="true" />
                        </div>
                      )}
                      {displayTint && (
                        <div
                          className="pointer-events-none absolute inset-0"
                          style={{
                            backgroundColor: displayTint.color,
                            opacity: displayTint.opacity,
                            mixBlendMode: "soft-light",
                          }}
                        />
                      )}
                      <span className="absolute bottom-1.5 right-1.5 bg-white/90 px-1.5 py-0.5 font-mono text-[8px] text-[#161616]">
                        {formatDurationLabel(slotOutputDuration(slot))}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-[9px] text-[#6c675e]">
                          {replaced ? asset?.name ?? "我的素材" : "参考镜头"}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {[...matchTags, ...(slot.effectTags.length ? slot.effectTags : ["硬切"])]
                            .slice(0, 4)
                            .map((tag) => (
                              <span
                                key={tag}
                                className={cn(
                                  "border px-1 py-0.5 text-[7px]",
                                  matchTags.includes(tag)
                                    ? "border-[#161616]/20 bg-[#f4f2ec] text-[#161616]"
                                    : "border-[#d9482b]/20 bg-[#fbf3f0] text-[#a33722]",
                                )}
                              >
                                {tag}
                              </span>
                            ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {replaced && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              restoreSlot(slot.id);
                              flash("已还原原片镜头");
                            }}
                            className="border border-[#ddd8cf] px-1.5 py-1 text-[8px] text-[#6c675e] hover:bg-[#f6f4ef]"
                          >
                            还原
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openReplace(slot.id);
                          }}
                          className="bg-[#161616] px-2 py-1 text-[8px] font-medium text-white hover:bg-[#2b2b2b]"
                        >
                          替换
                        </button>
                      </div>
                    </div>
                  </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </aside>
        )}
      </main>

      {audioClips.map((clip) => {
        const asset =
          assets.find((item) => item.id === clip.assetId) ??
          (bgm?.id === clip.assetId ? bgm : undefined);
        if (!asset) return null;
        return (
          <audio
            key={clip.id}
            ref={(element) => {
              audioClipRefs.current[clip.id] = element;
            }}
            src={asset.url}
            preload="auto"
            className="hidden"
          />
        );
      })}

      <input
        ref={slotInputRef}
        type="file"
        accept="video/*,image/*"
        className="hidden"
        onChange={(event) => void onSlotFile(event.target.files?.[0])}
      />
      <input
        ref={poolInputRef}
        type="file"
        accept="video/*,image/*,audio/*"
        multiple
        className="hidden"
        onChange={(event) => void onPoolFiles(event.target.files)}
      />
      <input
        ref={extractInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => void onExtractFile(event.target.files?.[0])}
      />
      <input
        ref={bgmInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => void onBgmFile(event.target.files?.[0])}
      />
      {bedSrc && (
        <audio
          ref={bgmAudioRef}
          src={bedSrc}
          loop={audioSettings.bed === "bgm"}
          className="hidden"
          onLoadedMetadata={() => {
            const audio = bgmAudioRef.current;
            if (!audio) return;
            audio.volume = audioSettings.bgmVolume;
            if (isPlaying) {
              const target = Math.min(
                selectedSlot?.start ?? 0,
                Math.max(0, (audio.duration || 0) - 0.05),
              );
              audio.currentTime = target;
              void audio.play().catch(() => undefined);
            }
          }}
        />
      )}

      {assetPreview && (
        <AssetPreviewModal
          asset={assetPreview}
          onClose={() => setAssetPreview(null)}
          onUse={
            selectedSlot
              ? () => {
                  handleReplace(selectedSlot, assetPreview);
                  setAssetPreview(null);
                }
              : undefined
          }
        />
      )}

      {libraryOpen && (
        <div className="fixed inset-0 z-[105] flex flex-col bg-[#f4f2ec]">
          <header className="flex items-center justify-between border-b border-[#e1ddd4] px-4 py-3">
            <div>
              <h2 className="text-[12px] font-medium">素材库</h2>
              <p className="mt-0.5 text-[9px] text-[#8a857b]">
                {userAssets.length} 个素材 · 点击预览，拖到镜头卡片替换
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLibraryOpen(false)}
              className="border border-[#ddd8cf] bg-white p-1.5 text-[#6c675e] hover:bg-[#f6f4ef]"
              aria-label="关闭素材库"
            >
              <RiCloseLine className="size-4" aria-hidden="true" />
            </button>
          </header>
          <div className="flex min-h-0 flex-1">
            <aside className="w-44 shrink-0 overflow-y-auto border-r border-[#e1ddd4] bg-white p-2">
              <div className="px-2 py-1.5 text-[9px] uppercase tracking-[0.14em] text-[#a39d92]">
                分组
              </div>
              <button
                type="button"
                onClick={() => setActiveGroup("all")}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[10px]",
                  activeGroup === "all"
                    ? "bg-[#161616] text-white"
                    : "text-[#6c675e] hover:bg-[#f6f4ef]",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <RiFolderLine className="size-3" aria-hidden="true" />
                  全部素材
                </span>
                <span className="font-mono text-[8px]">{userAssets.length}</span>
              </button>
              {groupedAssets.map((group) => (
                <button
                  key={group.name}
                  type="button"
                  onClick={() => setActiveGroup(group.name)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[10px]",
                    activeGroup === group.name
                      ? "bg-[#161616] text-white"
                      : "text-[#6c675e] hover:bg-[#f6f4ef]",
                  )}
                  title={group.name}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <RiFolderLine className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{group.name}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[8px]">{group.items.length}</span>
                </button>
              ))}
            </aside>
            <div className="min-w-0 flex-1 overflow-y-auto p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium">
                    {activeGroup === "all" ? "素材来源" : `${activeGroup} · 时间段`}
                  </div>
                  <div className="mt-0.5 text-[9px] text-[#8a857b]">
                    分组收纳，点开一组查看镜头
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenLibrarySections(
                        Object.fromEntries(materialSections.map((section) => [section.key, true])),
                      )
                    }
                    className="border border-[#ddd8cf] bg-white px-2 py-1 text-[9px] text-[#6c675e] hover:bg-[#f6f4ef]"
                  >
                    展开全部
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenLibrarySections({})}
                    className="border border-[#ddd8cf] bg-white px-2 py-1 text-[9px] text-[#6c675e] hover:bg-[#f6f4ef]"
                  >
                    收起全部
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {materialSections.map((section) => {
                  const open = openLibrarySections[section.key] ?? false;
                  return (
                    <section
                      key={section.key}
                      className="overflow-hidden rounded-xl border border-[#e1ddd4] bg-white"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenLibrarySections((current) => ({
                            ...current,
                            [section.key]: !open,
                          }))
                        }
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#faf9f6]"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {open ? (
                            <RiArrowDownSLine
                              className="size-3.5 text-[#8a857b]"
                              aria-hidden="true"
                            />
                          ) : (
                            <RiArrowRightSLine
                              className="size-3.5 text-[#8a857b]"
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate text-[11px] font-medium">{section.label}</span>
                          <span className="shrink-0 text-[9px] text-[#8a857b]">{section.hint}</span>
                        </span>
                        <span className="text-[9px] text-[#a39d92]">{open ? "收起" : "展开"}</span>
                      </button>
                      {open && (
                        <div className="grid grid-cols-2 gap-2 border-t border-[#eeeae1] p-2 sm:grid-cols-3 md:grid-cols-4">
                          {section.items.map((asset) => (
                            <button
                              key={asset.id}
                              type="button"
                              onClick={() => {
                                setAssetPreview(asset);
                                setLibraryOpen(false);
                              }}
                              className="group overflow-hidden rounded-lg border border-[#e1ddd4] bg-white text-left hover:border-[#161616]/40"
                            >
                              <div className="relative aspect-video bg-[#f0ede6]">
                                {asset.thumbnailUrl ? (
                                  <img
                                    src={asset.thumbnailUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-[#a39d92]">
                                    <RiImageLine className="size-4" aria-hidden="true" />
                                  </div>
                                )}
                                {asset.sourceIn != null && asset.sourceOut != null && (
                                  <span className="absolute bottom-1 right-1 bg-white/90 px-1 font-mono text-[8px] text-[#161616]">
                                    {formatDurationLabel(asset.sourceOut - asset.sourceIn)}
                                  </span>
                                )}
                              </div>
                              <div className="truncate px-2 py-1.5 text-[10px] text-[#6c675e]">
                                {asset.name}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>

              {materialSections.length === 0 && (
                <div className="flex flex-col items-center justify-center border border-dashed border-[#ddd8cf] py-10 text-[10px] text-[#a39d92]">
                  这里还没有素材，先上传或从视频提取。
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {extracting && (
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-[#161616]/40 p-4">
          <div className="w-full max-w-xs border border-[#ddd8cf] bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-medium">正在提取镜头</div>
                <div className="mt-0.5 text-[9px] text-[#8a857b]">先分析前 60 秒，按切点拆成素材</div>
              </div>
              <button
                type="button"
                onClick={() => extractControllerRef.current?.abort()}
                className="text-[9px] text-[#a33722] underline"
              >
                取消
              </button>
            </div>
            <div className="mt-3 h-1 overflow-hidden bg-[#eeeae1]">
              <div
                className="h-full bg-[#d9482b] transition-[width] duration-300"
                style={{ width: `${Math.round(extractProgress * 100)}%` }}
              />
            </div>
            <div className="mt-2 text-right font-mono text-[9px] text-[#8a857b]">
              {Math.round(extractProgress * 100)}%
            </div>
          </div>
        </div>
      )}

      {swipeOpen && (
        <SwipePreview
          slots={slots}
          assets={assets}
          referenceId={reference.id}
          matchSettings={matchSettings}
          onClose={() => setSwipeOpen(false)}
          onSelect={(slotId) => {
            selectSlotManually(slotId);
            setSwipeOpen(false);
          }}
          onReplace={(slotId) => {
            setSwipeOpen(false);
            openReplace(slotId);
          }}
        />
      )}

      {exportOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#161616]/40 p-4">
          <div
            className={cn(
              "w-full border border-[#ddd8cf] bg-white p-5 shadow-xl",
              exporting || exportBlobUrl ? "max-w-2xl" : "max-w-sm",
            )}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[13px] font-medium">
                  {exportBlobUrl ? "整片预览" : "导出成片"}
                </h2>
                <p className="mt-0.5 text-[9px] text-[#8a857b]">
                  {analysis.shots.length} 个槽位 · {formatDurationLabel(analysis.analyzedDuration)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeExport}
                className="p-1 text-[#8a857b] hover:text-[#161616]"
                aria-label="关闭导出弹窗"
              >
                <RiCloseLine className="size-4" aria-hidden="true" />
              </button>
            </div>

            {exporting ? (
              <div className="mt-5">
                <div className="text-[11px] text-[#161616]">正在渲染整片</div>
                <div className="mt-2 h-1.5 overflow-hidden bg-[#eeeae1]">
                  <div
                    className="h-full bg-[#d9482b] transition-[width] duration-300"
                    style={{ width: `${Math.round(exportProgress * 100)}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[9px] text-[#8a857b]">
                  <span>{exportProgress > 0 ? "渲染 + 编码中" : "正在准备素材…"}</span>
                  <span className="font-mono">{Math.round(exportProgress * 100)}%</span>
                </div>
                <p className="mt-3 text-[9px] leading-4 text-[#a39d92]">
                  把 {slots.length} 个槽位按时间线拼成 1080p 成片，请不要关闭页面。
                </p>
              </div>
            ) : exportBlobUrl ? (
              <div className="mt-4 space-y-3">
                <video src={exportBlobUrl} controls className="aspect-video w-full bg-black" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[9px] text-[#8a857b]">
                    已自动开始下载；也可以在这里先看整片。
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void startExport()}
                      className="border border-[#ddd8cf] px-2.5 py-1.5 text-[9px] text-[#6c675e] hover:bg-[#f6f4ef]"
                    >
                      重新导出
                    </button>
                    <a
                      href={exportBlobUrl}
                      download={`${reference.name.replace(/\.[^.]+$/, "")}-cpvidego-1080p.mp4`}
                      className="bg-[#161616] px-3 py-1.5 text-[9px] font-medium text-white hover:bg-[#2b2b2b]"
                    >
                      下载 MP4
                    </a>
                  </div>
                </div>
                <p className="text-[9px] leading-4 text-[#a39d92]">
                  已按参考切点对齐，应用逐槽位色彩、运动、构图匹配与 7 项效果，并按当前混音导出。
                </p>
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-2">
                  <button
                    type="button"
                    onClick={() => void startExport()}
                    className="flex w-full items-center justify-between border border-[#161616] px-3 py-3 text-left hover:bg-[#faf9f6]"
                  >
                    <div>
                      <div className="text-[11px] text-[#161616]">1080p · H.264 · MP4</div>
                      <div className="font-mono text-[8px] text-[#8a857b]">
                        1920×1080 · 30fps · {bgm ? "BGM + 素材原声" : "素材原声"} · 智能匹配 {Math.round(matchSettings.strength * 100)}%
                      </div>
                    </div>
                    <RiCheckLine className="size-4 text-[#161616]" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => flash("4K 作为加分项，稍后开放")}
                    className="flex w-full items-center justify-between border border-[#ddd8cf] px-3 py-3 text-left hover:bg-[#faf9f6]"
                  >
                    <div>
                      <div className="text-[11px] text-[#6c675e]">4K · 硬件编码</div>
                      <div className="font-mono text-[8px] text-[#a39d92]">加分项 · 视硬件支持</div>
                    </div>
                    <span className="border border-[#e1ddd4] px-1.5 py-0.5 text-[8px] text-[#8a857b]">
                      BONUS
                    </span>
                  </button>
                </div>
                {exportError && (
                  <div className="mt-3 border-l-2 border-[#d9482b] bg-[#fbf3f0] px-2.5 py-2 text-[9px] leading-4 text-[#a33722]">
                    {exportError}
                  </div>
                )}
                <p className="mt-3 text-[9px] leading-4 text-[#a39d92]">
                  导出会使用当前时间线；生成后先给整片预览，再下载。
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 border border-[#161616] bg-[#161616] px-3.5 py-2 text-[10px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

function TrackLane({
  label,
  slots,
  selectedId,
  onSelect,
}: {
  label: string;
  slots: Slot[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const total = Math.max(1, slots.reduce((sum, slot) => sum + slotOutputDurationValue(slot), 0));
  return (
    <div className="flex items-center gap-2">
      <span className="w-4 font-mono text-[8px] text-[#a39d92]">{label}</span>
      <div className="flex h-7 flex-1 overflow-hidden border border-[#e1ddd4] bg-[#faf9f6]">
        {slots.map((slot) => (
          <button
            key={slot.id}
            type="button"
            onClick={() => onSelect(slot.id)}
            style={{ width: `${(slotOutputDurationValue(slot) / total) * 100}%` }}
            className={cn(
              "h-full border-r border-white/60 px-1 text-left text-[7px] last:border-r-0",
              selectedId === slot.id
                ? "bg-[#161616] text-white"
                : "bg-[#e9e5dc] text-[#6c675e] hover:bg-[#ddd8cf]",
            )}
            title={slot.label}
          >
            {slot.index + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

function slotOutputDurationValue(slot: Slot) {
  return Math.max(0.1, slot.duration);
}

function groupSlotsByTime(slots: Slot[], interval: number) {
  const groups = new Map<number, Slot[]>();
  for (const slot of slots) {
    const bucket = Math.floor(slot.start / interval);
    const list = groups.get(bucket) ?? [];
    list.push(slot);
    groups.set(bucket, list);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, items]) => ({
      key: `slot-group-${bucket}`,
      start: bucket * interval,
      end: (bucket + 1) * interval,
      slots: items,
    }));
}

function groupAssetsByTime(assets: MediaAsset[], interval: number) {
  const groups = new Map<number, MediaAsset[]>();
  for (const asset of assets) {
    const bucket = Math.floor((asset.sourceIn ?? 0) / interval);
    const list = groups.get(bucket) ?? [];
    list.push(asset);
    groups.set(bucket, list);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, items]) => ({
      key: `asset-group-${bucket}`,
      start: bucket * interval,
      end: (bucket + 1) * interval,
      items,
    }));
}

function TimelineRuler({ duration, zoom }: { duration: number; zoom: number }) {
  const safeDuration = Math.max(0.1, duration);
  const labelStep = zoom >= 6 ? 1 : zoom >= 3 ? 2 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= safeDuration + 0.001; t += 1) ticks.push(t);
  return (
    <div className="relative mb-1 h-5 border-b border-[#e1ddd4]">
      {ticks.map((t) => (
        <div
          key={t}
          className="absolute bottom-0 h-1.5 border-l border-[#c9c3b8]"
          style={{ left: `${(t / safeDuration) * 100}%` }}
        >
          {t % labelStep === 0 && (
            <span className="absolute bottom-1.5 left-0 -translate-x-1/2 whitespace-nowrap font-mono text-[8px] text-[#a39d92]">
              {formatTime(t)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function AssetPreviewModal({
  asset,
  onClose,
  onUse,
}: {
  asset: MediaAsset;
  onClose: () => void;
  onUse?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const start = asset.sourceIn ?? 0;
  const end = asset.sourceOut ?? asset.duration ?? 0;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || asset.kind === "image") return;
    video.currentTime = start;
    video.playbackRate = 1;
    void video.play().catch(() => undefined);
  }, [asset.id, start, asset.kind]);

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video || !end) return;
    if (video.currentTime >= end - 0.03) {
      video.currentTime = start;
    }
  }

  return (
    <div className="fixed inset-0 z-[108] flex items-center justify-center bg-[#161616]/50 p-4">
      <div className="w-full max-w-3xl border border-[#ddd8cf] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#eeeae1] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[12px] font-medium">{asset.name}</h2>
            <p className="mt-0.5 font-mono text-[9px] text-[#8a857b]">
              {formatTime(start, true)} → {formatTime(end, true)} ·{" "}
              {formatDurationLabel(Math.max(0, end - start))}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#8a857b] hover:text-[#161616]"
            aria-label="关闭素材预览"
          >
            <RiCloseLine className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="bg-black">
          {asset.kind === "image" ? (
            <img src={asset.url} alt="" className="mx-auto max-h-[60vh] w-auto object-contain" />
          ) : (
            <video
              ref={videoRef}
              src={asset.url}
              playsInline
              controls
              className="mx-auto max-h-[60vh] w-full object-contain"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={onTimeUpdate}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="text-[9px] text-[#8a857b]">
            预览会自动循环当前片段；拖到右侧镜头卡片即可替换。
          </div>
          <div className="flex items-center gap-2">
            {asset.kind !== "image" && (
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.paused) void video.play();
                  else video.pause();
                }}
                className="border border-[#ddd8cf] px-2.5 py-1.5 text-[10px] text-[#6c675e] hover:bg-[#f6f4ef]"
              >
                {playing ? "暂停" : "播放"}
              </button>
            )}
            {onUse && (
              <button
                type="button"
                onClick={onUse}
                className="bg-[#d9482b] px-3 py-1.5 text-[10px] font-medium text-white hover:bg-[#bd3d24]"
              >
                替换当前槽位
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}