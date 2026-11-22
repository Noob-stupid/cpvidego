import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDraft, summarizeReport } from "../src/lib/cpv/plan-quality";
import { fallbackGrid } from "../src/lib/cpv/plan-beat";
import { buildColorGrade } from "../src/lib/cpv/color-match";
import { asset, colorStats, timeline } from "./fixtures";

test("连续且干净的时间线得高分、无错误", () => {
  const slots = timeline(10, 0.5);
  const report = evaluateDraft({ slots, assets: [asset("a")] });
  assert.equal(report.metrics.gaps, 0);
  assert.equal(report.metrics.overlaps, 0);
  assert.ok(report.score >= 90, `score=${report.score}`);
  assert.equal(report.issues.filter((issue) => issue.level === "error").length, 0);
});

test("时间线空洞被判为错误，因为导出会黑屏", () => {
  const slots = timeline(6, 0.5);
  slots[3] = { ...slots[3], start: 2.2, end: 2.7 };
  const report = evaluateDraft({ slots, assets: [asset("a")] });
  assert.ok(report.metrics.gaps > 0);
  assert.ok(report.issues.some((issue) => issue.code === "gap" && issue.level === "error"));
  assert.ok(report.score < 80);
});

test("纯黑素材会被体检抓出来", () => {
  const slots = timeline(4, 0.5).map((item) => ({ ...item, assetId: "black" }));
  const report = evaluateDraft({
    slots,
    assets: [
      asset("black", { sourceIn: 0, sourceOut: 2, colorStats: colorStats({ luma: 3 }) }),
    ],
  });
  assert.equal(report.metrics.blankRisk, 4);
  assert.ok(report.issues.some((issue) => issue.code === "blank"));
});

test("整条长素材的首帧统计不该误判所有片段", () => {
  const slots = timeline(4, 0.5).map((item, index) => ({
    ...item,
    assetId: "long",
    sourceIn: 20 + index * 8,
    sourceOut: 20.5 + index * 8,
  }));
  const report = evaluateDraft({
    slots,
    assets: [asset("long", { duration: 200, colorStats: colorStats({ luma: 2 }) })],
  });
  assert.equal(report.metrics.blankRisk, 0);
});

test("卡点模式按扫描窗口逐段判断黑场", () => {
  const windows = [
    { start: 0, end: 2, score: 0.1, activity: 0, motion: 0, cuts: 0, luma: 3, saturation: 0 },
    { start: 10, end: 12, score: 0.8, activity: 0.7, motion: 0.5, cuts: 0.2, luma: 120, saturation: 0.4 },
  ];
  const slots = [
    { ...timeline(1, 0.5)[0], sourceIn: 0.5, sourceOut: 1 },
    { ...timeline(2, 0.5)[1], sourceIn: 10.5, sourceOut: 11 },
  ];
  const report = evaluateDraft({ slots, assets: [asset("long", { duration: 200 })], windows });
  assert.equal(report.metrics.blankRisk, 1);
});

test("有扫描窗口时不再用整片首帧统计兜底误判", () => {
  const windows = [
    { start: 10, end: 12, score: 0.8, activity: 0.7, motion: 0.5, cuts: 0.2, luma: 120, saturation: 0.4 },
  ];
  const slots = [{ ...timeline(1, 0.5)[0], assetId: "long", sourceIn: 99, sourceOut: 99.5 }];
  const report = evaluateDraft({
    slots,
    assets: [
      asset("long", { duration: 200, sourceIn: 0, sourceOut: 1, colorStats: colorStats({ luma: 2 }) }),
    ],
    windows,
  });
  assert.equal(report.metrics.blankRisk, 0);
});

