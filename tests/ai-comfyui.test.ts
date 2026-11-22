import assert from "node:assert/strict";
import { test } from "node:test";
import { extractOutput, isComplete, renderWorkflow } from "../src/lib/cpv/ai/comfyui";

const TEMPLATE = '{"seed":{{seed}},"w":{{width}},"h":{{height}},"n":{{seconds}},"text":"{{prompt}}"}';

test("工作流占位符被正确代入且 prompt 转义安全", () => {
  const workflow = renderWorkflow(TEMPLATE, {
    prompt: 'a "quote" \\ backslash',
    durationSeconds: 6,
    aspectRatio: "9:16",
    seed: 42,
  }) as Record<string, unknown>;
  assert.equal(workflow.seed, 42);
  assert.equal(workflow.n, 6);
  assert.equal(workflow.w, 576);
  assert.equal(workflow.h, 1024);
  assert.equal(workflow.text, 'a "quote" \\ backslash');
});

test("画幅决定分辨率", () => {
  const wide = renderWorkflow(TEMPLATE, { prompt: "x", aspectRatio: "16:9" }) as Record<string, number>;
  assert.equal(wide.w, 1024);
  assert.equal(wide.h, 576);
  const square = renderWorkflow(TEMPLATE, { prompt: "x", aspectRatio: "1:1" }) as Record<string, number>;
  assert.equal(square.w, 768);
});

test("优先挑视频输出，其次图片", () => {
  const entry = {
    outputs: {
      "9": { images: [{ filename: "frame.png", type: "output" }] },
      "10": { gifs: [{ filename: "clip.mp4", subfolder: "", type: "output" }] },
    },
  };
  const file = extractOutput(entry);
  assert.equal(file?.filename, "clip.mp4");
  const onlyImage = extractOutput({ outputs: { "9": { images: [{ filename: "a.png" }] } } });
  assert.equal(onlyImage?.filename, "a.png");
  assert.equal(extractOutput(undefined), null);
  assert.equal(extractOutput({ outputs: {} }), null);
});

test("完成判定：status.completed 或已有输出", () => {
  assert.equal(isComplete({ status: { completed: true } }), true);
  assert.equal(isComplete({ outputs: { "1": { videos: [{ filename: "v.mp4" }] } } }), true);
  assert.equal(isComplete({ status: { completed: false } }), false);
  assert.equal(isComplete(undefined), false);
});
