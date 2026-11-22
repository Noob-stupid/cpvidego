"use client";

import { useEffect, useRef, useState } from "react";
import type { RemixiconComponentType } from "@remixicon/react";
import {
  RiAlertLine,
  RiArrowLeftLine,
  RiCheckLine,
  RiFilmLine,
  RiLoader5Line,
  RiMusic2Line,
  RiScissorsCutLine,
  RiSparklingLine,
  RiTimeLine,
} from "@remixicon/react";
import { Brand } from "@/components/cpv/brand";
import { analyzeReference } from "@/lib/cpv/analyze";
import { formatTime } from "@/lib/cpv/media";
import { useCPVStore } from "@/stores/cpv-store";
import { useLibraryStore } from "@/stores/library-store";

interface FrameItem {
  time: number;
  thumbnail: string;
  diff: number;
}

const STAGES = [
  { key: "sample", label: "解码与抽帧" },
  { key: "refine", label: "回看切点" },
  { key: "beat", label: "节拍与踩点" },
  { key: "done", label: "生成风格 DNA" },
];

export function AnalysisScreen() {
  const reference = useCPVStore((s) => s.reference);
  const analyzeDuration = useCPVStore((s) => s.analyzeDuration);
  const setAnalysis = useCPVStore((s) => s.setAnalysis);
  const setStep = useCPVStore((s) => s.setStep);

  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [current, setCurrent] = useState<FrameItem | null>(null);
  const [cuts, setCuts] = useState<number[]>([]);
  const [bpm, setBpm] = useState<number | undefined>();
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("sample");
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(() => setStep("dna"), 900);
    return () => window.clearTimeout(timer);
  }, [finished, setStep]);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev.slice(-7), message]);
  };

  useEffect(() => {
    if (!reference?.file) return;
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      try {
        const result = await analyzeReference(
          reference.file!,
          { maxDuration: analyzeDuration > 0 ? analyzeDuration : undefined, sampleFps: 6 },
          (event) => {
            if (controller.signal.aborted) return;
            if (event.type === "stage") {
              setStage(event.stage);
              setProgress((prev) => Math.max(prev, event.progress));
              addLog(event.label);
            } else if (event.type === "frame") {
              const item = {
                time: event.timestamp,
                thumbnail: event.thumbnail,
                diff: event.diff,
              };
              setCurrent(item);
              setFrames((prev) => [...prev.slice(-119), item]);
              setProgress(event.progress);
            } else if (event.type === "cut") {
              setCuts((prev) => [...prev, event.timestamp]);
              setProgress(event.progress);
              addLog(`${formatTime(event.timestamp, true)} 检测到切点`);
            } else if (event.type === "refine") {
              setProgress(event.progress);
            } else if (event.type === "bpm") {
              setBpm(event.bpm || undefined);
              setProgress(event.progress);
              addLog(event.bpm ? `估计 BPM ${event.bpm}` : "节拍检测跳过");
            } else if (event.type === "done") {
              const doneResult = event.result;
              setStage("done");
              setProgress(1);
              setFinished(true);
              addLog(`完成：${doneResult.shots.length} 个镜头`);
              setAnalysis(doneResult);
              void useLibraryStore.getState().saveCurrentProject();
            } else if (event.type === "error") {
              setError(event.message);
            }
          },
          controller.signal,
        );
        if (!result.shots.length) setError("没有检测到有效镜头");
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "分析失败");
        }
      }
    })();

    return () => controller.abort();
  }, [reference, analyzeDuration, setAnalysis, setStep]);

  function cancel() {
    abortRef.current?.abort();
    setStep("upload");
  }

  const activeStageIndex = Math.max(0, STAGES.findIndex((item) => item.key === stage));

  return (
    <div className="min-h-dvh bg-[#f4f2ec] text-[#161616]">
      <header className="flex items-center justify-between border-b border-[#e1ddd4] px-6 py-4">
        <div className="flex items-center gap-5">
          <Brand compact />
          <div>
            <div className="text-[12px] font-medium text-[#161616]">分析中</div>
            <div className="mt-0.5 text-[10px] text-[#8a857b]">
              {reference?.name} · {analyzeDuration > 0 ? `分析前 ${analyzeDuration}s` : "分析整片"}
            </div>
          </div>
        </div>
        <div className="hidden items-center gap-4 md:flex">
          {STAGES.map((item, index) => {
            const done = index < activeStageIndex || finished;
            const active = index === activeStageIndex && !finished;
            return (
              <div
                key={item.key}
                className={
                  active
                    ? "flex items-center gap-1.5 border-b-2 border-[#161616] pb-1 text-[10px] text-[#161616]"
                    : done
                      ? "flex items-center gap-1.5 border-b-2 border-transparent pb-1 text-[10px] text-[#8a857b]"
                      : "flex items-center gap-1.5 border-b-2 border-transparent pb-1 text-[10px] text-[#b4aea3]"
                }
              >
                {done ? (
                  <RiCheckLine className="size-3" aria-hidden="true" />
                ) : (
                  <span className="size-1 rounded-full bg-current" />
                )}
                {item.label}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              void useLibraryStore.getState().refreshProjects();
              setStep("home");
            }}
            className="hidden border border-[#ddd8cf] bg-white px-3 py-1.5 text-[10px] text-[#6c675e] hover:bg-[#f6f4ef] sm:block"
          >
            项目库
          </button>
          <button
            type="button"
            onClick={cancel}
            className="flex items-center gap-1.5 border border-[#ddd8cf] bg-white px-3 py-1.5 text-[10px] text-[#6c675e] hover:bg-[#f6f4ef]"
          >
            <RiArrowLeftLine className="size-3.5" aria-hidden="true" />
            取消
          </button>
        </div>
      </header>

      <main className="grid gap-4 p-4 xl:grid-cols-[1.6fr_0.8fr]">
        <section className="flex min-h-0 flex-col gap-4">
          <div className="relative overflow-hidden border border-[#ddd8cf] bg-white">
            {current?.thumbnail ? (
              <img src={current.thumbnail} alt="当前分析帧" className="aspect-video w-full object-contain" />
            ) : (
              <div className="flex aspect-video items-center justify-center">
                <RiLoader5Line className="size-5 animate-spin text-[#a39d92]" />
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[#d9482b]/70 cpv-scanline motion-reduce:animate-none" />
            <div className="absolute left-3 top-3 flex items-center gap-2 border border-[#e1ddd4] bg-white/90 px-2 py-1 backdrop-blur">
              <span className="size-1.5 bg-[#d9482b]" />
              <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-[#161616]">
                Live Scan
              </span>
            </div>
            <div className="absolute bottom-3 left-3 border border-[#e1ddd4] bg-white/90 px-2 py-1 font-mono text-[10px] text-[#161616] backdrop-blur">
              {current ? formatTime(current.time, true) : "00:00.000"}
            </div>
            {finished && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2 border border-[#161616] bg-[#161616] px-4 py-2 text-[11px] text-white">
                    <RiCheckLine className="size-4" aria-hidden="true" />
                    分析完成，正在生成 DNA
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep("dna")}
                    className="border border-[#161616] bg-white px-3 py-1.5 text-[10px] text-[#161616] hover:bg-[#f4f2ec]"
                  >
                    查看 DNA
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border border-[#ddd8cf] bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] text-[#8a857b]">
                <RiFilmLine className="size-3.5" aria-hidden="true" />
                胶片条
              </div>
              <div className="font-mono text-[9px] text-[#a39d92]">{frames.length} 帧已分析</div>
            </div>
            <div className="no-scrollbar flex gap-1 overflow-x-auto pb-1">
              {frames.slice(-70).map((frame, index) => {
                const isCut = cuts.some((cut) => Math.abs(cut - frame.time) < 0.17);
                return (
                  <div key={`${frame.time}_${index}`} className="relative shrink-0">
                    <img
                      src={frame.thumbnail}
                      alt=""
                      className="h-14 w-24 border border-[#e6e2d9] object-cover"
                    />
                    {isCut && <div className="absolute inset-y-0 left-0 w-0.5 bg-[#d9482b]" />}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <div className="border border-[#ddd8cf] bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#8a857b]">
              <RiSparklingLine className="size-3.5" aria-hidden="true" />
              实时指标
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="切点" value={String(cuts.length)} icon={RiScissorsCutLine} />
              <Metric label="BPM" value={bpm ? String(bpm) : "—"} icon={RiMusic2Line} />
              <Metric label="当前帧差" value={current ? current.diff.toFixed(2) : "—"} icon={RiTimeLine} />
              <Metric label="进度" value={`${Math.round(progress * 100)}%`} icon={RiLoader5Line} />
            </div>
          </div>

          <div className="border border-[#ddd8cf] bg-white p-4">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#8a857b]">
              分析日志
            </div>
            <div className="space-y-2">
              {logs.length === 0 && <div className="text-[10px] text-[#a39d92]">等待第一帧…</div>}
              {logs.map((log, index) => (
                <div key={`${log}_${index}`} className="flex gap-2 text-[10px] leading-5 text-[#6c675e]">
                  <span className="mt-2 size-1 shrink-0 bg-[#c9c3b8]" />
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-[#ddd8cf] bg-white p-4">
            <div className="flex items-center justify-between text-[10px] text-[#6c675e]">
              <span>总进度</span>
              <span className="font-mono text-[#161616]">{Math.round(progress * 100)}%</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden bg-[#e9e5dc]">
              <div
                className="h-full bg-[#161616] transition-[width] duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-pretty text-[9px] leading-4 text-[#a39d92]">
              分析器允许乱序回看：播放头跳到哪一帧，画面就显示哪一帧。
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 border border-[#d9482b]/30 bg-[#fbf3f0] p-3 text-[10px] text-[#a33722]">
              <RiAlertLine className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <div>
                {error}
                <button type="button" onClick={cancel} className="mt-2 block underline">
                  返回重新上传
                </button>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: RemixiconComponentType;
}) {
  return (
    <div className="border border-[#e6e2d9] bg-[#faf9f6] p-2.5">
      <div className="flex items-center gap-1.5 text-[9px] text-[#8a857b]">
        <Icon className="size-3" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 font-mono text-[15px] tabular-nums text-[#161616]">{value}</div>
    </div>
  );
}
