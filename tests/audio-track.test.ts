import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeClipAt,
  appendClip,
  clipEnd,
  clipVolumeAt,
  duplicateClip,
  normalizeClips,
  splitClipAt,
} from "../src/lib/cpv/audio-track";
import type { AudioClip, MediaAsset } from "../src/lib/cpv/types";

function clip(patch: Partial<AudioClip> = {}): AudioClip {
  return {
    id: patch.id ?? "ac1",
    index: patch.index ?? 0,
    assetId: patch.assetId ?? "music",
    start: patch.start ?? 0,
    duration: patch.duration ?? 10,
    sourceIn: patch.sourceIn ?? 0,
    sourceOut: patch.sourceOut ?? 10,
    speed: patch.speed ?? 1,
    volume: patch.volume ?? 1,
    fadeIn: patch.fadeIn ?? 0,
    fadeOut: patch.fadeOut ?? 0,
    loop: patch.loop ?? false,
  };
}

function asset(duration: number): MediaAsset {
  return {
    id: "music",
    kind: "audio",
    name: "music.mp3",
    url: "blob:music",
    origin: "user",
    duration,
  };
}

test("归一化会排序、消重叠并保证速度与取段自洽", () => {
  const result = normalizeClips([
    clip({ id: "b", start: 8, duration: 4, sourceIn: 0, sourceOut: 4 }),
    clip({ id: "a", start: 0, duration: 10, sourceIn: 0, sourceOut: 10 }),
  ]);
  assert.deepEqual(result.map((item) => item.id), ["a", "b"]);
  assert.equal(result[1].start, 10);
  for (const item of result) {
    assert.ok(Math.abs((item.sourceOut - item.sourceIn) / item.duration - item.speed) < 0.01);
  }
});

test("变速被夹在 0.4–2.0，源不够长时按源长度回退", () => {
  const fast = normalizeClips([clip({ duration: 5, sourceIn: 0, sourceOut: 100, speed: 4 })])[0];
  assert.ok(fast.speed <= 2.001);
  assert.equal(fast.sourceOut, 10);
  const short = normalizeClips([clip({ duration: 10, sourceIn: 0, sourceOut: 2, speed: 1 })])[0];
  assert.ok(Math.abs(short.speed - 0.2) < 0.01, `speed=${short.speed}`);
});

test("循环段用满源长度且速度保持 1", () => {
  const looped = normalizeClips([
    clip({ duration: 20, sourceIn: 0, sourceOut: 6, loop: true, speed: 1.5 }),
  ])[0];
  assert.equal(looped.speed, 1);
  assert.equal(looped.sourceOut, 6);
});

test("追加段接在上一段之后并按节拍取整", () => {
  const clips = normalizeClips([clip({ start: 0, duration: 12.4 })]);
  const added = appendClip(clips, asset(60), 30, 0.5);
  assert.ok(added);
  assert.equal(added!.start, 12.4);
  assert.equal(added!.duration, 17.5);
  const none = appendClip(clips, asset(60), 10, 0.5);
  assert.equal(none, null);
});

test("重复段会把后面的段推后", () => {
  const clips = normalizeClips([
    clip({ id: "a", start: 0, duration: 10 }),
    clip({ id: "b", start: 10, duration: 5 }),
  ]);
  const result = duplicateClip(clips, "a");
  assert.equal(result.length, 3);
  const ids = result.map((item) => item.id);
  assert.equal(result[1].start, 10);
  assert.equal(result[2].start, 20);
  assert.ok(ids.includes("a"));
});

test("在时间点切分会拆出两段并保持源连续", () => {
  const clips = normalizeClips([clip({ start: 0, duration: 10, sourceIn: 2, sourceOut: 12 })]);
  const split = splitClipAt(clips, 4);
  assert.equal(split.length, 2);
  assert.equal(split[0].sourceIn, 2);
  assert.ok(Math.abs(split[0].sourceOut - 6) < 0.01);
  assert.ok(Math.abs(split[1].sourceIn - 6) < 0.01);
  assert.equal(split[1].start, 4);
  assert.equal(splitClipAt(clips, 0.01).length, 1);
});

test("音量包络在淡入淡出区间线性变化", () => {
  const c = clip({ duration: 10, volume: 1, fadeIn: 2, fadeOut: 2 });
  assert.equal(clipVolumeAt(c, 0), 0);
  assert.ok(Math.abs(clipVolumeAt(c, 1) - 0.5) < 1e-6);
  assert.equal(clipVolumeAt(c, 5), 1);
  assert.ok(Math.abs(clipVolumeAt(c, 9) - 0.5) < 1e-6);
  assert.equal(clipVolumeAt(c, 10), 0);
});

test("按输出时间找到当前播放的音频段", () => {
  const clips = normalizeClips([
    clip({ id: "a", start: 0, duration: 10 }),
    clip({ id: "b", start: 10, duration: 10 }),
  ]);
  assert.equal(activeClipAt(clips, 3)?.id, "a");
  assert.equal(activeClipAt(clips, 12)?.id, "b");
  assert.equal(activeClipAt(clips, 25), null);
  assert.equal(clipEnd(clips[1]), 20);
});
