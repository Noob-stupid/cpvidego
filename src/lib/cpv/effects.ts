import type { EffectKind, SlotEffects } from "./types";

export const EFFECT_ORDER: EffectKind[] = [
  "flash",
  "shake",
  "zoom",
  "rgb",
  "glitch",
  "grade",
];

export const EFFECT_LABELS: Record<EffectKind, string> = {
  flash: "闪白",
  shake: "震屏",
  zoom: "推拉",
  rgb: "RGB",
  glitch: "故障",
  grade: "调色",
};

export interface EffectFrame {
  flashOpacity: number;
  scanlineOpacity: number;
  transform: string;
  filter: string;
  active: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function pseudoRandom(seed: number, step: number) {
  const value = Math.sin(seed * 12.9898 + step * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function rgbFilterId(level: number) {
  if (level > 0.7) return "cpv-rgb-high";
  if (level > 0.35) return "cpv-rgb-mid";
  return "cpv-rgb-low";
}

export function joinFilters(...parts: Array<string | undefined | null>) {
  return parts.filter((part): part is string => Boolean(part && part !== "none")).join(" ");
}

export function scaleEffects(
  effects: SlotEffects | undefined,
  scale = 1,
): SlotEffects | undefined {
  if (!effects) return effects;
  const amount = clamp(scale, 0, 1.5);
  if (Math.abs(amount - 1) < 0.01) return effects;
  const result: SlotEffects = {};
  for (const key of EFFECT_ORDER) {
    const value = effects[key];
    if (value != null) result[key] = value * amount;
  }
  return result;
}

export function computeEffectFrame(
  effects: SlotEffects | undefined,
  progress: number,
  time: number,
  seed = 0,
  audioPan = 0,
  audioPanStrength = 1,
): EffectFrame {
  const p = clamp(progress, 0, 1);
  const t = Math.max(0, time);
  const flashValue = clamp(effects?.flash ?? 0, 0, 1);
  const shakeValue = clamp(effects?.shake ?? 0, 0, 1);
  const zoomValue = clamp(effects?.zoom ?? 0, -1, 1);
  const rgbValue = clamp(effects?.rgb ?? 0, 0, 1);
  const glitchValue = clamp(effects?.glitch ?? 0, 0, 1);
  const gradeValue = clamp(effects?.grade ?? 0, 0, 1);

  const flashOpacity = t < 0.14 ? flashValue * 0.92 * (1 - t / 0.14) : 0;
  const decay = Math.exp(-t * 8);
  const shakeX = Math.sin(t * 40 + seed * 1.7) * 0.8 * shakeValue * decay;
  const shakeY = Math.cos(t * 33 + seed * 2.3) * 0.55 * shakeValue * decay;
  const rotation = Math.sin(t * 29 + seed * 0.9) * 0.2 * shakeValue * decay;

  const punchScale = 1 + shakeValue * 0.06 * Math.exp(-t * 20);
  const zoomPunch =
    zoomValue > 0 ? 1 + zoomValue * 0.05 * Math.exp(-t * 16) : 1;
  const zoomScale =
    (zoomValue >= 0
      ? 1 + zoomValue * 0.1 * p
      : 1 + -zoomValue * 0.1 * (1 - p)) * zoomPunch;
  const panX = clamp(audioPan, -1, 1) * 6.5 * clamp(audioPanStrength, 0, 1);
  const cover = 1 + Math.max(Math.abs(shakeX), Math.abs(shakeY), Math.abs(panX)) * 0.022;
  const scale = zoomScale * punchScale * cover;

  const glitchStep = Math.floor(t * 26 + seed * 3);
  const glitchRandom = pseudoRandom(seed + 1, glitchStep);
  const glitchBurst = glitchRandom > 0.55 ? 1 : 0;
  const jitterX = (pseudoRandom(seed + 2, glitchStep) - 0.5) * 2 * glitchValue * glitchBurst;
  const scanlineOpacity = glitchValue * (0.05 + glitchBurst * 0.1);

  const transform = `translate(${(shakeX + jitterX + panX).toFixed(3)}%, ${shakeY.toFixed(
    3,
  )}%) rotate(${rotation.toFixed(3)}deg) scale(${scale.toFixed(4)})`;

  const filters: string[] = [];
  if (gradeValue > 0.004) {
    filters.push(
      `contrast(${(1 + gradeValue * 0.18).toFixed(3)})`,
      `saturate(${(1 + gradeValue * 0.24).toFixed(3)})`,
      `brightness(${(1 - gradeValue * 0.025).toFixed(3)})`,
    );
  }
  const rgbLevel = Math.max(rgbValue, glitchValue * 0.9);
  if (rgbLevel > 0.04) filters.push(`url(#${rgbFilterId(rgbLevel)})`);
  if (glitchValue > 0.02) {
    filters.push(
      `hue-rotate(${(Math.sin(t * 42 + seed) * 4 * glitchValue).toFixed(2)}deg)`,
    );
  }

  return {
    flashOpacity,
    scanlineOpacity,
    transform,
    filter: filters.join(" "),
    active:
      flashValue > 0 ||
      shakeValue > 0 ||
      Math.abs(zoomValue) > 0 ||
      rgbValue > 0 ||
      glitchValue > 0 ||
      gradeValue > 0 ||
      Math.abs(audioPan) > 0.02,
  };
}

export function effectCount(effects?: SlotEffects) {
  if (!effects) return 0;
  return EFFECT_ORDER.reduce(
    (count, key) => count + (Math.abs(effects[key] ?? 0) > 0.01 ? 1 : 0),
    0,
  );
}

export function effectLabels(effects?: SlotEffects) {
  if (!effects) return [];
  return EFFECT_ORDER.filter((key) => Math.abs(effects[key] ?? 0) > 0.01).map(
    (key) => EFFECT_LABELS[key],
  );
}