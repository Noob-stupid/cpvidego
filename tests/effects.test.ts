import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeEffectFrame,
  effectCount,
  joinFilters,
  rgbFilterId,
  scaleEffects,
} from "../src/lib/cpv/effects";

function translateX(transform: string) {
  const match = /translate\((-?[\d.]+)%/.exec(transform);
  return match ? Number(match[1]) : 0;
}

function scaleOf(transform: string) {
  const match = /scale\(([\d.]+)\)/.exec(transform);
  return match ? Number(match[1]) : 1;
}

test("闪白只在开头 0.14 秒内，之后归零", () => {
  const start = computeEffectFrame({ flash: 1 }, 0, 0);
  const later = computeEffectFrame({ flash: 1 }, 0.5, 0.2);
  assert.ok(start.flashOpacity > 0.8);
  assert.equal(later.flashOpacity, 0);
});

test("震屏随时间衰减，不会整段抖", () => {
  const early = computeEffectFrame({ shake: 1 }, 0, 0.02, 3);
  const late = computeEffectFrame({ shake: 1 }, 0.9, 0.6, 3);
  assert.ok(Math.abs(translateX(early.transform)) > Math.abs(translateX(late.transform)) * 3);
});

test("推近随进度放大，拉远随进度缩小", () => {
  const pushStart = scaleOf(computeEffectFrame({ zoom: 0.6 }, 0, 0).transform);
  const pushEnd = scaleOf(computeEffectFrame({ zoom: 0.6 }, 1, 1).transform);
  const pullStart = scaleOf(computeEffectFrame({ zoom: -0.6 }, 0, 0).transform);
  const pullEnd = scaleOf(computeEffectFrame({ zoom: -0.6 }, 1, 1).transform);
  assert.ok(pushEnd > pushStart);
  assert.ok(pullStart > pullEnd);
});

test("声像跟拍把画面推向对应声道，强度 0 时不动", () => {
  const right = computeEffectFrame({}, 0.5, 0.5, 0, 1, 0.8);
  const left = computeEffectFrame({}, 0.5, 0.5, 0, -1, 0.8);
  const off = computeEffectFrame({}, 0.5, 0.5, 0, 1, 0);
  assert.ok(translateX(right.transform) > 3);
  assert.ok(translateX(left.transform) < -3);
  assert.equal(translateX(off.transform), 0);
});

test("效果强度整体缩放并被夹在 1.5 倍", () => {
  const scaled = scaleEffects({ flash: 0.8, shake: 0.5 }, 0.5);
  assert.equal(scaled?.flash, 0.4);
  assert.equal(scaled?.shake, 0.25);
  const capped = scaleEffects({ flash: 1 }, 4);
  assert.equal(capped?.flash, 1.5);
  assert.equal(scaleEffects(undefined, 0.5), undefined);
});

test("效果计数忽略接近 0 的档位，滤镜拼接跳过 none", () => {
  assert.equal(effectCount({ flash: 0.5, shake: 0.001, zoom: -0.4 }), 2);
  assert.equal(effectCount(undefined), 0);
  assert.equal(joinFilters("brightness(1.1)", undefined, "none", "saturate(1.2)"), "brightness(1.1) saturate(1.2)");
  assert.equal(rgbFilterId(0.9), "cpv-rgb-high");
  assert.equal(rgbFilterId(0.2), "cpv-rgb-low");
});

test("无效果且无声像时判定为静止帧", () => {
  const frame = computeEffectFrame(undefined, 0.5, 0.5);
  assert.equal(frame.active, false);
  assert.equal(frame.flashOpacity, 0);
  assert.equal(frame.filter, "");
});
