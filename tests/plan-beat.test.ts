import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBeatPlan, fallbackGrid, type BeatPlanConfig } from "../src/lib/cpv/plan-beat";
import type { SourceWindow } from "../src/lib/cpv/scan-source";

const config: BeatPlanConfig = {
  targetDuration: 12,
  sourceDuration: 60,
  density: "beat",
  slowmo: 0.7,
  leadIn: 0.55,
  effectScale: 1,
};

function windows(): SourceWindow[] {
  return Array.from({ length: 12 }, (_, index) => {
    const start = 2 + index * 4.6;
    return {
      start,
      end: start + 3,
      score: 0.8,
      activity: 0.7,
      motion: 0.5,
      cuts: 0.3,
      luma: 120,
      saturation: 0.4,
    };
  });
}

test("卡点片铺满目标时长且没有空洞", () => {
  const plan = buildBeatPlan(fallbackGrid(20, 0.5), config);
  assert.ok(plan.slots.length > 10);
  assert.equal(plan.slots[0].start, 0);
  assert.equal(plan.slots[plan.slots.length - 1].end, config.targetDuration);
  for (let i = 1; i < plan.slots.length; i += 1) {
    assert.ok(Math.abs(plan.slots[i].start - plan.slots[i - 1].end) < 0.02);
  }
});

test("切点落在拍上", () => {
  const grid = fallbackGrid(20, 0.5);
  const plan = buildBeatPlan(grid, config);
  for (const slot of plan.slots.slice(1)) {
    const distance = Math.min(...grid.beats.map((beat) => Math.abs(beat - slot.start)));
    assert.ok(distance <= 0.09, `slot ${slot.index} start=${slot.start} distance=${distance}`);
  }
});

test("重拍慢放、前一拍冲刺，形成速度落差", () => {
  const plan = buildBeatPlan(fallbackGrid(20, 0.5), config);
  const hits = plan.slots.filter((slot) => slot.role === "hit");
  const leads = plan.slots.filter((slot) => slot.role === "lead");
  assert.ok(hits.length > 0, "没有慢放段");
  assert.ok(leads.length > 0, "没有冲刺段");
  assert.ok(hits.every((slot) => slot.speed < 0.9));
  assert.ok(leads.every((slot) => slot.speed > 1.1));
  for (const lead of leads) {
    const next = plan.slots[lead.index + 1];
    assert.equal(next?.role, "hit");
  }
});

test("关掉慢放就不该出现慢速段", () => {
  const plan = buildBeatPlan(fallbackGrid(20, 0.5), { ...config, slowmo: 0 });
  assert.ok(plan.slots.every((slot) => slot.speed >= 0.99));
  assert.equal(plan.stats.hits, 0);
});

test("素材区间始终落在源视频内，且与速度自洽", () => {
  const plan = buildBeatPlan(fallbackGrid(20, 0.5), config, windows());
  for (const slot of plan.slots) {
    assert.ok(slot.sourceIn >= 0);
    assert.ok(slot.sourceOut <= config.sourceDuration + 0.05);
    assert.ok(slot.sourceOut > slot.sourceIn);
    const implied = (slot.sourceOut - slot.sourceIn) / slot.duration;
    assert.ok(Math.abs(implied - slot.speed) < 0.03, `slot ${slot.index}: ${implied} vs ${slot.speed}`);
  }
});

test("变速段静音，避免变调怪声", () => {
  const plan = buildBeatPlan(fallbackGrid(20, 0.5), config);
  for (const slot of plan.slots) {
    assert.equal(slot.muted, Math.abs(slot.speed - 1) > 0.12);
  }
});

test("同一输入产出完全一致，便于回归", () => {
  const grid = fallbackGrid(20, 0.5);
  const a = buildBeatPlan(grid, config, windows());
  const b = buildBeatPlan(grid, config, windows());
  assert.deepEqual(a, b);
});

test("慢放段优先取高光窗口", () => {
  const plan = buildBeatPlan(fallbackGrid(20, 0.5), config, windows());
  const hits = plan.slots.filter((slot) => slot.role === "hit");
  assert.ok(hits.length > 0);
  const inside = hits.filter((slot) =>
    windows().some((window) => slot.sourceIn >= window.start - 0.2 && slot.sourceIn <= window.end),
  );
  assert.ok(inside.length >= Math.ceil(hits.length / 2), `${inside.length}/${hits.length}`);
});

test("窗口用尽后仍留在合格池内，不会盲取到池外区间", () => {
  const pool = windows();
  const plan = buildBeatPlan(fallbackGrid(40, 0.5), { ...config, targetDuration: 30 }, pool);
  assert.ok(plan.slots.length > pool.length * 2);
  for (const slot of plan.slots) {
    const inside = pool.some(
      (window) => slot.sourceIn >= window.start - 0.15 && slot.sourceIn <= window.end,
    );
    assert.ok(inside, `slot ${slot.index} sourceIn=${slot.sourceIn} 落在窗口池外`);
  }
});

test("素材比成片短时仍能排满，不会越界", () => {
  const plan = buildBeatPlan(fallbackGrid(20, 0.5), { ...config, sourceDuration: 6 });
  assert.equal(plan.slots[plan.slots.length - 1].end, config.targetDuration);
  assert.ok(plan.slots.every((slot) => slot.sourceOut <= 6.05));
});
