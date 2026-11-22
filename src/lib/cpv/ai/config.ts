import type { AIConfig, AIProviderId } from "./types";

const STORAGE_KEY = "cpv.ai.config";

export const AI_PRESETS: Record<
  AIProviderId,
  { label: string; baseUrl: string; model: string; needsKey: boolean }
> = {
  deepseek: {
    label: "DeepSeek（示例）",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    needsKey: true,
  },
  openai: {
    label: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    needsKey: true,
  },
  ollama: {
    label: "本地 Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    needsKey: false,
  },
  custom: {
    label: "自定义端点",
    baseUrl: "",
    model: "",
    needsKey: true,
  },
};

export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: false,
  provider: "deepseek",
  baseUrl: AI_PRESETS.deepseek.baseUrl,
  model: AI_PRESETS.deepseek.model,
  apiKey: "",
};

export function loadAIConfig(): AIConfig {
  if (typeof window === "undefined") return { ...DEFAULT_AI_CONFIG };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_CONFIG };
    return { ...DEFAULT_AI_CONFIG, ...(JSON.parse(raw) as Partial<AIConfig>) };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export function saveAIConfig(config: AIConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function presetFor(provider: AIProviderId): Partial<AIConfig> {
  const preset = AI_PRESETS[provider];
  return { provider, baseUrl: preset.baseUrl, model: preset.model };
}

/** 只有这些官方端点才允许回落到服务端环境变量里的 Key，避免把 Key 发去任意地址。 */
export const ENV_KEY_HOSTS = [
  "api.deepseek.com",
  "api.openai.com",
  "api.moonshot.cn",
  "dashscope.aliyuncs.com",
];

export function canUseEnvKey(baseUrl: string): boolean {
  try {
    return ENV_KEY_HOSTS.includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}
