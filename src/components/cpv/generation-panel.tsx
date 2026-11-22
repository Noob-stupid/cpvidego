"use client";

import { useState } from "react";
import { RiMovie2Line, RiPulseLine } from "@remixicon/react";
import { createComfyUIProvider, EXAMPLE_WORKFLOW } from "@/lib/cpv/ai/comfyui";
import { buildAssetFromFile } from "@/lib/cpv/asset-build";
import { useCPVStore } from "@/stores/cpv-store";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cpv.comfy";

interface ComfySettings {
  baseUrl: string;
  workflowTemplate: string;
}

function loadSettings(): ComfySettings {
  if (typeof window === "undefined") return { baseUrl: "", workflowTemplate: EXAMPLE_WORKFLOW };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { baseUrl: "", workflowTemplate: EXAMPLE_WORKFLOW };
    return { baseUrl: "", workflowTemplate: EXAMPLE_WORKFLOW, ...JSON.parse(raw) };
  } catch {
    return { baseUrl: "", workflowTemplate: EXAMPLE_WORKFLOW };
  }
}

export function GenerationPanel() {
  const addAsset = useCPVStore((s) => s.addAsset);
  const [settings, setSettings] = useState<ComfySettings>(() => loadSettings());
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(4);
  const [aspect, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Partial<ComfySettings>) {
    const merged = { ...settings, ...next };
    setSettings(merged);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }

  async function probe() {
    setStatus(null);
    setError(null);
    const ok = await createComfyUIProvider(settings).available();
    setStatus(ok ? "本机桥在线" : "本机桥不可达（确认 ComfyUI 已启动并允许 CORS）");
  }

  async function generate() {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    setStatus("提交工作流…");
    try {
      const clip = await createComfyUIProvider(settings).generate({
        prompt: prompt.trim(),
        durationSeconds: seconds,
        aspectRatio: aspect,
      });
      setStatus("导入素材库…");
      const blob = clip.blob ?? (clip.fileUrl ? await fetch(clip.fileUrl).then((r) => r.blob()) : null);
      if (!blob) throw new Error("生成结果无数据");
      const file = new File([blob], clip.name || "generated.mp4", { type: "video/mp4" });
      const asset = await buildAssetFromFile(file);
      addAsset({ ...asset, sourceTag: "comfyui" });
      setStatus(`已生成并入库：${asset.name}（${Math.round(asset.duration ?? 0)}s），可被 AI 导演挑选`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成失败");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 border-t border-[#eee9e0] pt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between text-[9px] text-[#6c675e] hover:text-[#161616]"
      >
        <span className="flex items-center gap-1">
          <RiMovie2Line className="size-3" aria-hidden="true" />
          AI 生成素材（本机桥 · 预留云端）
        </span>
        <span>{open ? "收起" : "展开"}</span>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          <input
            value={settings.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
            placeholder="http://127.0.0.1:8188"
            className="w-full border border-[#ddd8cf] bg-white px-2 py-1 font-mono text-[9px]"
          />
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="主题描述，例如：雨夜霓虹街道，动漫角色奔跑，高燃"
            rows={2}
            className="w-full border border-[#ddd8cf] bg-white px-2 py-1 text-[9px]"
          />
          <div className="flex gap-1.5">
            <select
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value))}
              className="border border-[#ddd8cf] bg-white px-1.5 py-1 text-[9px]"
            >
              {[2, 4, 6, 8].map((value) => (
                <option key={value} value={value}>
                  {value}s
                </option>
              ))}
            </select>
            <select
              value={aspect}
              onChange={(event) => setAspect(event.target.value as typeof aspect)}
              className="border border-[#ddd8cf] bg-white px-1.5 py-1 text-[9px]"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
            <button
              type="button"
              onClick={() => void probe()}
              className="border border-[#ddd8cf] bg-white px-2 py-1 text-[9px]"
            >
              探活
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy || !prompt.trim() || !settings.baseUrl}
              className="flex-1 bg-[#161616] px-2 py-1 text-[9px] text-white disabled:opacity-40"
            >
              {busy ? "生成中…" : "生成并入库"}
            </button>
          </div>
          <details className="text-[9px] text-[#8a857b]">
            <summary className="cursor-pointer">工作流模板（API 格式 JSON，占位符自动代入）</summary>
            <textarea
              value={settings.workflowTemplate}
              onChange={(event) => patch({ workflowTemplate: event.target.value })}
              rows={6}
              className="mt-1 w-full border border-[#ddd8cf] bg-white px-2 py-1 font-mono text-[8px]"
            />
          </details>
          {status && (
            <p className={cn("text-[9px]", error ? "text-[#b4442c]" : "text-[#1f5c4a]")}>
              <RiPulseLine className="mr-1 inline size-3" aria-hidden="true" />
              {status}
            </p>
          )}
          {error && <p className="text-[9px] text-[#b4442c]">{error}</p>}
        </div>
      )}
    </div>
  );
}
