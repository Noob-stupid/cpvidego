"use client";

import { useRef, useState } from "react";
import {
  RiAlertLine,
  RiCheckboxCircleLine,
  RiFlashlightLine,
  RiMagicLine,
  RiPulseLine,
  RiSettings3Line,
  RiSparklingLine,
} from "@remixicon/react";
import { AISettings } from "@/components/cpv/ai-settings";
import { GenerationPanel } from "@/components/cpv/generation-panel";
import { loadAIConfig, saveAIConfig } from "@/lib/cpv/ai/config";
import { runDirector } from "@/lib/cpv/ai/director";
import { localLibrary, pexelsLibrary } from "@/lib/cpv/ai/library";
import { applyProposal } from "@/lib/cpv/ai/plan";
import { createHttpProvider } from "@/lib/cpv/ai/provider";
import { tagAsset } from "@/lib/cpv/ai/tagging";
import { buildSourceProvider, loadSources } from "@/lib/cpv/ai/sources";
import { importFromSource } from "@/lib/cpv/ai/import";
import type { AIConfig, LibraryItem } from "@/lib/cpv/ai/types";
import { analyzeMixLevels } from "@/lib/cpv/audio-mix";
import { buildAssetFromFile } from "@/lib/cpv/asset-build";
import { detectBeatGrid, trimGridToFirstHit, type BeatGrid } from "@/lib/cpv/beat-grid";
import { beatPlanToSlots, buildStyleDraft, isUsableAsset, pickAssetForSlot, applyAssetToSlot } from "@/lib/cpv/draft";
import { detectBlackSlots } from "@/lib/cpv/slot-validate";
import { makeVideoThumbnails } from "@/lib/cpv/media";
import type { ShotTags } from "@/lib/cpv/types";
import { buildBeatPlan, fallbackGrid } from "@/lib/cpv/plan-beat";
import { evaluateDraft, summarizeReport } from "@/lib/cpv/plan-quality";
import { pickHighlightWindows, scanSourceWindows, type SourceWindow } from "@/lib/cpv/scan-source";
import type { AnalysisResult, BeatDensity, MediaAsset, Slot } from "@/lib/cpv/types";
import { useCPVStore } from "@/stores/cpv-store";
import { cn } from "@/lib/utils";

const DENSITY_LABELS: Record<BeatDensity, string> = {
  auto: "自动",
  half: "半拍",
  beat: "每拍",
  every2: "两拍",
  every4: "四拍",
};

const SOURCE_AUDIO_LIMIT = 80 * 1024 * 1024;

function analysisFromPlan(
  plan: ReturnType<typeof buildBeatPlan>,
  source: MediaAsset,
  grid: BeatGrid,
): AnalysisResult {
  return {
    duration: plan.duration,
    analyzedDuration: plan.duration,
    width: source.width ?? 1920,
    height: source.height ?? 1080,
    sampleFps: 0,
    cuts: plan.slots.slice(1).map((slot) => slot.start),
    shots: plan.slots.map((slot) => ({
      id: `beat_${slot.index}`,
      index: slot.index,
      start: slot.start,
      end: slot.end,
      duration: slot.duration,
      thumbnailUrl: "",
      diff: slot.strength,
      tags: [slot.role],
    })),
    bpm: grid.bpm > 0 ? Math.round(grid.bpm) : undefined,
    styleTags: ["单素材卡点", plan.stats.hits > 0 ? "重拍慢放" : "匀速切"],
  };
}

async function blobOf(asset: MediaAsset | null): Promise<Blob | null> {
  if (!asset) return null;
  if (asset.file) return asset.file;
  try {
    return await fetch(asset.url).then((response) => response.blob());
  } catch {
    return null;
  }
}

