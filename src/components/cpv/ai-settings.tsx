"use client";

import { useState } from "react";
import { RiCloseLine, RiDeleteBinLine, RiSettings3Line } from "@remixicon/react";
import { AI_PRESETS, presetFor, saveAIConfig } from "@/lib/cpv/ai/config";
import { createHttpProvider } from "@/lib/cpv/ai/provider";
import { loadSources, probeSource, saveSources, type SourceConfig } from "@/lib/cpv/ai/sources";
import type { AIConfig, AIProviderId } from "@/lib/cpv/ai/types";
import { generateUUID } from "@/utils/id";
import { cn } from "@/lib/utils";

export function AISettings({
  open,
  config,
  onClose,
  onSave,
}: {
  open: boolean;
  config: AIConfig;
  onClose: () => void;
  onSave: (config: AIConfig) => void;
}) {
  const [draft, setDraft] = useState<AIConfig>(config);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceConfig[]>(() => loadSources());
  const [sourceKind, setSourceKind] = useState<"manifest" | "github">("manifest");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceToken, setSourceToken] = useState("");
  const [probeResults, setProbeResults] = useState<Record<string, string>>({});

  function addSource() {
    if (!sourceUrl.trim()) return;
    const next = [
      ...sources,
      {
        id: `src_${generateUUID().slice(0, 8)}`,
        kind: sourceKind,
        label: sourceLabel.trim() || (sourceKind === "github" ? "GitHub 仓库" : "远程清单"),
        url: sourceUrl.trim(),
        token: sourceKind === "github" && sourceToken.trim() ? sourceToken.trim() : undefined,
      },
    ];
    setSources(next);
    saveSources(next);
    setSourceUrl("");
    setSourceLabel("");
    setSourceToken("");
  }

  async function probe(source: SourceConfig) {
    setProbeResults((prev) => ({ ...prev, [source.id]: "探活中…" }));
    const result = await probeSource(source);
    setProbeResults((prev) => ({ ...prev, [source.id]: result.message }));
  }

  function removeSource(id: string) {
    const next = sources.filter((item) => item.id !== id);
    setSources(next);
    saveSources(next);
  }

  if (!open) return null;

  function patch(next: Partial<AIConfig>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const provider = createHttpProvider(draft);
      const { message } = await provider.chat({
        messages: [{ role: "user", content: "回复两个字：就绪" }],
        temperature: 0,
      });
      setTestResult(`连接成功：${(message.content ?? "").slice(0, 40)}`);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : "连接失败");
    } finally {
      setTesting(false);
    }
  }

  function save() {
    saveAIConfig(draft);
    onSave(draft);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md border border-[#ddd8cf] bg-[#f4f2ec] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[12px] font-medium">
            <RiSettings3Line className="size-4" aria-hidden="true" />
            AI 导演设置
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[#8a857b] hover:text-[#161616]">
            <RiCloseLine className="size-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-1 text-[9px] leading-4 text-[#8a857b]">
          可选接入。Key 只存在本机浏览器；不填 Key 时官方端点会尝试读服务端环境变量。DeepSeek
          只是预设之一，任何 OpenAI 兼容端点或本地 Ollama 都可以。
        </p>

        <label className="mt-3 flex items-center gap-2 text-[10px] text-[#161616]">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
            className="accent-[#161616]"
          />
          启用 AI 指导（关闭时仍用纯 CV 一键初剪）
        </label>

        <label className="mt-3 block text-[9px] text-[#6c675e]">
          供应商
          <select
            value={draft.provider}
            onChange={(event) => {
              const provider = event.target.value as AIProviderId;
              patch({ ...presetFor(provider), apiKey: draft.apiKey });
            }}
            className="mt-1 w-full border border-[#ddd8cf] bg-white px-2 py-1.5 text-[10px]"
          >
            {(Object.keys(AI_PRESETS) as AIProviderId[]).map((key) => (
              <option key={key} value={key}>
                {AI_PRESETS[key].label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-2 block text-[9px] text-[#6c675e]">
          Base URL
          <input
            value={draft.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
            placeholder="https://api.deepseek.com/v1"
            className="mt-1 w-full border border-[#ddd8cf] bg-white px-2 py-1.5 font-mono text-[10px]"
          />
        </label>

        <label className="mt-2 block text-[9px] text-[#6c675e]">
          模型
          <input
            value={draft.model}
            onChange={(event) => patch({ model: event.target.value })}
            placeholder="deepseek-chat"
            className="mt-1 w-full border border-[#ddd8cf] bg-white px-2 py-1.5 font-mono text-[10px]"
          />
        </label>

        <label className="mt-2 block text-[9px] text-[#6c675e]">
          API Key（可选，仅存本机）
          <input
            type="password"
            value={draft.apiKey}
            onChange={(event) => patch({ apiKey: event.target.value })}
            placeholder="sk-…"
            className="mt-1 w-full border border-[#ddd8cf] bg-white px-2 py-1.5 font-mono text-[10px]"
          />
        </label>

        <div className="mt-3 border-t border-[#e1ddd4] pt-2">
          <div className="text-[10px] font-medium text-[#161616]">可接入素材源</div>
          <p className="mt-0.5 text-[9px] leading-4 text-[#8a857b]">
            本地与 Pexels 内置。还可登记任意 URL 的 JSON 清单、或某人的 GitHub
            仓库（自动列出其中的媒体文件）。AI 导演可跨这些源挑选。
          </p>
          {sources.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {sources.map((source) => (
                <li
                  key={source.id}
                  className="flex items-center justify-between gap-2 border border-[#eee9e0] bg-white px-2 py-1"
                >
                  <span className="min-w-0 truncate text-[9px] text-[#6c675e]">
                    [{source.kind}] {source.label} · {source.url}
                    {probeResults[source.id] && (
                      <span className="ml-1 text-[#a39d92]">{probeResults[source.id]}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void probe(source)}
                      className="border border-[#ddd8cf] px-1.5 py-0.5 text-[8px] text-[#6c675e] hover:bg-[#f6f4ef]"
                    >
                      探活
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSource(source.id)}
                      className="p-0.5 text-[#a39d92] hover:text-[#b4442c]"
                      aria-label={`移除 ${source.label}`}
                    >
                      <RiDeleteBinLine className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1.5 flex gap-1.5">
            <select
              value={sourceKind}
              onChange={(event) => setSourceKind(event.target.value as "manifest" | "github")}
              className="border border-[#ddd8cf] bg-white px-1.5 py-1 text-[9px]"
            >
              <option value="manifest">URL 清单</option>
              <option value="github">GitHub 仓库</option>
            </select>
            <input
              value={sourceLabel}
              onChange={(event) => setSourceLabel(event.target.value)}
              placeholder="名称"
              className="w-20 border border-[#ddd8cf] bg-white px-1.5 py-1 text-[9px]"
            />
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder={sourceKind === "github" ? "owner/repo" : "https://…/manifest.json"}
              className="min-w-0 flex-1 border border-[#ddd8cf] bg-white px-1.5 py-1 font-mono text-[9px]"
            />
            {sourceKind === "github" && (
              <input
                type="password"
                value={sourceToken}
                onChange={(event) => setSourceToken(event.target.value)}
                placeholder="token(私有库)"
                className="w-24 border border-[#ddd8cf] bg-white px-1.5 py-1 font-mono text-[9px]"
              />
            )}
            <button
              type="button"
              onClick={addSource}
              disabled={!sourceUrl.trim()}
              className="border border-[#161616] bg-white px-2 py-1 text-[9px] disabled:opacity-40"
            >
              添加
            </button>
          </div>
        </div>

        {testResult && (
          <p
            className={cn(
              "mt-2 text-[9px]",
              testResult.startsWith("连接成功") ? "text-[#1f5c4a]" : "text-[#b4442c]",
            )}
          >
            {testResult}
          </p>
        )}

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing || !draft.baseUrl || !draft.model}
            className="border border-[#ddd8cf] bg-white px-3 py-1.5 text-[10px] text-[#161616] hover:bg-[#f6f4ef] disabled:opacity-40"
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button
            type="button"
            onClick={save}
            className="bg-[#161616] px-3 py-1.5 text-[10px] font-medium text-white hover:bg-[#2b2b2b]"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
