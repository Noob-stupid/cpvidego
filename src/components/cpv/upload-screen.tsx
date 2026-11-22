"use client";

import { useRef, useState } from "react";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiFilmLine,
  RiMusic2Line,
  RiScissorsCutLine,
  RiUploadCloud2Line,
  RiVideoLine,
} from "@remixicon/react";
import { Brand } from "@/components/cpv/brand";
import { loadAIConfig, saveAIConfig } from "@/lib/cpv/ai/config";
import { formatTime, getVideoMeta, isVideoFile, mediaSizeError } from "@/lib/cpv/media";
import { useLibraryStore } from "@/stores/library-store";
import { useCPVStore } from "@/stores/cpv-store";
import { cn } from "@/lib/utils";

export function UploadScreen() {
  const setReference = useCPVStore((s) => s.setReference);
  const setStep = useCPVStore((s) => s.setStep);
  const analyzeDuration = useCPVStore((s) => s.analyzeDuration);
  const setAnalyzeDuration = useCPVStore((s) => s.setAnalyzeDuration);
  const [aiEnabled, setAiEnabled] = useState(() => loadAIConfig().enabled);
  const renameCurrentProject = useLibraryStore((s) => s.renameCurrentProject);
  const refreshProjects = useLibraryStore((s) => s.refreshProjects);

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ duration: number; width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acceptFile(next: File | undefined | null) {
    if (!next) return;
    if (!isVideoFile(next)) {
      setError("请选择视频文件（MP4 / WebM / MOV）");
      return;
    }
    const sizeError = mediaSizeError(next);
    if (sizeError) {
      setError(sizeError);
      return;
    }
    setError(null);
    setLoading(true);
    const url = URL.createObjectURL(next);
    try {
      const info = await getVideoMeta(next);
      setFile(next);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
      setMeta(info);
      void renameCurrentProject(next.name.replace(/\.[^.]+$/, ""));
    } catch {
      URL.revokeObjectURL(url);
      setError("视频读取失败，换一个文件试试");
    } finally {
      setLoading(false);
    }
  }

  function startAnalysis() {
    if (!file || !previewUrl || !meta) {
      inputRef.current?.click();
      return;
    }
    setReference({
      id: "reference",
      kind: "video",
      name: file.name,
      url: previewUrl,
      file,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      size: file.size,
      origin: "reference",
    });
  }

  async function backToLibrary() {
    await refreshProjects();
    setStep("home");
  }

  return (
    <div className="min-h-dvh bg-[#f4f2ec] text-[#161616]">
      <header className="flex items-center justify-between border-b border-[#e1ddd4] px-5 py-3 md:px-8">
        <div className="flex items-center gap-5">
          <Brand compact />
          <span className="text-[11px] font-medium">新建项目</span>
        </div>
        <button
          type="button"
          onClick={() => void backToLibrary()}
          className="flex items-center gap-1.5 border border-[#ddd8cf] bg-white px-3 py-1.5 text-[10px] text-[#6c675e] hover:bg-[#f6f4ef]"
        >
          <RiArrowLeftLine className="size-3.5" aria-hidden="true" />
          项目库
        </button>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-5 pb-16 pt-8 md:px-8 lg:grid-cols-[1.4fr_0.8fr]">
        <section>
          <h1 className="text-[20px] font-medium">上传参考视频</h1>
          <p className="mt-1 text-[10px] text-[#8a857b]">
            分析切点、节拍和镜头结构，生成可替换槽位。参考视频保存在本地。
          </p>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void acceptFile(event.dataTransfer.files?.[0]);
            }}
            className={cn(
              "mt-4 border border-dashed bg-white transition-colors",
              dragging ? "border-[#d9482b] bg-[#fbf3f0]" : "border-[#d8d3c9]",
            )}
          >
            {previewUrl ? (
              <div>
                <video
                  src={previewUrl}
                  controls
                  muted
                  playsInline
                  className="aspect-video w-full bg-black object-contain"
                />
                <div className="flex items-center justify-between border-t border-[#e6e2d9] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium">{file?.name}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-[#8a857b]">
                      {meta ? `${formatTime(meta.duration)} · ${meta.width}×${meta.height}` : "读取中"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="border border-[#ddd8cf] px-2.5 py-1.5 text-[10px] text-[#161616] hover:bg-[#f6f4ef]"
                  >
                    更换
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex aspect-video w-full flex-col items-center justify-center gap-3 text-center"
              >
                <div className="flex size-10 items-center justify-center border border-[#d8d3c9] text-[#161616]">
                  <RiUploadCloud2Line className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-[12px] font-medium">
                    {loading ? "读取视频中…" : "拖入视频，或点击选择"}
                  </div>
                  <div className="mt-1 text-[9px] text-[#8a857b]">MP4 / WebM / MOV · 1080p</div>
                </div>
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(event) => void acceptFile(event.target.files?.[0])}
            />
          </div>

          {error && (
            <div className="mt-3 border-l-2 border-[#d9482b] bg-[#fbf3f0] px-3 py-2 text-[10px] text-[#a33722]">
              {error}
            </div>
          )}

          <div className="mt-4 border border-[#e1ddd4] bg-white">
            <div className="flex items-center gap-2 border-b border-[#eeeae1] px-3 py-2 text-[10px] font-medium">
              <RiScissorsCutLine className="size-3.5" aria-hidden="true" />
              分析内容
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3 text-[10px] text-[#6c675e]">
              <span className="flex items-center gap-1.5">
                <RiCheckLine className="size-3 text-[#161616]" aria-hidden="true" />
                镜头切点
              </span>
              <span className="flex items-center gap-1.5">
                <RiMusic2Line className="size-3 text-[#161616]" aria-hidden="true" />
                BPM / 节拍
              </span>
              <span className="flex items-center gap-1.5">
                <RiFilmLine className="size-3 text-[#161616]" aria-hidden="true" />
                镜头时长
              </span>
              <span className="flex items-center gap-1.5">
                <RiVideoLine className="size-3 text-[#161616]" aria-hidden="true" />
                踩点率
              </span>
            </div>
          </div>
        </section>

        <aside className="lg:pt-10">
          <div className="border border-[#ddd8cf] bg-white p-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#8a857b]">
              分析设置
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="shrink-0 text-[10px] text-[#6c675e]">分析范围</span>
              <div className="flex border border-[#ddd8cf]">
                {[
                  { value: 0, label: meta ? `自动·整片 ${Math.round(meta.duration)}s` : "自动·整片" },
                  { value: 30, label: "30s" },
                  { value: 60, label: "60s" },
                  { value: 120, label: "120s" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAnalyzeDuration(option.value)}
                    className={cn(
                      "px-2.5 py-1.5 font-mono text-[10px]",
                      analyzeDuration === option.value
                        ? "bg-[#161616] text-white"
                        : "bg-white text-[#6c675e] hover:bg-[#f4f2ec]",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1.5 text-[9px] leading-4 text-[#a39d92]">
              自动会分析整片，长片会自适应降低采样帧率；也可以手动限制前 30/60/120 秒。参考片越长分析越久（2 分钟约需 2–4 分钟）。
            </p>

            <button
              type="button"
              onClick={() => {
                const next = !aiEnabled;
                setAiEnabled(next);
                saveAIConfig({ ...loadAIConfig(), enabled: next });
              }}
              className="mt-3 flex w-full items-center justify-between border border-[#e1ddd4] bg-[#faf9f6] px-2.5 py-2 text-left hover:bg-[#f6f4ef]"
            >
              <div>
                <div className="text-[10px] text-[#161616]">AI 导演指导（可选）</div>
                <div className="mt-0.5 text-[9px] text-[#8a857b]">
                  关闭则纯 CV 分析；模型与 Key 在编辑器「AI 设置」配置
                </div>
              </div>
              <span
                className={cn(
                  "flex size-4 items-center justify-center border",
                  aiEnabled ? "border-[#161616] bg-[#161616] text-white" : "border-[#c9c3b8] bg-white",
                )}
              >
                {aiEnabled && <RiCheckLine className="size-3" aria-hidden="true" />}
              </span>
            </button>

            <button
              type="button"
              onClick={startAnalysis}
              disabled={loading}
              className="mt-4 flex w-full items-center justify-center gap-2 bg-[#161616] px-4 py-2.5 text-[11px] font-medium text-white hover:bg-[#2b2b2b] disabled:opacity-40"
            >
              开始分析
              <RiArrowRightLine className="size-4" aria-hidden="true" />
            </button>
            <p className="mt-2 text-[9px] leading-4 text-[#a39d92]">
              分析在当前浏览器完成，不上传参考视频。
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}