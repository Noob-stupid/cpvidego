import assert from "node:assert/strict";
import { test } from "node:test";
import { pickHighlightWindows, type SourceWindow } from "../src/lib/cpv/scan-source";

function window(start: number, patch: Partial<SourceWindow> = {}): SourceWindow {
  return {
    start,
    end: start + 1.2,
    score: 0.5,
    activity: 0.4,
    motion: 0.3,
    cuts: 0.1,
    luma: 120,
    saturation: 0.35,
    ...patch,
  };
}

test("近黑窗口即使动作分高也不入选", () => {
  const windows = [
    window(0, { score: 0.95, luma: 4 }),
    window(10, { score: 0.6 }),
    window(20, { score: 0.55 }),
    window(30, { score: 0.5 }),
    window(40, { score: 0.45 }),
  ];
  const picked = pickHighlightWindows(windows, 4);
  assert.ok(picked.every((item) => item.start !== 0));
  assert.equal(picked.length, 4);
});

test("全片都偏暗时退回原池，不至于排不出片", () => {
  const windows = [window(0, { luma: 5 }), window(10, { luma: 8 })];
  const picked = pickHighlightWindows(windows, 4);
  assert.equal(picked.length, 2);
});

test("入选窗口互不重叠且按时间排序", () => {
  const windows = [
    window(0, { score: 0.9 }),
    window(0.5, { score: 0.85 }),
    window(10, { score: 0.8 }),
    window(20, { score: 0.7 }),
  ];
  const picked = pickHighlightWindows(windows, 3);
  assert.deepEqual(
    picked.map((item) => item.start),
    [0, 10, 20],
  );
  for (let i = 1; i < picked.length; i += 1) {
    assert.ok(picked[i].start >= picked[i - 1].end);
  }
});
