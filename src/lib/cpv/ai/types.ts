import type { ColorStats, CompositionStats, MotionStats, SlotEffects } from "../types";

export type AIProviderId = "deepseek" | "openai" | "ollama" | "custom";

export interface AIConfig {
  enabled: boolean;
  provider: AIProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface LibraryItem {
  id: string;
  name: string;
  kind: "video" | "image";
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
  color?: ColorStats;
  motion?: MotionStats;
  composition?: CompositionStats;
  tags?: string[];
  source: "local" | "pexels";
  previewUrl?: string;
  fileUrl?: string;
}

export interface SlotAssignment {
  slot: string | number;
  asset: string;
  reason?: string;
}

export interface SlotEffectPatch extends SlotEffects {
  slot: string | number;
}

export interface SlotSpeedPatch {
  slot: string | number;
  speed: number;
}

export interface EditProposal {
  assignments?: SlotAssignment[];
  effects?: SlotEffectPatch[];
  speeds?: SlotSpeedPatch[];
  audio?: { bgmVolume?: number; originalVolume?: number };
  summary?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface VisionPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | VisionPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
}

export interface AIProvider {
  chat(request: ChatRequest): Promise<{ message: ChatMessage }>;
}

export interface DirectorEvent {
  type: "stage" | "tool" | "result" | "error" | "done";
  message: string;
}

export interface DirectorResult {
  summary: string;
  reasons: Record<string, string>;
  applied: number;
  rejected: string[];
  rounds: number;
  log: string[];
}
