import assert from "node:assert/strict";
import { test } from "node:test";
import { fitAssetToSlot, sourceSpeedForSlot } from "../src/lib/cpv/timing";
import { asset } from "./fixtures";

test("图片素材按槽位时长铺满，速度恒为 1", () => {
  const fitted = fitAssetToSlot(asset("img", { kind: "image", duration: undefined }), 0.8);
  assert.equal(fitted.speed, 1);
  assert.equal(fitted.sourceOut, 0.8);
});

test("整段视频只取槽位时长那一段，不拉伸", () => {
  const fitted = fitAssetToSlot(asset("v", { duration: 30 }), 0.6);
  assert.equal(fitted.sourceIn, 0);
  assert.ok(Math.abs(fitted.sourceOut - 0.6) < 1e-6);
  assert.equal(fitted.speed, 1);
});

test("提取出的短镜头用慢放填满长槽位", () => {
  const fitted = fitAssetToSlot(asset("v", { duration: 30, sourceIn: 2, sourceOut: 2.4 }), 1.2);
  assert.ok(fitted.speed < 0.5, `speed=${fitted.speed}`);
  assert.ok(Math.abs((fitted.sourceOut - fitted.sourceIn) / fitted.speed - 1.2) < 1e-6);
});

test("极短素材（整片就极短）不会把速度压到 0，下限 0.0625", () => {
  const fitted = fitAssetToSlot(asset("v", { duration: 0.05, sourceIn: 0, sourceOut: 0.05 }), 8);
  assert.equal(fitted.speed, 0.0625);
});

test("取段太短会多用原片，把速度夹在 0.4–2.5 观感安全区", () => {
  const fitted = fitAssetToSlot(asset("v", { duration: 30, sourceIn: 2, sourceOut: 2.1 }), 1);
  assert.ok(fitted.speed >= 0.4 && fitted.speed <= 2.5, `speed=${fitted.speed}`);
  assert.ok(fitted.sourceOut > 2.1, "应扩展取段而非硬拉伸");
  const long = fitAssetToSlot(asset("v", { duration: 30, sourceIn: 0, sourceOut: 20 }), 1);
  assert.ok(long.speed <= 2.5, `speed=${long.speed}`);
});

test("fitAssetToSlot 与 sourceSpeedForSlot 口径一致", () => {
  const fitted = fitAssetToSlot(asset("v", { duration: 30, sourceIn: 1, sourceOut: 3 }), 1);
  assert.equal(fitted.speed, sourceSpeedForSlot(fitted.sourceIn, fitted.sourceOut, 1));
});
