import assert from "node:assert/strict";
import { test } from "node:test";
import { runDirector, type DirectorDeps } from "../src/lib/cpv/ai/director";
import { applyProposal } from "../src/lib/cpv/ai/plan";
import { localLibrary } from "../src/lib/cpv/ai/library";
import type { AIProvider, ChatMessage, EditProposal, ToolCall } from "../src/lib/cpv/ai/types";
import { evaluateDraft } from "../src/lib/cpv/plan-quality";
import { asset, colorStats, timeline } from "./fixtures";
import type { MediaAsset, Slot } from "../src/lib/cpv/types";

function call(id: string, name: string, args: unknown): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function makeDeps(state: { slots: Slot[]; assets: MediaAsset[] }) {
  const deps: DirectorDeps = {
    provider: null as unknown as AIProvider,
    styleProfile: () => ({ bpm: 120, shots: state.slots.length }),
    listMaterials: (args) => localLibrary(state.assets).list(args.query, args.limit),
    timeline: () => state.slots,
    apply: (proposal: EditProposal) => {
      const result = applyProposal(state.slots, state.assets, proposal);
      state.slots = result.slots;
      const report = evaluateDraft({ slots: state.slots, assets: state.assets });
      return { report, reasons: result.reasons, applied: result.applied, rejected: result.rejected };
    },
    evaluate: () => evaluateDraft({ slots: state.slots, assets: state.assets }),
  };
  return deps;
}

test("工具回路：读档案→查素材→提交提案→自检→总结", async () => {
  const state = {
    slots: timeline(3, 0.5).map((slot) => ({
      ...slot,
      targetColor: colorStats({ luma: 100 }),
    })),
    assets: [asset("a", { colorStats: colorStats({ luma: 100 }) }), asset("b", { colorStats: colorStats({ luma: 200 }) })],
  };
  const deps = makeDeps(state);
  const script: ChatMessage[] = [
    { role: "assistant", content: null, tool_calls: [call("1", "get_style_profile", {}), call("2", "list_materials", {})] },
    { role: "assistant", content: null, tool_calls: [call("3", "propose_edit", { assignments: [{ slot: "slot_0", asset: "a", reason: "同色调" }], summary: "走暗调" })] },
    { role: "assistant", content: null, tool_calls: [call("4", "evaluate_draft", {})] },
    { role: "assistant", content: "整体走暗调，重拍加闪白。" },
  ];
  let index = 0;
  deps.provider = { chat: async () => ({ message: script[index++] }) };

  const result = await runDirector(deps, "出初剪");
  assert.equal(result.applied, 1);
  assert.equal(result.reasons.slot_0, "同色调");
  assert.equal(result.rounds, 4);
  assert.ok(result.log.some((line) => line.includes("propose_edit")));
  assert.ok(result.log.some((line) => line.includes("evaluate_draft")));
  assert.equal(state.slots[0].assetId, "a");
  assert.ok(result.summary.includes("暗调"));
});

test("不支持工具的端点回落到单次 JSON 提案", async () => {
  const state = { slots: timeline(2, 0.5), assets: [asset("a")] };
  const deps = makeDeps(state);
  let calls = 0;
  deps.provider = {
    chat: async (request) => {
      calls += 1;
      if (request.tools) throw new Error("tools not supported");
      return {
        message: {
          role: "assistant",
          content: `{"assignments":[{"slot":0,"asset":"a","reason":"唯一素材"}],"summary":"ok"}`,
        },
      };
    },
  };
  const result = await runDirector(deps, "出初剪");
  assert.equal(result.applied, 1);
  assert.equal(state.slots[0].assetId, "a");
  assert.ok(calls >= 2);
});

test("模型一直调工具时按上限停住，不会无限循环", async () => {
  const state = { slots: timeline(1, 0.5), assets: [asset("a")] };
  const deps = makeDeps(state);
  deps.provider = {
    chat: async () => ({
      message: { role: "assistant", content: null, tool_calls: [call("x", "get_timeline", {})] },
    }),
  };
  const result = await runDirector(deps, "loop", () => undefined, 3);
  assert.equal(result.rounds, 3);
});

test("提案里的未知素材被拒绝并回传给模型", async () => {
  const state = { slots: timeline(1, 0.5), assets: [asset("a")] };
  const deps = makeDeps(state);
  const script: ChatMessage[] = [
    { role: "assistant", content: null, tool_calls: [call("1", "propose_edit", { assignments: [{ slot: 0, asset: "ghost" }] })] },
    { role: "assistant", content: "素材不存在，放弃。" },
  ];
  let index = 0;
  deps.provider = { chat: async () => ({ message: script[index++] }) };
  const result = await runDirector(deps, "x");
  assert.equal(result.applied, 0);
  assert.equal(result.rejected.length, 1);
});
