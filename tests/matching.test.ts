import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildColorGrade,
  colorFilter,
  scaleColorGrade,
  warmthTint,
} from "../src/lib/cpv/color-match";
import { buildCompositionAdjust, composeTransform } from "../src/lib/cpv/composition";
import { shouldMirrorX } from "../src/lib/cpv/motion";
import { colorStats, compositionStats, motionStats } from "./fixtures";

test("暗素材配亮目标会提亮，且不超过保守上限", () => {
  const grade = buildColorGrade(colorStats({ luma: 40 }), colorStats({ luma: 200 }));
  assert.ok(grade.brightness > 1);
  assert.ok(grade.brightness <= 1.26);
});

test("色彩匹配三个通道都被夹在安全区间", () => {
  const grade = buildColorGrade(
    colorStats({ luma: 5, saturation: 0.9, contrast: 5 }),
    colorStats({ luma: 250, saturation: 0.02, contrast: 120 }),
  );
  assert.ok(grade.brightness >= 0.8 && grade.brightness <= 1.26);
  assert.ok(grade.saturate >= 0.66 && grade.saturate <= 1.45);
  assert.ok(grade.contrast >= 0.84 && grade.contrast <= 1.2);
  assert.ok(Math.abs(grade.warmth) <= 0.24);
});

test("强度 0 等于不匹配", () => {
  const grade = buildColorGrade(colorStats({ luma: 30 }), colorStats({ luma: 220 }));
  const scaled = scaleColorGrade(grade, 0);
  assert.equal(scaled.brightness, 1);
  assert.equal(scaled.saturate, 1);
  assert.equal(scaled.contrast, 1);
  assert.equal(scaled.warmth, 0);
});

test("滤镜字符串包含三个通道，暖色偏移为 0 时不加色罩", () => {
  const grade = buildColorGrade(colorStats({ luma: 60 }), colorStats({ luma: 180 }));
  const filter = colorFilter(grade);
  for (const part of ["brightness(", "saturate(", "contrast("]) assert.ok(filter.includes(part));
  assert.equal(warmthTint({ ...grade, warmth: 0 }), null);
});

test("只有方向相反且稳定的横移才镜像", () => {
  const target = motionStats({ x: 0.02, coherence: 0.8, shake: 0.1 });
  assert.equal(shouldMirrorX(target, motionStats({ x: -0.02, coherence: 0.8, shake: 0.1 })), true);
  assert.equal(shouldMirrorX(target, motionStats({ x: 0.02, coherence: 0.8, shake: 0.1 })), false);
  assert.equal(shouldMirrorX(target, motionStats({ x: -0.02, coherence: 0.3, shake: 0.1 })), false);
  assert.equal(shouldMirrorX(target, motionStats({ x: -0.02, coherence: 0.8, shake: 0.7 })), false);
  assert.equal(shouldMirrorX(undefined, motionStats({ x: -0.02 })), false);
});

test("构图位移朝向目标且不越界，完全一致时不产生变换", () => {
  const adjust = buildCompositionAdjust(
    compositionStats({ cx: 0.25, cy: 0.6 }),
    compositionStats({ cx: 0.75, cy: 0.3 }),
  );
  assert.ok(adjust);
  assert.ok(adjust!.shiftX > 0 && adjust!.shiftX <= 0.045);
  assert.ok(adjust!.shiftY < 0 && adjust!.shiftY >= -0.04);
  assert.ok(adjust!.scale >= 1 && adjust!.scale <= 1.12);
  assert.equal(
    buildCompositionAdjust(compositionStats(), compositionStats()),
    undefined,
  );
});

test("镜像变换写在最后，避免位移被翻转", () => {
  const transform = composeTransform(true, { scale: 1.04, shiftX: 0.02, shiftY: -0.01 });
  assert.ok(transform);
  assert.ok(transform!.endsWith("scaleX(-1)"));
  assert.ok(transform!.startsWith("translate(2.00%, -1.00%)"));
  assert.equal(composeTransform(false, undefined), undefined);
});
