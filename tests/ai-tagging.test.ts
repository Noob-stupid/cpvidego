import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTagResponse, tagCompatibility } from "../src/lib/cpv/ai/tagging";
import { assignAssets } from "../src/lib/cpv/draft";
import { asset, colorStats, slot } from "./fixtures";

test("解析模型标签 JSON，非法字段丢弃、数值夹取", () => {
  const tags = parseTagResponse(
    '前言 {"kind":"anime","letterbox":false,"shotSize":"close","subject":"角色特写","energy":1.4,"quality":-0.2,"bogus":1} 后语',
  );
  assert.equal(tags.kind, "anime");
  assert.equal(tags.letterbox, false);
  assert.equal(tags.shotSize, "close");
  assert.equal(tags.subject, "角色特写");
  assert.equal(tags.energy, 1);
  assert.equal(tags.quality, 0);
  assert.equal((tags as Record<string, unknown>).bogus, undefined);
  assert.deepEqual(parseTagResponse("no json"), {});
});

test("黑边与异风格硬拒绝，同风格按景别/质量加分", () => {
  const target = { kind: "anime" as const, shotSize: "close" as const };
  assert.equal(tagCompatibility({ kind: "live" }, target).hardReject, true);
  assert.equal(tagCompatibility({ kind: "anime", letterbox: true }, target).hardReject, true);
  const good = tagCompatibility({ kind: "anime", shotSize: "close", quality: 0.9 }, target);
  assert.equal(good.hardReject, false);
  assert.ok(good.score > 0.8);
  const wide = tagCompatibility({ kind: "anime", shotSize: "wide", quality: 0.5 }, target);
  assert.ok(wide.score < good.score);
  assert.equal(tagCompatibility(undefined, target).hardReject, false);
});

test("选材硬过滤掉实拍/黑边素材，即使颜色更接近", () => {
  const anime = asset("anime", { colorStats: colorStats({ luma: 120 }), tags: { kind: "anime" } });
  const live = asset("live", { colorStats: colorStats({ luma: 100 }), tags: { kind: "live" } });
  const slots = [slot(0, 0, 0.5, { targetColor: colorStats({ luma: 100 }) })];
  const result = assignAssets(slots, [anime, live], {
    useTags: true,
    targetTags: { kind: "anime" },
  });
  assert.equal(result.slots[0].assetId, "anime");
});

test("无标签时不硬过滤，保持向后兼容", () => {
  const a = asset("a", { colorStats: colorStats({ luma: 100 }) });
  const slots = [slot(0, 0, 0.5, { targetColor: colorStats({ luma: 100 }) })];
  const result = assignAssets(slots, [a], { useTags: true, targetTags: { kind: "anime" } });
  assert.equal(result.slots[0].assetId, "a");
});