export function DraftPanel() {
  const editKind = useCPVStore((s) => s.editKind);
  const beatSettings = useCPVStore((s) => s.beatSettings);
  const assets = useCPVStore((s) => s.assets);
  const slots = useCPVStore((s) => s.slots);
  const bgm = useCPVStore((s) => s.bgm);
  const report = useCPVStore((s) => s.draftReport);
  const setEditKind = useCPVStore((s) => s.setEditKind);
  const setBeatSettings = useCPVStore((s) => s.setBeatSettings);
  const setDraftReport = useCPVStore((s) => s.setDraftReport);
  const setAudioSettings = useCPVStore((s) => s.setAudioSettings);
  const styleTarget = useCPVStore((s) => s.styleTarget);
  const setStyleTarget = useCPVStore((s) => s.setStyleTarget);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const windowsRef = useRef<SourceWindow[]>([]);
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => loadAIConfig());
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiLog, setAiLog] = useState<string[]>([]);
  const [aiSummary, setAiSummary] = useState("");
  const [aiReasons, setAiReasons] = useState<Record<string, string>>({});
  const [aiError, setAiError] = useState<string | null>(null);
  const [importSourceId, setImportSourceId] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);
  const [allowCrossSource, setAllowCrossSource] = useState(false);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagProgress, setTagProgress] = useState("");
  const [tagNote, setTagNote] = useState<string | null>(null);
  const registeredSources = loadSources();

  const videoAssets = (() => {
    const byFile = new Map<string, MediaAsset>();
    for (const asset of assets) {
      if (asset.origin !== "user" || asset.kind !== "video" || (asset.duration ?? 0) <= 1) continue;
      const key = asset.fileId ?? asset.name;
      const current = byFile.get(key);
      if (!current || (asset.sourceIn == null && current.sourceIn != null)) byFile.set(key, asset);
    }
    return [...byFile.values()];
  })();
  const source =
    videoAssets.find((asset) => asset.id === beatSettings.sourceAssetId) ?? videoAssets[0] ?? null;

  function publishReport(nextSlots: Slot[], grid: BeatGrid | null, offset: number) {
    const state = useCPVStore.getState();
    setDraftReport(
      evaluateDraft({
        slots: nextSlots,
        assets: state.assets,
        analysis: state.analysis,
        grid,
        beatOffset: offset,
        matchSettings: state.matchSettings,
        windows: grid ? windowsRef.current : undefined,
      }),
    );
  }

  async function runTagging() {
    if (tagBusy) return;
    if (!aiConfig.enabled) {
      setTagNote("先在「设置」启用 AI 并配置一个视觉模型");
      return;
    }
    const state = useCPVStore.getState();
    if (!state.reference) {
      setTagNote("先有参考片");
      return;
    }
    setTagBusy(true);
    setTagNote(null);
    try {
      const provider = createHttpProvider(aiConfig);
      setTagProgress("标注参考风格…");
      const refFrames = await makeVideoThumbnails(state.reference.url, [2, 6, 10, 14]);
      const target = await tagAsset(provider, state.reference, refFrames.filter(Boolean));
      setStyleTarget(target);
      const pool = state.assets.filter(
        (asset) => asset.origin === "user" && asset.kind === "video" && !asset.tags,
      );
      const cap = Math.min(pool.length, 24);
      for (let i = 0; i < cap; i += 1) {
        const asset = pool[i];
        setTagProgress(`${i + 1}/${cap} ${asset.name}`);
        const mid =
          asset.sourceIn != null
            ? (asset.sourceIn + (asset.sourceOut ?? asset.sourceIn + 1)) / 2
            : Math.min(1, (asset.duration ?? 2) * 0.3);
        const frames = await makeVideoThumbnails(asset.url, [mid]);
        const tags = await tagAsset(provider, asset, frames.filter(Boolean));
        useCPVStore.getState().updateAsset(asset.id, { tags });
      }
      setTagNote(`语义标签完成（参考风格 ${target.kind ?? "?"}），重跑一键初剪生效`);
    } catch (cause) {
      setTagNote(cause instanceof Error ? cause.message : "标注失败");
    } finally {
      setTagBusy(false);
      setTagProgress("");
    }
  }

  async function runStyleDraft() {
    const state = useCPVStore.getState();
    if (!state.analysis) {
      setError("先分析参考片");
      return;
    }
    if (!state.assets.some((asset) => asset.origin === "user")) {
      setError("先上传素材，或从参考片提取镜头");
      return;
    }
    setStage("智能选材与匹配");
    setProgress(0.2);
    windowsRef.current = [];
    const draft = buildStyleDraft(state.analysis, state.slots, state.assets, {
      allowCrossSource,
      useTags: Boolean(styleTarget),
      targetTags: styleTarget ?? undefined,
    });
    setStage("校验黑帧");
    const check = await detectBlackSlots(draft.slots, state.assets, (done, total) =>
      setProgress(0.3 + (done / total) * 0.25),
    );
    if (check.blackSlotIds.size && state.assets.some((asset) => asset.origin === "user")) {
      const scoped = state.assets.filter(
        (asset) =>
          asset.origin === "user" &&
          !check.blackAssetIds.has(asset.id) &&
          (allowCrossSource || !asset.sourceTag),
      );
      const pool = (scoped.length ? scoped : state.assets.filter((a) => a.origin === "user")).filter(
        isUsableAsset,
      );
      if (pool.length) {
        const usage = new Map<string, number>();
        for (const item of draft.slots) usage.set(item.assetId, (usage.get(item.assetId) ?? 0) + 1);
        const repaired = draft.slots.map((slot) => {
          if (!check.blackSlotIds.has(slot.id)) return slot;
          const asset = pickAssetForSlot(
            slot,
            pool,
            usage,
            styleTarget ? styleTarget : undefined,
          );
          usage.set(asset.id, (usage.get(asset.id) ?? 0) + 1);
          return applyAssetToSlot(slot, asset);
        });
        draft.slots = repaired;
        const recheck = await detectBlackSlots(repaired, state.assets);
        setTagNote(
          `已替换 ${check.blackSlotIds.size} 个黑场镜头${recheck.blackSlotIds.size ? `，仍剩 ${recheck.blackSlotIds.size} 个` : ""}`,
        );
      }
    }
    useCPVStore.setState({
      slots: draft.slots,
      editKind: "style",
      selectedSlotId: draft.slots[0]?.id ?? null,
      mode: "simple",
    });
    setStage("自动混音");
    setProgress(0.7);
    // 音乐驱动：素材原声默认关，避免对白拼贴盖过音乐床。
    setAudioSettings({ originalVolume: 0, autoBalance: true });
    const bedAsset =
      state.audioSettings.bed === "reference" ? state.reference : state.bgm;
    if (bedAsset && state.audioSettings.bed !== "none") {
      const mix = await analyzeMixLevels(draft.slots, state.assets, bedAsset, 0);
      if (mix) setAudioSettings({ bgmVolume: mix.suggestedBgmVolume });
    }
    publishReport(draft.slots, null, 0);
    setNotice(
      draft.skipped > 0
        ? `已跳过 ${draft.skipped} 个纯黑/死白素材，用了 ${draft.usedAssetCount} 条素材`
        : `用了 ${draft.usedAssetCount} 条素材铺满 ${draft.slots.length} 个镜头`,
    );
  }

  async function runBeatDraft() {
    const state = useCPVStore.getState();
    if (!source) {
      setError("先上传一条长视频素材");
      return;
    }
    const settings = state.beatSettings;
    const target = settings.targetDuration;

    setStage("读取音乐");
    setProgress(0.05);
    let music = await blobOf(state.bgm);
    let fromSource = false;
    if (!music) {
      const candidate = source.file ?? null;
      if (candidate && candidate.size <= SOURCE_AUDIO_LIMIT) {
        music = candidate;
        fromSource = true;
      } else if (!candidate && (source.size ?? 0) <= SOURCE_AUDIO_LIMIT) {
        music = await blobOf(source);
        fromSource = music != null;
      }
    }

    setStage("检测节拍");
    setProgress(0.15);
    let grid = music
      ? await detectBeatGrid(music, {
          maxSeconds: target + 12,
          bpmHint: state.analysis?.bpm,
        })
      : null;
    if (!grid || grid.beats.length < 4) {
      grid = fallbackGrid(target + 4, 0.5);
      setNotice("未检测到稳定节拍，已按 120 BPM 网格排片");
    } else {
      grid = trimGridToFirstHit(grid);
      setNotice(
        fromSource
          ? `跟着素材原声卡点：${Math.round(grid.bpm)} BPM`
          : `跟着 BGM 卡点：${Math.round(grid.bpm)} BPM`,
      );
    }
    const musicStart =
      settings.musicStart > 0
        ? settings.musicStart
        : Math.max(0, (grid.beats[0] ?? 0) - 0.3);

    let windows: SourceWindow[] = [];
    if (settings.scanHighlights && (source.duration ?? 0) > 2) {
      setStage("扫描素材高光");
      const scanned = await scanSourceWindows(source.url, {
        duration: source.duration ?? target,
        sampleFps: 1.5,
        window: 1.2,
        onProgress: (value) => setProgress(0.2 + value * 0.45),
      });
      windows = pickHighlightWindows(scanned, 60);
    }
    windowsRef.current = windows;

    setStage("按节拍排片");
    setProgress(0.7);
    const plan = buildBeatPlan(
      grid,
      {
        targetDuration: target,
        sourceDuration: source.duration ?? target,
        density: settings.density,
        slowmo: settings.slowmo,
        leadIn: settings.leadIn,
        effectScale: settings.effectScale,
        musicStart,
      },
      windows,
    );
    const nextSlots = beatPlanToSlots(plan, source);
    useCPVStore.setState({
      slots: nextSlots,
      analysis: analysisFromPlan(plan, source, grid),
      editKind: "beat",
      beatGrid: grid,
      selectedSlotId: nextSlots[0]?.id ?? null,
      mode: "simple",
    });
    setBeatSettings({ sourceAssetId: source.id, musicStart });
    setAudioSettings({
      bed: "bgm",
      originalVolume: state.bgm ? 0 : 1,
      bgmOffset: musicStart,
    });

    setStage("生成镜头缩略图");
    const thumbSlots = nextSlots.slice(0, 24);
    const thumbs = await makeVideoThumbnails(
      source.url,
      thumbSlots.map((slot) => slot.sourceIn + 0.05),
      (done, total) => setProgress(0.75 + (done / total) * 0.2),
    );
    const store = useCPVStore.getState();
    thumbSlots.forEach((slot, index) => {
      if (thumbs[index]) store.updateSlot(slot.id, { thumbnailUrl: thumbs[index] });
    });

    publishReport(useCPVStore.getState().slots, grid, musicStart);
    setNotice(
      `${plan.slots.length} 个镜头 · 慢放 ${plan.stats.hits} 段 · 冲刺 ${plan.stats.leads} 段 · 速度 ${plan.stats.slowest}–${plan.stats.fastest}×`,
    );
  }

  async function runImport() {
    if (importBusy) return;
    const config = registeredSources.find((source) => source.id === importSourceId);
    const provider = config ? buildSourceProvider(config) : null;
    if (!provider) {
      setImportNote("先在「设置 → 可接入素材源」登记一个源");
      return;
    }
    setImportBusy(true);
    setImportNote(null);
    try {
      const existing = new Set(
        useCPVStore.getState().assets.map((asset) => asset.name.replace(/\.[^.]+$/, "")),
      );
      const result = await importFromSource(provider, {
        limit: 20,
        existingNames: existing,
        onProgress: (done, total, name) => setImportProgress(`${done}/${total} ${name}`),
      });
      for (const asset of result.assets) useCPVStore.getState().addAsset(asset);
      setImportNote(
        `导入 ${result.assets.length} 条素材${result.skipped.length ? `，跳过 ${result.skipped.length} 条` : ""}，已可参与一键初剪`,
      );
    } catch (cause) {
      setImportNote(cause instanceof Error ? cause.message : "导入失败");
    } finally {
      setImportBusy(false);
      setImportProgress("");
    }
  }

  function currentReport() {
    const state = useCPVStore.getState();
    return evaluateDraft({
      slots: state.slots,
      assets: state.assets,
      analysis: state.analysis,
      matchSettings: state.matchSettings,
      grid: state.beatGrid,
      beatOffset: state.beatSettings.musicStart,
      windows: state.beatGrid ? windowsRef.current : undefined,
    });
  }

  async function runAI() {
    if (aiBusy) return;
    const state = useCPVStore.getState();
    if (!state.analysis || !state.slots.length) {
      setAiError("先有一版时间线（分析参考片或生成初剪）再让 AI 指导");
      return;
    }
    setAiBusy(true);
    setAiError(null);
    setAiLog([]);
    setAiSummary("");
    setAiReasons({});
    const local = localLibrary(state.assets);
    const pexels = pexelsLibrary();
    const registered = loadSources()
      .map((config) => buildSourceProvider(config))
      .filter((provider): provider is NonNullable<typeof provider> => provider != null);
    const providerById = new Map<
      string,
      {
        list(query?: string, limit?: number): Promise<LibraryItem[]>;
        resolve?(item: LibraryItem): Promise<Blob | null>;
      }
    >([
      ["local", local],
      ["pexels", pexels],
      ...registered.map((provider) => [provider.id, provider] as const),
    ]);
    const task =
      state.editKind === "beat"
        ? "当前是单素材卡点时间线。请在保持卡点结构与慢放/冲刺节奏的前提下，优化效果分布与混音，必要时微调速；不要破坏切点对齐。"
        : "当前是风格复刻时间线。请按参考片风格为每个槽位挑选最合适的素材并分配克制的效果，给出中文理由，最后自检体检分。";
    try {
      const result = await runDirector(
        {
          provider: createHttpProvider(aiConfig),
          styleProfile: () => {
            const analysis = useCPVStore.getState().analysis;
            if (!analysis) return {};
            const shots = analysis.shots;
            const avg = shots.length
              ? shots.reduce((sum, shot) => sum + shot.duration, 0) / shots.length
              : 0;
            return {
              editKind: useCPVStore.getState().editKind,
              bpm: analysis.bpm,
              cuts: analysis.cuts.length,
              shots: shots.length,
              avgShot: Math.round(avg * 100) / 100,
              styleTags: analysis.styleTags,
            };
          },
          listMaterials: ({ query, source, limit }) =>
            (providerById.get(source ?? "local") ?? local).list(query, limit),
          timeline: () => useCPVStore.getState().slots,
          apply: (proposal) => {
            const current = useCPVStore.getState();
            const applied = applyProposal(current.slots, current.assets, proposal);
            useCPVStore.setState({ slots: applied.slots });
            if (proposal.audio) setAudioSettings(proposal.audio);
            const report = currentReport();
            setDraftReport(report);
            setAiReasons((prev) => ({ ...prev, ...applied.reasons }));
            return {
              report,
              reasons: applied.reasons,
              applied: applied.applied,
              rejected: applied.rejected,
            };
          },
          evaluate: () => currentReport(),
          importItem: async (item) => {
            const provider = providerById.get(item.id.split(":")[0]);
            const blob = provider?.resolve
              ? await provider.resolve(item)
              : item.fileUrl
                ? await fetch(item.fileUrl).then((response) => response.blob())
                : null;
            if (!blob) return null;
            const file = new File([blob], `${item.id.replace(/[^\w-]/g, "_")}.mp4`, {
              type: "video/mp4",
            });
            const asset = {
              ...(await buildAssetFromFile(file)),
              id: item.id,
              sourceTag: item.id.split(":")[0],
            };
            useCPVStore.getState().addAsset(asset);
            return asset;
          },
        },
        task,
        (event) => {
          if (event.type === "error") return;
          setAiLog((prev) => [...prev.slice(-40), event.message]);
        },
      );
      setAiSummary(result.summary);
      setAiReasons(result.reasons);
      setDraftReport(currentReport());
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : "AI 导演失败");
    } finally {
      setAiBusy(false);
    }
  }

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (editKind === "beat") await runBeatDraft();
      else await runStyleDraft();
      setProgress(1);
      setStage("完成");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成初剪失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <section className="site-surface">
      <div className="flex items-center justify-between gap-2">
        <div className="site-heading flex items-center gap-1.5 text-[11px] font-medium">
          <RiMagicLine className="size-3.5" aria-hidden="true" />
          一键初剪
        </div>
        <div className="flex border border-[#ddd8cf]">
          <button
            type="button"
            onClick={() => setEditKind("style")}
            className={cn(
              "px-2 py-1 text-[9px]",
              editKind === "style" ? "bg-[#161616] text-white" : "text-[#6c675e]",
            )}
          >
            风格复刻
          </button>
          <button
            type="button"
            onClick={() => setEditKind("beat")}
            className={cn(
              "border-l border-[#ddd8cf] px-2 py-1 text-[9px]",
              editKind === "beat" ? "bg-[#161616] text-white" : "text-[#6c675e]",
            )}
          >
            单素材卡点
          </button>
        </div>
      </div>

      <p className="mt-1.5 text-[9px] leading-relaxed text-[#8a857b]">
        {editKind === "style"
          ? "按参考片切点自动选材、匹配色彩构图、分配效果并平衡混音。"
          : "一条长素材 + 音乐：自动找高光、按拍切点、重拍慢放、前一拍冲刺。"}
      </p>
      {editKind === "style" && (
        <label className="mt-1 flex items-center gap-1.5 text-[9px] text-[#6c675e]">
          <input
            type="checkbox"
            checked={allowCrossSource}
            onChange={(event) => setAllowCrossSource(event.target.checked)}
            className="accent-[#161616]"
          />
          允许跨源/跨风格素材（默认仅用本地同批素材，保证风格统一）
        </label>
      )}

      {editKind === "beat" && (
        <div className="mt-2 space-y-2 border-t border-[#eee9e0] pt-2">
          <label className="block text-[9px] text-[#6c675e]">
            素材
            <select
              value={source?.id ?? ""}
              onChange={(event) => setBeatSettings({ sourceAssetId: event.target.value })}
              className="mt-1 w-full border border-[#ddd8cf] bg-white px-2 py-1 text-[10px]"
            >
              {videoAssets.length === 0 && <option value="">还没有长视频素材</option>}
              {videoAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name.replace(/\s*·\s*镜头\s*\d+$/, "")} · 全片{" "}
                  {Math.round(asset.duration ?? 0)}s
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[9px] text-[#6c675e]">
              成片时长
              <select
                value={beatSettings.targetDuration}
                onChange={(event) =>
                  setBeatSettings({ targetDuration: Number(event.target.value) })
                }
                className="mt-1 w-full border border-[#ddd8cf] bg-white px-2 py-1 text-[10px]"
              >
                {[15, 30, 45, 60].map((value) => (
                  <option key={value} value={value}>
                    {value}s
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[9px] text-[#6c675e]">
              切点密度
              <select
                value={beatSettings.density}
                onChange={(event) =>
                  setBeatSettings({ density: event.target.value as BeatDensity })
                }
                className="mt-1 w-full border border-[#ddd8cf] bg-white px-2 py-1 text-[10px]"
              >
                {(Object.keys(DENSITY_LABELS) as BeatDensity[]).map((key) => (
                  <option key={key} value={key}>
                    {DENSITY_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-[9px] text-[#6c675e]">
            <span className="flex items-center justify-between">
              <span className="flex items-center gap-1">
                <RiPulseLine className="size-3" aria-hidden="true" />
                重拍慢放
              </span>
              <span className="font-mono">{Math.round(beatSettings.slowmo * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(beatSettings.slowmo * 100)}
              onChange={(event) => setBeatSettings({ slowmo: Number(event.target.value) / 100 })}
              className="mt-1 w-full accent-[#161616]"
            />
          </label>

          <label className="block text-[9px] text-[#6c675e]">
            <span className="flex items-center justify-between">
              <span className="flex items-center gap-1">
                <RiFlashlightLine className="size-3" aria-hidden="true" />
                拍前冲刺
              </span>
              <span className="font-mono">{Math.round(beatSettings.leadIn * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(beatSettings.leadIn * 100)}
              onChange={(event) => setBeatSettings({ leadIn: Number(event.target.value) / 100 })}
              className="mt-1 w-full accent-[#161616]"
            />
          </label>

          <label className="flex items-center gap-1.5 text-[9px] text-[#6c675e]">
            <input
              type="checkbox"
              checked={beatSettings.scanHighlights}
              onChange={(event) => setBeatSettings({ scanHighlights: event.target.checked })}
              className="accent-[#161616]"
            />
            扫描全片挑高光（长素材更慢，但不会反复用同一段）
          </label>
          {!bgm && (
            <p className="text-[9px] text-[#a39d92]">
              未选 BGM：将跟随素材原声卡点，变速段自动静音避免变调。
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || (editKind === "beat" && !source)}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 bg-[#161616] px-3 py-2 text-[11px] font-medium text-white hover:bg-[#2b2b2b] disabled:opacity-40"
      >
        <RiMagicLine className="size-3.5" aria-hidden="true" />
        {busy ? stage || "生成中" : editKind === "beat" ? "生成卡点初剪" : "生成风格初剪"}
      </button>

      {busy && (
        <div className="mt-1.5 h-1 w-full bg-[#eee9e0]">
          <div
            className="h-1 bg-[#161616] transition-all"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}

      {error && (
        <p className="mt-1.5 flex items-start gap-1 text-[9px] text-[#b4442c]">
          <RiAlertLine className="mt-px size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {!error && notice && <p className="mt-1.5 text-[9px] text-[#6c675e]">{notice}</p>}

      <div className="mt-2 border-t border-[#eee9e0] pt-2">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-[9px] text-[#6c675e]">
            <input
              type="checkbox"
              checked={aiConfig.enabled}
              onChange={(event) => {
                const next = { ...aiConfig, enabled: event.target.checked };
                setAiConfig(next);
                saveAIConfig(next);
              }}
              className="accent-[#161616]"
            />
            <RiSparklingLine className="size-3" aria-hidden="true" />
            AI 导演指导
          </label>
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="flex items-center gap-1 text-[9px] text-[#8a857b] hover:text-[#161616]"
          >
            <RiSettings3Line className="size-3" aria-hidden="true" />
            设置
          </button>
        </div>
        {aiConfig.enabled && (
          <>
            <button
              type="button"
              onClick={() => void runAI()}
              disabled={aiBusy}
              className="mt-1.5 flex w-full items-center justify-center gap-1.5 border border-[#161616] bg-white px-3 py-1.5 text-[10px] text-[#161616] hover:bg-[#f6f4ef] disabled:opacity-40"
            >
              <RiSparklingLine className="size-3.5" aria-hidden="true" />
              {aiBusy ? "AI 导演工作中…" : "让 AI 导演优化这一版"}
            </button>
            <button
              type="button"
              onClick={() => void runTagging()}
              disabled={tagBusy}
              className="mt-1 flex w-full items-center justify-center gap-1.5 border border-[#ddd8cf] bg-white px-3 py-1.5 text-[10px] text-[#161616] hover:bg-[#f6f4ef] disabled:opacity-40"
            >
              <RiPulseLine className="size-3.5" aria-hidden="true" />
              {tagBusy ? "语义标注中…" : "语义标签（VLM 风格/实拍/黑边）"}
            </button>
            {tagProgress && (
              <p className="mt-1 truncate font-mono text-[8px] text-[#a39d92]">{tagProgress}</p>
            )}
            {tagNote && <p className="mt-1 text-[9px] text-[#6c675e]">{tagNote}</p>}
            {styleTarget && (
              <p className="mt-1 text-[8px] text-[#a39d92]">
                目标风格：{styleTarget.kind ?? "?"} · 景别 {styleTarget.shotSize ?? "?"}
                {styleTarget.subject ? ` · ${styleTarget.subject}` : ""}
              </p>
            )}
            {aiLog.length > 0 && (
              <p className="mt-1 truncate font-mono text-[8px] text-[#a39d92]">
                {aiLog[aiLog.length - 1]}
              </p>
            )}
            {aiError && <p className="mt-1 text-[9px] text-[#b4442c]">{aiError}</p>}
            {aiSummary && <p className="mt-1 text-[9px] leading-4 text-[#6c675e]">{aiSummary}</p>}
            {Object.keys(aiReasons).length > 0 && (
              <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
                {Object.entries(aiReasons)
                  .slice(0, 8)
                  .map(([slotId, reason]) => (
                    <li key={slotId} className="text-[8px] text-[#8a857b]">
                      · {reason}
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
      </div>

      {registeredSources.length > 0 && (
        <div className="mt-2 border-t border-[#eee9e0] pt-2">
          <div className="text-[9px] text-[#6c675e]">从素材源补充（GitHub / 远程清单）</div>
          <div className="mt-1 flex gap-1.5">
            <select
              value={importSourceId}
              onChange={(event) => setImportSourceId(event.target.value)}
              className="min-w-0 flex-1 border border-[#ddd8cf] bg-white px-1.5 py-1 text-[9px]"
            >
              <option value="">选择素材源</option>
              {registeredSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label} · {source.url}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={importBusy || !importSourceId}
              className="border border-[#161616] bg-white px-2 py-1 text-[9px] disabled:opacity-40"
            >
              {importBusy ? "导入中…" : "导入视频"}
            </button>
          </div>
          {importProgress && (
            <p className="mt-1 truncate font-mono text-[8px] text-[#a39d92]">{importProgress}</p>
          )}
          {importNote && <p className="mt-1 text-[9px] text-[#6c675e]">{importNote}</p>}
        </div>
      )}

      <GenerationPanel />

      {report && !busy && (
        <div className="mt-2 border-t border-[#eee9e0] pt-2">
          <div className="flex items-center justify-between text-[9px]">
            <span className="flex items-center gap-1 text-[#6c675e]">
              <RiCheckboxCircleLine className="size-3" aria-hidden="true" />
              初剪体检
            </span>
            <span
              className={cn(
                "font-mono",
                report.score >= 85
                  ? "text-[#1f5c4a]"
                  : report.score >= 65
                    ? "text-[#8a6d1f]"
                    : "text-[#b4442c]",
              )}
            >
              {report.score}/100
            </span>
          </div>
          <p className="mt-1 text-[9px] text-[#8a857b]">{summarizeReport(report)}</p>
          {report.issues.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {report.issues.slice(0, 4).map((issue) => (
                <li
                  key={issue.code}
                  className={cn(
                    "text-[9px]",
                    issue.level === "error"
                      ? "text-[#b4442c]"
                      : issue.level === "warn"
                        ? "text-[#8a6d1f]"
                        : "text-[#a39d92]",
                  )}
                >
                  · {issue.message}
                </li>
              ))}
            </ul>
          )}
          {slots.length === 0 && (
            <p className="mt-1 text-[9px] text-[#a39d92]">时间线还是空的。</p>
          )}
        </div>
      )}
    </section>
    <AISettings
      open={aiOpen}
      config={aiConfig}
      onClose={() => setAiOpen(false)}
      onSave={(next) => setAiConfig(next)}
    />
    </>
  );
}
