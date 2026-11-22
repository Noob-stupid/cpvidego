"use client";

import { useEffect } from "react";
import {
  RiArrowDownLine,
  RiCloseLine,
  RiFilmLine,
  RiMusic2Line,
  RiUploadLine,
} from "@remixicon/react";
import { colorFilter, scaleColorGrade, warmthTint } from "@/lib/cpv/color-match";
import { composeTransform, scaleCompositionAdjust } from "@/lib/cpv/composition";
import { formatDurationLabel, formatTime } from "@/lib/cpv/media";
import type { MatchSettings, MediaAsset, Slot } from "@/lib/cpv/types";
import { cn } from "@/lib/utils";

interface SwipePreviewProps {
  slots: Slot[];
  assets: MediaAsset[];
  referenceId: string;
  matchSettings: MatchSettings;
  onClose: () => void;
  onSelect: (slotId: string) => void;
  onReplace: (slotId: string) => void;
}

export function SwipePreview({
  slots,
  assets,
  referenceId,
  matchSettings,
  onClose,
  onSelect,
  onReplace,
}: SwipePreviewProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#f4f2ec] text-[#161616]">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-[#e1ddd4] bg-[#f4f2ec]/95 px-5 py-3 backdrop-blur-sm">
        <div>
          <div className="text-[11px] font-medium">滑动预览</div>
          <div className="mt-0.5 flex items-center gap-1 text-[9px] text-[#8a857b]">
            <RiArrowDownLine className="size-3" aria-hidden="true" />
            上下滑动逐个镜头检查
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 items-center justify-center border border-[#ddd8cf] bg-white text-[#6c675e] hover:bg-[#f6f4ef]"
          aria-label="关闭滑动预览"
        >
          <RiCloseLine className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="no-scrollbar h-dvh snap-y snap-mandatory overflow-y-auto pt-14">
        {slots.map((slot) => {
          const asset = assets.find((item) => item.id === slot.assetId);
          const replaced = slot.assetId !== referenceId;
          const colorGrade =
            matchSettings.color && slot.colorGrade
              ? scaleColorGrade(slot.colorGrade, matchSettings.strength)
              : null;
          const tint = colorGrade ? warmthTint(colorGrade) : null;
          const transform = composeTransform(
            Boolean(matchSettings.motion && slot.mirrorX),
            matchSettings.composition && slot.composition
              ? scaleCompositionAdjust(slot.composition, matchSettings.strength)
              : undefined,
          );
          return (
            <section
              key={slot.id}
              className="flex min-h-dvh snap-start flex-col justify-center px-5 py-10"
            >
              <div className="mx-auto w-full max-w-3xl">
                <div className="relative overflow-hidden border border-[#ddd8cf] bg-white p-2">
                  {slot.thumbnailUrl ? (
                    <img
                      src={slot.thumbnailUrl}
                      alt={slot.label}
                      className="aspect-video w-full object-contain"
                      style={{
                        filter: colorGrade ? colorFilter(colorGrade) : undefined,
                        transform,
                        transformOrigin: "center center",
                      }}
                    />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center text-[#a39d92]">
                      <RiFilmLine className="size-8" aria-hidden="true" />
                    </div>
                  )}
                  {tint && (
                    <div
                      className="pointer-events-none absolute inset-2"
                      style={{
                        backgroundColor: tint.color,
                        opacity: tint.opacity,
                        mixBlendMode: "soft-light",
                      }}
                    />
                  )}
                  <div className="absolute left-4 top-4 flex items-center gap-2 border border-[#e1ddd4] bg-white/95 px-2 py-1 backdrop-blur">
                    <span className="size-1.5 bg-[#d9482b]" />
                    <span className="text-[9px] text-[#161616]">{slot.label}</span>
                    <span className="font-mono text-[8px] text-[#8a857b]">
                      {formatTime(slot.start, true)}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "absolute right-4 top-4 px-2 py-1 text-[8px]",
                      replaced ? "bg-[#161616] text-white" : "border border-[#e1ddd4] bg-white/95 text-[#6c675e]",
                    )}
                  >
                    {replaced ? "已替换" : "原片"}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-serif text-[24px] leading-none">{slot.label}</h2>
                      <span className="font-mono text-[10px] text-[#8a857b]">
                        {formatDurationLabel(slot.duration)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-[#6c675e]">
                      {replaced ? (
                        <>
                          <RiMusic2Line className="size-3" aria-hidden="true" />
                          {asset?.name ?? "我的素材"}
                        </>
                      ) : (
                        <>
                          <RiFilmLine className="size-3" aria-hidden="true" />
                          参考镜头
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onReplace(slot.id)}
                      className="flex items-center gap-1.5 bg-[#d9482b] px-3 py-2 text-[10px] font-medium text-white hover:bg-[#bd3d24]"
                    >
                      <RiUploadLine className="size-3.5" aria-hidden="true" />
                      替换素材
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelect(slot.id)}
                      className="border border-[#161616] px-3 py-2 text-[10px] text-[#161616] hover:bg-[#faf9f6]"
                    >
                      打开这个镜头
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(slot.effectTags.length ? slot.effectTags : ["硬切"]).map((tag) => (
                    <span
                      key={tag}
                      className="border border-[#d9482b]/20 bg-[#fbf3f0] px-2 py-0.5 text-[9px] text-[#a33722]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
