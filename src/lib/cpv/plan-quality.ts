import { scaleColorGrade } from "./color-match";
import { effectCount } from "./effects";
import type { BeatGrid } from "./beat-grid";
import type { SourceWindow } from "./scan-source";
import type { AnalysisResult, MatchSettings, MediaAsset, Slot } from "./types";
import { DEFAULT_MATCH_SETTINGS } from "./types";

export type IssueLevel = "error" | "warn" | "info";

export interface DraftIssue {
  level: IssueLevel;
  code: string;
  message: string;
}

export interface DraftMetrics {
  slotCount: number;
  duration: number;
  gaps: number;
  overlaps: number;
  cutDrift: number;
  colorResidual: number;
  styleResidual: number;
  distinctAssets: number;
  maxRepeat: number;
  blankRisk: number;
  effectRate: number;
  flashPerSecond: number;
  beatHitRate: number | null;
  slowmoShare: number;
  speedMin: number;
  speedMax: number;
  mutedShare: number;
}

export interface DraftReport {
  score: number;
  metrics: DraftMetrics;
  issues: DraftIssue[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function predictedStats(slot: Slot, asset: MediaAsset | undefined, strength: number) {
  if (!slot.targetColor || !slot.colorGrade || !asset?.colorStats) return null;
  const grade = scaleColorGrade(slot.colorGrade, strength);
  const source = asset.colorStats;
  const luma = clamp(((source.luma - 128) * grade.contrast + 128) * grade.brightness, 0, 255);
  const saturation = clamp(source.saturation * grade.saturate, 0, 1);
  return {
    luma: Math.abs(luma - slot.targetColor.luma) / 255,
    saturation: Math.abs(saturation - slot.targetColor.saturation),
  };
}

export function evaluateDraft(input: {
  slots: Slot[];
  assets: MediaAsset[];
  analysis?: AnalysisResult | null;
  grid?: BeatGrid | null;
  beatOffset?: number;
  targetDuration?: number;
  matchSettings?: MatchSettings;
  windows?: SourceWindow[];
}): DraftReport {
  const { slots, assets, analysis, grid } = input;
  const matchSettings = input.matchSettings ?? DEFAULT_MATCH_SETTINGS;
  const issues: DraftIssue[] = [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const duration = slots.length ? Math.max(...slots.map((slot) => slot.end)) : 0;
  const target = input.targetDuration ?? analysis?.analyzedDuration ?? duration;
  let gaps = 0;
  let overlaps = 0;
  for (let i = 1; i < slots.length; i += 1) {
    const delta = slots[i].start - slots[i - 1].end;
    if (delta > 0.02) gaps += 1;
    else if (delta < -0.02) overlaps += 1;
  }

  let cutDrift = 0;
  if (analysis?.shots.length) {
    const shotById = new Map(analysis.shots.map((shot) => [shot.id, shot]));
    for (const slot of slots) {
      const shot = shotById.get(slot.shotId);
      if (!shot) continue;
      cutDrift = Math.max(cutDrift, Math.abs(slot.start - shot.start), Math.abs(slot.end - shot.end));
    }
  }

  let residualSum = 0;
  let residualCount = 0;
  let styleSum = 0;
  let styleCount = 0;
  const shotColors = (analysis?.shots ?? [])
    .map((shot) => shot.colorStats)
    .filter((stats): stats is NonNullable<typeof stats> => Boolean(stats));
  const aggregate = shotColors.length
    ? {
        luma: shotColors.reduce((sum, s) => sum + s.luma, 0) / shotColors.length,
        saturation: shotColors.reduce((sum, s) => sum + s.saturation, 0) / shotColors.length,
        contrast: shotColors.reduce((sum, s) => sum + s.contrast, 0) / shotColors.length,
      }
    : null;
  let blankRisk = 0;
  let effectTotal = 0;
  let flashCount = 0;
  let slowmo = 0;
  let muted = 0;
  let speedMin = Number.POSITIVE_INFINITY;
  let speedMax = 0;
  const usage = new Map<string, number>();

  for (const slot of slots) {
    const asset = assetById.get(slot.assetId);
    usage.set(slot.assetId, (usage.get(slot.assetId) ?? 0) + 1);
    const residual = predictedStats(slot, asset, matchSettings.strength);
    if (residual) {
      residualSum += residual.luma * 0.7 + residual.saturation * 0.3;
      residualCount += 1;
    }
    if (aggregate && asset?.colorStats) {
      styleSum +=
        (Math.abs(asset.colorStats.luma - aggregate.luma) / 255) * 0.5 +
        Math.abs(asset.colorStats.saturation - aggregate.saturation) * 0.3 +
        (Math.abs(asset.colorStats.contrast - aggregate.contrast) / 80) * 0.2;
      styleCount += 1;
    }
    const window = input.windows?.find(
      (item) => slot.sourceIn >= item.start - 0.05 && slot.sourceIn < item.end + 0.05,
    );
    if (input.windows?.length) {
      if (window && (window.luma < 16 || (window.luma > 238 && window.saturation < 0.06))) {
        blankRisk += 1;
      }
    } else if (!grid && asset?.colorStats && asset.sourceIn != null) {
      const { luma, saturation } = asset.colorStats;
      if (luma < 12 || (luma > 242 && saturation < 0.04)) blankRisk += 1;
    }
    effectTotal += effectCount(slot.effects);
    if ((slot.effects?.flash ?? 0) > 0.25) flashCount += 1;
    if (slot.speed < 0.92) slowmo += 1;
    if ((slot.volume ?? 1) < 0.05) muted += 1;
    speedMin = Math.min(speedMin, slot.speed);
    speedMax = Math.max(speedMax, slot.speed);
  }

  let beatHitRate: number | null = null;
  if (grid && grid.beats.length && slots.length > 1) {
    const offset = input.beatOffset ?? 0;
    let hits = 0;
    let checked = 0;
    for (const slot of slots.slice(1)) {
      const time = slot.start + offset;
      const distance = Math.min(...grid.beats.map((beat) => Math.abs(beat - time)));
      checked += 1;
      if (distance <= 0.08) hits += 1;
    }
    beatHitRate = checked ? hits / checked : null;
  }

  const metrics: DraftMetrics = {
    slotCount: slots.length,
    duration: Math.round(duration * 1000) / 1000,
    gaps,
    overlaps,
    cutDrift: Math.round(cutDrift * 1000) / 1000,
    colorResidual: residualCount ? Math.round((residualSum / residualCount) * 1000) / 1000 : 0,
    styleResidual: styleCount ? Math.round((styleSum / styleCount) * 1000) / 1000 : 0,
    distinctAssets: usage.size,
    maxRepeat: usage.size ? Math.max(...usage.values()) : 0,
    blankRisk,
    effectRate: duration > 0 ? Math.round((effectTotal / duration) * 100) / 100 : 0,
    flashPerSecond: duration > 0 ? Math.round((flashCount / duration) * 100) / 100 : 0,
    beatHitRate: beatHitRate == null ? null : Math.round(beatHitRate * 100) / 100,
    slowmoShare: slots.length ? Math.round((slowmo / slots.length) * 100) / 100 : 0,
    speedMin: Number.isFinite(speedMin) ? Math.round(speedMin * 100) / 100 : 1,
    speedMax: Math.round(speedMax * 100) / 100,
    mutedShare: slots.length ? Math.round((muted / slots.length) * 100) / 100 : 0,
  };

  if (!slots.length) issues.push({ level: "error", code: "empty", message: "时间线没有镜头" });
  if (gaps) issues.push({ level: "error", code: "gap", message: `${gaps} 处时间线空洞，导出会黑屏` });
  if (overlaps) issues.push({ level: "warn", code: "overlap", message: `${overlaps} 处镜头重叠` });
  if (Math.abs(duration - target) > 0.25 && target > 0) {
    issues.push({
      level: "warn",
      code: "duration",
      message: `成片 ${metrics.duration}s 与目标 ${Math.round(target * 10) / 10}s 不一致`,
    });
  }
  if (cutDrift > 0.05) {
    issues.push({ level: "error", code: "drift", message: `切点漂移 ${metrics.cutDrift}s` });
  }
  if (blankRisk) {
    issues.push({ level: "warn", code: "blank", message: `${blankRisk} 个镜头接近纯黑/纯白` });
  }
  if (metrics.colorResidual > 0.14) {
    issues.push({ level: "warn", code: "color", message: `色彩残差 ${metrics.colorResidual}，与参考片偏离` });
  }
  if (metrics.styleResidual > 0.22) {
    issues.push({
      level: "warn",
      code: "style",
      message: `素材整体风格与参考偏离 ${metrics.styleResidual}，建议换同风格素材`,
    });
  }
  if (metrics.flashPerSecond > 2.6) {
    issues.push({ level: "warn", code: "strobe", message: `闪白 ${metrics.flashPerSecond} 次/秒，有频闪风险` });
  }
  if (metrics.effectRate > 3.2) {
    issues.push({ level: "warn", code: "overfx", message: `效果密度 ${metrics.effectRate}/秒，观感会脏` });
  }
  if (
    !grid &&
    slots.length > 6 &&
    metrics.maxRepeat > Math.ceil(slots.length / Math.max(1, metrics.distinctAssets)) + 2
  ) {
    issues.push({ level: "warn", code: "repeat", message: `同一素材最多用了 ${metrics.maxRepeat} 次` });
  }
  if (metrics.speedMax > 4) {
    issues.push({ level: "warn", code: "speed", message: `最快 ${metrics.speedMax}×，观感会像快进丢帧` });
  }
  if (metrics.speedMin < 0.2) {
    issues.push({ level: "warn", code: "slow", message: `最慢 ${metrics.speedMin}×，接近静止` });
  }
  if (beatHitRate != null && beatHitRate < 0.6) {
    issues.push({ level: "warn", code: "beat", message: `卡点命中率 ${Math.round(beatHitRate * 100)}%` });
  }
  if (metrics.mutedShare > 0.9 && metrics.slotCount > 4) {
    issues.push({ level: "info", code: "muted", message: "几乎全部原声静音，成片依赖 BGM" });
  }

  const penalty =
    issues.filter((issue) => issue.level === "error").length * 26 +
    issues.filter((issue) => issue.level === "warn").length * 9;
  const score = clamp(Math.round(100 - penalty - metrics.colorResidual * 60), 0, 100);

  return { score, metrics, issues };
}

export function summarizeReport(report: DraftReport) {
  const { metrics } = report;
  const parts = [
    `${metrics.slotCount} 镜头`,
    `${metrics.duration}s`,
    `${metrics.distinctAssets} 素材`,
    `色彩残差 ${metrics.colorResidual}`,
  ];
  if (metrics.beatHitRate != null) parts.push(`卡点 ${Math.round(metrics.beatHitRate * 100)}%`);
  if (metrics.slowmoShare > 0) parts.push(`慢放 ${Math.round(metrics.slowmoShare * 100)}%`);
  return parts.join(" · ");
}
