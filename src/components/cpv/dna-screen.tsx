"use client";

import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiFlashlightLine,
  RiMusic2Line,
  RiScissorsCutLine,
  RiSparklingLine,
  RiTimeLine,
} from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";
import { Brand, StepPill } from "@/components/cpv/brand";
import { formatDurationLabel, formatTime } from "@/lib/cpv/media";
import { useCPVStore } from "@/stores/cpv-store";
import { useLibraryStore } from "@/stores/library-store";

export function DnaScreen() {
  const analysis = useCPVStore((s) => s.analysis);
  const reference = useCPVStore((s) => s.reference);
  const setStep = useCPVStore((s) => s.setStep);
  const reset = useCPVStore((s) => s.reset);

  async function goHome() {
    await useLibraryStore.getState().saveCurrentProject();
    await useLibraryStore.getState().refreshProjects();
    setStep("home");
  }

  if (!analysis) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#f4f2ec] text-[#6c675e]">
        <p className="text-[13px]">这次分析没有留下结果。</p>
        <button
          type="button"
          onClick={reset}
          className="border border-[#161616] bg-[#161616] px-3 py-2 text-[11px] text-white"
        >
          重新选择参考片
        </button>
      </div>
    );
  }

  const averageShot =
    analysis.shots.reduce((sum, shot) => sum + shot.duration, 0) / Math.max(1, analysis.shots.length);

  return (
    <div className="min-h-dvh bg-[#f4f2ec] text-[#161616]">
      <header className="flex items-center justify-between border-b border-[#e1ddd4] px-6 py-4 md:px-10">
        <div className="flex items-center gap-5">
          <Brand compact />
          <div>
            <div className="text-[12px] font-medium">分析结果</div>
            <div className="mt-0.5 text-[10px] text-[#8a857b]">
              {reference?.name} · 分析 {formatDurationLabel(analysis.analyzedDuration)}
            </div>
          </div>
        </div>
        <div className="hidden items-center gap-6 md:flex">
          <StepPill done>01 参考片</StepPill>
          <StepPill done>02 分析</StepPill>
          <StepPill active>03 槽位编辑</StepPill>
          <StepPill>04 导出</StepPill>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void goHome()}
            className="border border-[#ddd8cf] bg-white px-3 py-1.5 text-[10px] text-[#6c675e] hover:bg-[#f6f4ef]"
          >
            项目库
          </button>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 border border-[#ddd8cf] bg-white px-3 py-1.5 text-[10px] text-[#6c675e] hover:bg-[#f6f4ef]"
          >
            <RiArrowLeftLine className="size-3.5" aria-hidden="true" />
            新建项目
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-16 pt-10 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#8a857b]">
              <span className="size-1.5 bg-[#d9482b]" />
              Analysis
            </div>
            <h1 className="mt-3 text-balance text-[30px] font-medium leading-tight tracking-tight sm:text-[34px]">
              切点与节拍
            </h1>
            <p className="mt-3 max-w-xl text-pretty text-[11px] leading-6 text-[#6c675e]">
              共 {analysis.shots.length} 个镜头、{analysis.cuts.length} 个切点。进入编辑器替换素材。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStep("editor")}
            className="flex items-center gap-2 bg-[#161616] px-4 py-2.5 text-[11px] font-medium text-white hover:bg-[#2b2b2b] active:scale-[0.995]"
          >
            打开编辑器
            <RiArrowRightLine className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-8 grid grid-cols-2 border border-[#ddd8cf] bg-white md:grid-cols-4">
          <DnaMetric
            icon={RiMusic2Line}
            label="BPM"
            value={analysis.bpm ? String(analysis.bpm) : "—"}
            hint="背景音乐速度"
            divider
          />
          <DnaMetric
            icon={RiScissorsCutLine}
            label="切点"
            value={String(analysis.cuts.length)}
            hint={`平均镜头 ${formatDurationLabel(averageShot)}`}
            divider
          />
          <DnaMetric
            icon={RiTimeLine}
            label="镜头数"
            value={String(analysis.shots.length)}
            hint={`采样 ${analysis.sampleFps}fps`}
            divider
          />
          <DnaMetric
            icon={RiSparklingLine}
            label="踩点率"
            value={
              analysis.beatAlignment != null ? `${Math.round(analysis.beatAlignment * 100)}%` : "—"
            }
            hint="切点落在节拍附近"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border border-[#ddd8cf] bg-white p-3.5">
          <div className="mr-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[#8a857b]">
            <RiFlashlightLine className="size-3.5" aria-hidden="true" />
            风格标签
          </div>
          {analysis.styleTags.map((tag) => (
            <span
              key={tag}
              className="border border-[#d9482b]/25 bg-[#fbf3f0] px-2 py-0.5 text-[10px] text-[#a33722]"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-10">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="text-[11px] font-medium">参考镜头</div>
              <div className="mt-0.5 text-[10px] text-[#8a857b]">每个镜头会变成一个可替换槽位</div>
            </div>
            <div className="font-mono text-[10px] text-[#a39d92]">{analysis.shots.length} shots</div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {analysis.shots.map((shot) => (
              <article
                key={shot.id}
                className="group overflow-hidden border border-[#e1ddd4] bg-white transition-colors hover:border-[#161616]/40"
              >
                <div className="relative aspect-video overflow-hidden bg-[#f0ede6]">
                  {shot.thumbnailUrl ? (
                    <img
                      src={shot.thumbnailUrl}
                      alt={`镜头 ${shot.index + 1}`}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[9px] text-[#a39d92]">
                      无缩略图
                    </div>
                  )}
                  <span className="absolute left-1.5 top-1.5 bg-white/90 px-1 py-0.5 font-mono text-[9px] text-[#161616]">
                    {String(shot.index + 1).padStart(2, "0")}
                  </span>
                  <span className="absolute bottom-1.5 right-1.5 bg-white/90 px-1 py-0.5 font-mono text-[9px] text-[#161616]">
                    {formatDurationLabel(shot.duration)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-2 py-1.5 text-[9px] text-[#8a857b]">
                  <span className="font-mono">{formatTime(shot.start, true)}</span>
                  <span className="truncate">{shot.tags[0] ?? "镜头"}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function DnaMetric({
  icon: Icon,
  label,
  value,
  hint,
  divider,
}: {
  icon: RemixiconComponentType;
  label: string;
  value: string;
  hint: string;
  divider?: boolean;
}) {
  return (
    <div className={`p-4 ${divider ? "border-b border-[#e6e2d9] md:border-b-0 md:border-r" : ""}`}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-[#8a857b]">
        <Icon className="size-3" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-2 font-serif text-[30px] leading-none tabular-nums text-[#161616]">
        {value}
      </div>
      <div className="mt-2 text-[9px] text-[#a39d92]">{hint}</div>
    </div>
  );
}