test("卡点模式重挂载丢失窗口后不误报黑场与重复", () => {
  const grid = fallbackGrid(20, 0.5);
  const slots = timeline(12, 0.5).map((item, index) => ({
    ...item,
    assetId: "long",
    sourceIn: 20 + index * 3,
    sourceOut: 20.5 + index * 3,
  }));
  const report = evaluateDraft({
    slots,
    assets: [
      asset("long", { duration: 200, sourceIn: 0, sourceOut: 1, colorStats: colorStats({ luma: 2 }) }),
    ],
    grid,
  });
  assert.equal(report.metrics.blankRisk, 0);
  assert.ok(!report.issues.some((issue) => issue.code === "repeat"));
  assert.ok(!report.issues.some((issue) => issue.code === "blank"));
});

test("色彩残差反映匹配后的剩余偏差", () => {
  const source = colorStats({ luma: 120, saturation: 0.3 });
  const target = colorStats({ luma: 150, saturation: 0.3 });
  const slots = timeline(4, 0.5).map((item) => ({
    ...item,
    assetId: "a",
    targetColor: target,
    colorGrade: buildColorGrade(source, target),
  }));
  const report = evaluateDraft({ slots, assets: [asset("a", { colorStats: source })] });
  assert.ok(report.metrics.colorResidual > 0);
  assert.ok(report.metrics.colorResidual < 0.12, `residual=${report.metrics.colorResidual}`);
});

test("极端明暗差匹配不到位时如实报警，而不是假装匹配成功", () => {
  const source = colorStats({ luma: 40, saturation: 0.2 });
  const target = colorStats({ luma: 200, saturation: 0.6 });
  const slots = timeline(4, 0.5).map((item) => ({
    ...item,
    assetId: "a",
    targetColor: target,
    colorGrade: buildColorGrade(source, target),
  }));
  const report = evaluateDraft({ slots, assets: [asset("a", { colorStats: source })] });
  assert.ok(report.metrics.colorResidual > 0.3);
  assert.ok(report.issues.some((issue) => issue.code === "color"));
});

test("卡点命中率按拍点距离统计", () => {
  const grid = fallbackGrid(20, 0.5);
  const onBeat = timeline(10, 0.5);
  const offBeat = onBeat.map((item) => ({ ...item, start: item.start + 0.2, end: item.end + 0.2 }));
  const good = evaluateDraft({ slots: onBeat, assets: [asset("a")], grid });
  const bad = evaluateDraft({ slots: offBeat, assets: [asset("a")], grid });
  assert.equal(good.metrics.beatHitRate, 1);
  assert.ok((bad.metrics.beatHitRate ?? 1) < 0.2);
  assert.ok(bad.issues.some((issue) => issue.code === "beat"));
});

test("频闪与效果过密会给出警告", () => {
  const slots = timeline(20, 0.25).map((item) => ({
    ...item,
    effects: { flash: 0.8, shake: 0.6, rgb: 0.5, glitch: 0.5 },
  }));
  const report = evaluateDraft({ slots, assets: [asset("a")] });
  assert.ok(report.metrics.flashPerSecond > 2.6);
  assert.ok(report.issues.some((issue) => issue.code === "strobe"));
  assert.ok(report.issues.some((issue) => issue.code === "overfx"));
});

test("极端变速会报警，防止 AI 选出快进丢帧或近静止", () => {
  const fast = timeline(4, 0.5).map((item) => ({ ...item, speed: 6.7 }));
  const report = evaluateDraft({ slots: fast, assets: [asset("a")] });
  assert.ok(report.issues.some((issue) => issue.code === "speed"));
  const slow = timeline(4, 0.5).map((item) => ({ ...item, speed: 0.1 }));
  const slowReport = evaluateDraft({ slots: slow, assets: [asset("a")] });
  assert.ok(slowReport.issues.some((issue) => issue.code === "slow"));
});

test("摘要包含关键指标，便于 UI 一行展示", () => {
  const report = evaluateDraft({ slots: timeline(6, 0.5), assets: [asset("a")] });
  const summary = summarizeReport(report);
  assert.ok(summary.includes("6 镜头"));
  assert.ok(summary.includes("3s"));
});
