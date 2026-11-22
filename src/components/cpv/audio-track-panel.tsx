"use client";

import { useRef, useState } from "react";
import { RiMusic2Line, RiScissorsCutLine } from "@remixicon/react";
import { buildAssetFromFile } from "@/lib/cpv/asset-build";
import { audioTrackEnd, clipEnd } from "@/lib/cpv/audio-track";
import { formatDurationLabel } from "@/lib/cpv/media";
import { useCPVStore } from "@/stores/cpv-store";
import { cn } from "@/lib/utils";

export function AudioTrackPanel() {
  const slots = useCPVStore((s) => s.slots);
  const assets = useCPVStore((s) => s.assets);
  const clips = useCPVStore((s) => s.audioClips);
  const bgm = useCPVStore((s) => s.bgm);
  const analysis = useCPVStore((s) => s.analysis);
  const addAudioClip = useCPVStore((s) => s.addAudioClip);
  const updateAudioClip = useCPVStore((s) => s.updateAudioClip);
  const removeAudioClip = useCPVStore((s) => s.removeAudioClip);
  const duplicateAudioClip = useCPVStore((s) => s.duplicateAudioClip);
  const splitAudioClipAt = useCPVStore((s) => s.splitAudioClipAt);
  const clearAudioClips = useCPVStore((s) => s.clearAudioClips);
  const addAsset = useCPVStore((s) => s.addAsset);

  const inputRef = useRef<HTMLInputElement>(null);
  const [splitAt, setSplitAt] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const timelineDuration = slots.length ? Math.max(...slots.map((slot) => slot.end)) : 0;
  const beatInterval = analysis?.bpm ? 60 / analysis.bpm : 0;
  // 音乐槽的曲子不一定在 assets 里，单独并入查找池。
  const pool = bgm && !assets.some((asset) => asset.id === bgm.id) ? [...assets, bgm] : assets;
  const audioAssets = pool.filter((asset) => asset.kind === "audio");

  function addFrom(assetId: string) {
    const asset = pool.find((item) => item.id === assetId);
    if (!asset) {
      setNote("找不到该音频素材");
      return;
    }
    const ok = addAudioClip(asset, timelineDuration || asset.duration || 30, beatInterval);
    setNote(ok ? `已加入 ${asset.name}` : "时间线已满或素材太短");
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const asset = await buildAssetFromFile(file);
      if (asset.kind !== "audio") {
        setNote("请选择音频文件");
        return;
      }
      addAsset(asset);
      const ok = addAudioClip(asset, timelineDuration || asset.duration || 30, beatInterval);
      setNote(ok ? `已加入 ${asset.name}` : "时间线已满");
    } catch {
      setNote("音频读取失败");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="mt-2 border border-[#ddd8cf] bg-white p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium">
          <RiMusic2Line className="size-3.5 text-[#d9482b]" aria-hidden="true" />
          音乐轨（可重复 / 变速 / 音量 / 淡变）
        </div>
        {clips.length > 0 && (
          <button
            type="button"
            onClick={clearAudioClips}
            className="border border-[#ddd8cf] px-1.5 py-0.5 text-[8px] text-[#6c675e] hover:bg-[#f6f4ef]"
          >
            清空
          </button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {bgm && (
          <button
            type="button"
            onClick={() => addFrom(bgm.id)}
            className="border border-[#161616] bg-white px-2 py-1 text-[9px] hover:bg-[#f6f4ef]"
          >
            + 音乐槽的曲子
          </button>
        )}
        {audioAssets
          .filter((asset) => asset.id !== bgm?.id)
          .slice(0, 3)
          .map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => addFrom(asset.id)}
              className="border border-[#ddd8cf] bg-white px-2 py-1 text-[9px] text-[#6c675e] hover:bg-[#f6f4ef]"
            >
              + {asset.name.slice(0, 12)}
            </button>
          ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="border border-[#ddd8cf] bg-white px-2 py-1 text-[9px] text-[#6c675e] hover:bg-[#f6f4ef]"
        >
          上传音乐
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
        <div className="ml-auto flex items-center gap-1">
          <input
            type="number"
            min={0}
            step={0.1}
            value={splitAt}
            onChange={(event) => setSplitAt(Number(event.target.value))}
            className="w-16 border border-[#ddd8cf] bg-white px-1.5 py-1 font-mono text-[9px]"
            aria-label="切分时间点"
          />
          <button
            type="button"
            onClick={() => splitAudioClipAt(splitAt)}
            disabled={!clips.length}
            className="flex items-center gap-1 border border-[#ddd8cf] bg-white px-1.5 py-1 text-[9px] disabled:opacity-40"
          >
            <RiScissorsCutLine className="size-3" aria-hidden="true" />
            切分
          </button>
        </div>
      </div>

      {clips.length === 0 ? (
        <p className="mt-1.5 text-[9px] leading-4 text-[#a39d92]">
          还没有音频段。加入后，这一段会覆盖音乐床设置：可以重复副歌、放慢高潮、单独调音量与淡入淡出。
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {clips.map((clip) => {
            const asset = pool.find((item) => item.id === clip.assetId);
            return (
              <li key={clip.id} className="border border-[#eee9e0] bg-[#faf9f6] p-1.5">
                <div className="flex items-center justify-between gap-2 text-[9px]">
                  <span className="min-w-0 truncate font-medium">
                    {clip.index + 1} · {asset?.name ?? clip.assetId}
                  </span>
                  <span className="shrink-0 font-mono text-[#8a857b]">
                    {clip.start.toFixed(1)}–{clipEnd(clip).toFixed(1)}s
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => duplicateAudioClip(clip.id)}
                      className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[8px]"
                    >
                      重复
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAudioClip(clip.id)}
                      className="border border-[#ddd8cf] bg-white px-1.5 py-0.5 text-[8px] text-[#b4442c]"
                    >
                      删除
                    </button>
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[8px] text-[#6c675e]">
                  <label className="flex items-center gap-1">
                    音量
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={Math.round(clip.volume * 100)}
                      onChange={(event) =>
                        updateAudioClip(clip.id, { volume: Number(event.target.value) / 100 })
                      }
                      className="w-full accent-[#161616]"
                    />
                    <span className="w-7 shrink-0 font-mono">
                      {Math.round(clip.volume * 100)}%
                    </span>
                  </label>
                  <label className="flex items-center gap-1">
                    速度
                    <input
                      type="range"
                      min={40}
                      max={200}
                      value={Math.round(clip.speed * 100)}
                      onChange={(event) =>
                        updateAudioClip(clip.id, { speed: Number(event.target.value) / 100 })
                      }
                      className="w-full accent-[#161616]"
                      disabled={clip.loop}
                    />
                    <span className="w-7 shrink-0 font-mono">{clip.speed.toFixed(2)}×</span>
                  </label>
                  <label className="flex items-center gap-1">
                    淡入
                    <input
                      type="range"
                      min={0}
                      max={300}
                      value={Math.round(clip.fadeIn * 100)}
                      onChange={(event) =>
                        updateAudioClip(clip.id, { fadeIn: Number(event.target.value) / 100 })
                      }
                      className="w-full accent-[#161616]"
                    />
                    <span className="w-7 shrink-0 font-mono">
                      {formatDurationLabel(clip.fadeIn)}
                    </span>
                  </label>
                  <label className="flex items-center gap-1">
                    淡出
                    <input
                      type="range"
                      min={0}
                      max={300}
                      value={Math.round(clip.fadeOut * 100)}
                      onChange={(event) =>
                        updateAudioClip(clip.id, { fadeOut: Number(event.target.value) / 100 })
                      }
                      className="w-full accent-[#161616]"
                    />
                    <span className="w-7 shrink-0 font-mono">
                      {formatDurationLabel(clip.fadeOut)}
                    </span>
                  </label>
                </div>
                <label className="mt-1 flex items-center gap-1.5 text-[8px] text-[#6c675e]">
                  <input
                    type="checkbox"
                    checked={clip.loop}
                    onChange={(event) => updateAudioClip(clip.id, { loop: event.target.checked })}
                    className="accent-[#161616]"
                  />
                  循环填满该段（源比段短时自动开启）
                  <span className="ml-auto font-mono text-[#a39d92]">
                    源 {formatDurationLabel(Math.max(0.05, clip.sourceOut - clip.sourceIn))}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-1.5 flex items-center justify-between text-[8px] text-[#a39d92]">
        <span>
          音轨总长 {formatDurationLabel(audioTrackEnd(clips))} · 时间线{" "}
          {formatDurationLabel(timelineDuration)}
        </span>
        {note && <span className={cn("text-[#6c675e]")}>{note}</span>}
      </div>
      {clips.length > 0 && (
        <p className="mt-1 text-[8px] text-[#8a6d1f]">
          有音乐轨时以音轨为准，上方"音乐床"设置不再参与导出。
        </p>
      )}
    </section>
  );
}
