import assert from "node:assert/strict";
import { test } from "node:test";
import { applyProposal, sanitizeProposal } from "../src/lib/cpv/ai/plan";
import { asset, colorStats, slot, timeline } from "./fixtures";

test("提案把已知素材落到槽位并保持时长，附带理由", () => {
  const slots = timeline(2, 0.5);
  const source = asset("a", { duration: 30, colorStats: colorStats({ luma: 100 }) });
  const result = applyProposal(slots, [source], {
    assignments: [{ slot: "slot_0", asset: "a", reason: "色调接近" }],
  });
  assert.equal(result.applied, 1);
  assert.equal(result.slots[0].assetId, "a");
  assert.equal(result.slots[0].duration, 0.5);
  assert.equal(result.reasons.slot_0, "色调接近");
  assert.equal(result.rejected.length, 0);
});

test("未知槽位与未知素材被拒绝而不是静默忽略", () => {
  const result = applyProposal(timeline(1, 0.5), [asset("a")], {
    assignments: [
      { slot: "nope", asset: "a" },
      { slot: "slot_0", asset: "ghost" },
    ],
  });
  assert.equal(result.applied, 0);
  assert.equal(result.rejected.length, 2);
});

test("效果强度被夹到安全区间，接近 0 的档位被移除", () => {
  const slots = timeline(1, 0.5);
  const result = applyProposal(slots, [asset("a")], {
    effects: [{ slot: 0, flash: 5, zoom: -3, shake: 0.001 }],
  });
  assert.equal(result.slots[0].effects?.flash, 1);
  assert.equal(result.slots[0].effects?.zoom, -1);
  assert.equal(result.slots[0].effects?.shake, undefined);
});

test("变速被夹住且偏离 1 倍时静音，避免变调", () => {
  const slots = timeline(1, 1).map((slot) => ({ ...slot, assetId: "a" }));
  const source = asset("a", { duration: 30 });
  const result = applyProposal(slots, [source], { speeds: [{ slot: 0, speed: 0.4 }] });
  assert.ok(Math.abs(result.slots[0].speed - 0.4) < 0.01);
  assert.equal(result.slots[0].volume, 0);
});

test("sanitize 过滤垃圾字段并截断理由", () => {
  const proposal = sanitizeProposal({
    assignments: [{ slot: 0, asset: "a", reason: "x".repeat(500) }, null, { slot: 1 }],
    effects: [{ slot: 0, flash: "bad" }, { slot: 0, flash: 0.5 }],
    audio: { bgmVolume: 9 },
    summary: "ok",
  });
  assert.equal(proposal.assignments?.length, 1);
  assert.equal(proposal.assignments?.[0].reason?.length, 200);
  assert.equal(proposal.effects?.length, 1);
  assert.equal(proposal.audio?.bgmVolume, 1);
});
