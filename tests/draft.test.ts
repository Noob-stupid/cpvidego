import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignAssets,
  autoEffects,
  beatPlanToSlots,
  buildStyleDraft,
  isUsableAsset,
} from "../src/lib/cpv/draft";
import { buildBeatPlan, fallbackGrid } from "../src/lib/cpv/plan-beat";
import { asset, colorStats, shot, slot, timeline } from "./fixtures";
import type { AnalysisResult } from "../src/lib/cpv/types";

function analysis(shots: ReturnType<typeof shot>[]): AnalysisResult {
  return {
    duration: 10,
    analyzedDuration: 10,
    width: 1920,
    height: 1080,
    sampleFps: 6,
    cuts: [],
    shots,
    styleTags: [],
  };
}

test("纯黑与死白素材被判定为不可用", () => {
  assert.equal(isUsableAsset(asset("black", { colorStats: colorStats({ luma: 4 }) })), false);
  assert.equal(
    isUsableAsset(asset("white", { colorStats: colorStats({ luma: 250, saturation: 0.01 }) })),
    false,
  );
  assert.equal(isUsableAsset(asset("ok", { colorStats: colorStats({ luma: 120 }) })), true);
  assert.equal(isUsableAsset(asset("nostats")), true);
});

test("按色调距离选材，而不是机械轮播", () => {
  const dark = asset("dark", { colorStats: colorStats({ luma: 30, saturation: 0.2 }) });
  const bright = asset("bright", { colorStats: colorStats({ luma: 210, saturation: 0.5 }) });
  const slots = [
    slot(0, 0, 0.5, { targetColor: colorStats({ luma: 205, saturation: 0.5 }) }),
    slot(1, 0.5, 0.5, { targetColor: colorStats({ luma: 35, saturation: 0.2 }) }),
  ];
  const result = assignAssets(slots, [dark, bright]);
  assert.equal(result.slots[0].assetId, "bright");
  assert.equal(result.slots[1].assetId, "dark");
  assert.equal(result.skipped, 0);
});

test("复用惩罚让同色素材轮换，不会一条用到死", () => {
  const a = asset("a", { colorStats: colorStats({ luma: 100 }) });
  const b = asset("b", { colorStats: colorStats({ luma: 101 }) });
  const slots = timeline(8, 0.5).map((item) => ({
    ...item,
    targetColor: colorStats({ luma: 100 }),
  }));
  const result = assignAssets(slots, [a, b]);
  assert.equal(result.usedAssetCount, 2);
  assert.ok(result.slots.some((item) => item.assetId === "a"));
  assert.ok(result.slots.some((item) => item.assetId === "b"));
});

test("替换后槽位时长不变，素材被适配进去", () => {
  const source = asset("v", { duration: 40, sourceIn: 5, sourceOut: 5.3 });
  const result = assignAssets([slot(0, 0, 1)], [source]);
  const fitted = result.slots[0];
  assert.equal(fitted.duration, 1);
  assert.equal(fitted.end, 1);
  assert.ok(fitted.speed < 0.5);
});

test("自动效果按能量给闪白，低能量短镜头走节奏闪", () => {
  const shots = [shot(0, 0, 0.3, { diff: 0.9 }), shot(3, 0.9, 0.3, { diff: 0.02 })];
  const slots = [slot(0, 0, 0.3), slot(3, 0.9, 0.3)];
  const result = autoEffects(slots, shots);
  assert.ok((result[0].effects?.flash ?? 0) > 0.5);
  assert.equal(result[1].effects?.flash, 0.3);
  assert.deepEqual(autoEffects(slots, shots), result);
});

test("低能量镜头不再被硬塞震屏，避免无意义抖动", () => {
  const shots = [shot(0, 0, 0.3, { diff: 0.9 }), shot(1, 0.3, 0.3, { diff: 0.02 })];
  const result = autoEffects([slot(1, 0.3, 0.3)], shots);
  assert.equal(result[0].effects?.flash, undefined);
  assert.equal(result[0].effects?.shake, undefined);
  assert.equal(result[0].effects?.glitch, undefined);
});

test("没有用户素材时一键初剪保持原样", () => {
  const shots = [shot(0, 0, 1)];
  const slots = [slot(0, 0, 1)];
  const result = buildStyleDraft(analysis(shots), slots, [
    asset("reference", { origin: "reference" }),
  ]);
  assert.deepEqual(result.slots, slots);
  assert.equal(result.usedAssetCount, 0);
});

test("卡点计划转成槽位后保留变速与静音标记", () => {
  const plan = buildBeatPlan(fallbackGrid(20, 0.5), {
    targetDuration: 6,
    sourceDuration: 40,
    density: "beat",
    slowmo: 0.7,
    leadIn: 0.55,
    effectScale: 1,
  });
  const source = asset("long", { duration: 40 });
  const slots = beatPlanToSlots(plan, source);
  assert.equal(slots.length, plan.slots.length);
  assert.equal(new Set(slots.map((item) => item.id)).size, slots.length);
  for (let i = 0; i < slots.length; i += 1) {
    assert.equal(slots[i].assetId, "long");
    assert.equal(slots[i].speed, plan.slots[i].speed);
    assert.equal(slots[i].sourceIn, plan.slots[i].sourceIn);
    assert.equal(slots[i].volume, plan.slots[i].muted ? 0 : 1);
  }
});
