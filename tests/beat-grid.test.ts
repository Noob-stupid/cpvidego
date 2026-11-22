import assert from "node:assert/strict";
import { test } from "node:test";
import { gridFromFlux, tempoFromFlux, trimGridToFirstHit, alignBedOffset } from "../src/lib/cpv/beat-grid";

const RATE = 86;

function impulseFlux(duration: number, interval: number, accentEvery = 4): Float32Array {
  const frames = Math.floor(duration * RATE);
  const flux = new Float32Array(frames);
  let index = 0;
  for (let time = 0; time < duration; time += interval) {
    const frame = Math.round(time * RATE);
    if (frame < frames) flux[frame] = index % accentEvery === 0 ? 1 : 0.62;
    index += 1;
  }
  return flux;
}

test("120 BPM 的规整起峰能被定速", () => {
  const flux = impulseFlux(12, 0.5);
  const tempo = tempoFromFlux(flux, RATE);
  assert.ok(Math.abs(tempo.bpm - 120) <= 4, `bpm=${tempo.bpm}`);
  assert.ok(tempo.score > 0.2);
});

test("网格吸附到真实拍点，间隔稳定", () => {
  const flux = impulseFlux(12, 0.5);
  const grid = gridFromFlux(flux, RATE, 12);
  assert.ok(grid.beats.length >= 20, `beats=${grid.beats.length}`);
  const gaps = grid.beats.slice(1).map((beat, index) => beat - grid.beats[index]);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  assert.ok(Math.abs(median - 0.5) < 0.06, `median=${median}`);
  for (const beat of grid.beats) {
    const phase = beat % 0.5;
    assert.ok(Math.min(phase, 0.5 - phase) <= 0.09, `beat=${beat}`);
  }
  assert.ok(grid.downbeats.length >= 4);
  assert.ok(grid.confidence > 0.2);
});

test("静音素材不硬造节拍", () => {
  const grid = gridFromFlux(new Float32Array(RATE * 6), RATE, 6);
  assert.equal(grid.bpm, 0);
  assert.equal(grid.beats.length, 0);
});

test("接近的 BPM 提示优先采用，便于跟参考片统一速度", () => {
  const flux = impulseFlux(12, 0.5);
  const grid = gridFromFlux(flux, RATE, 12, { bpmHint: 124 });
  assert.equal(grid.bpm, 124);
});

test("换 BGM 时求偏移让切点落回拍上", () => {
  const grid = gridFromFlux(impulseFlux(12, 0.5), RATE, 12);
  // 切点故意整体偏 0.2s，对齐应找回约 0.3s 偏移（0.5-0.2）使切点落拍。
  const cuts = [1.2, 2.2, 3.2, 4.2, 5.2];
  const offset = alignBedOffset(grid, cuts);
  let hits = 0;
  for (const cut of cuts) {
    const d = Math.min(...grid.beats.map((b) => Math.abs(b - (cut + offset))));
    if (d <= 0.08) hits += 1;
  }
  assert.ok(hits >= 4, `hits=${hits} offset=${offset}`);
});

test("无节拍或无切点时偏移为 0", () => {
  const grid = gridFromFlux(new Float32Array(RATE * 4), RATE, 4);
  assert.equal(alignBedOffset(grid, [1, 2]), 0);
  const good = gridFromFlux(impulseFlux(8, 0.5), RATE, 8);
  assert.equal(alignBedOffset(good, []), 0);
});

test("前奏静音会被裁掉，网格从第一个有效拍开始", () => {
  const frames = Math.floor(12 * RATE);
  const flux = new Float32Array(frames);
  for (let time = 3; time < 12; time += 0.5) flux[Math.round(time * RATE)] = 1;
  const grid = trimGridToFirstHit(gridFromFlux(flux, RATE, 12));
  assert.ok(grid.offset >= 2.8, `offset=${grid.offset}`);
  assert.ok(grid.beats.every((beat) => beat >= grid.offset));
});
