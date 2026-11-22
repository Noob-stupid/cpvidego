import type { GenerationProvider, GenerationRequest, GeneratedClip } from "./generation";

export interface ComfyConfig {
  baseUrl: string;
  workflowTemplate: string;
  clientId?: string;
}

export interface ComfyOutputFile {
  filename: string;
  subfolder?: string;
  type?: string;
}

const VIDEO_EXT = /\.(mp4|webm|gif|mov)$/i;

/** 把 {{prompt}}/{{seconds}}/{{width}}/{{height}}/{{seed}} 代入工作流模板（API 格式 JSON 文本）。 */
export function renderWorkflow(template: string, request: GenerationRequest): unknown {
  const seconds = request.durationSeconds ?? 4;
  const [width, height] =
    request.aspectRatio === "9:16" ? [576, 1024] : request.aspectRatio === "1:1" ? [768, 768] : [1024, 576];
  const substituted = template
    .replace(/\{\{prompt\}\}/g, JSON.stringify(request.prompt).slice(1, -1))
    .replace(/\{\{seconds\}\}/g, String(seconds))
    .replace(/\{\{width\}\}/g, String(width))
    .replace(/\{\{height\}\}/g, String(height))
    .replace(/\{\{seed\}\}/g, String(request.seed ?? Math.floor(Math.random() * 1e9)));
  return JSON.parse(substituted);
}

interface HistoryEntry {
  outputs?: Record<string, { gifs?: ComfyOutputFile[]; images?: ComfyOutputFile[]; videos?: ComfyOutputFile[] }>;
  status?: { completed?: boolean; status_str?: string };
}

/** 从 history 输出里挑第一个视频（优先）或图片文件。 */
export function extractOutput(entry: HistoryEntry | undefined): ComfyOutputFile | null {
  if (!entry?.outputs) return null;
  const buckets: ComfyOutputFile[] = [];
  for (const node of Object.values(entry.outputs)) {
    buckets.push(...(node.videos ?? []), ...(node.gifs ?? []), ...(node.images ?? []));
  }
  return buckets.find((file) => VIDEO_EXT.test(file.filename)) ?? buckets[0] ?? null;
}

export function isComplete(entry: HistoryEntry | undefined): boolean {
  return Boolean(entry?.status?.completed) || Boolean(entry && extractOutput(entry));
}

export function createComfyUIProvider(config: ComfyConfig): GenerationProvider {
  const base = () => config.baseUrl.replace(/\/+$/, "");
  return {
    id: "comfyui",
    label: "ComfyUI 本机桥",
    kind: "local-bridge",
    available: async () => {
      if (!config.baseUrl) return false;
      try {
        const response = await fetch(`${base()}/system_stats`);
        return response.ok;
      } catch {
        return false;
      }
    },
    generate: async (request): Promise<GeneratedClip> => {
      if (!config.baseUrl) throw new Error("未配置 ComfyUI 地址");
      if (!config.workflowTemplate.trim()) throw new Error("未提供工作流模板（API 格式 JSON）");
      const workflow = renderWorkflow(config.workflowTemplate, request);
      const submit = await fetch(`${base()}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: config.clientId ?? "cpvidego" }),
      });
      if (!submit.ok) throw new Error(`ComfyUI 提交失败（${submit.status}）`);
      const { prompt_id: promptId } = (await submit.json()) as { prompt_id?: string };
      if (!promptId) throw new Error("ComfyUI 未返回 prompt_id");

      const deadline = Date.now() + 180000;
      let file: ComfyOutputFile | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const history = await fetch(`${base()}/history/${promptId}`).then((r) =>
          r.ok ? r.json() : null,
        );
        const entry = (history as Record<string, HistoryEntry> | null)?.[promptId];
        if (entry?.status?.status_str === "error") throw new Error("ComfyUI 工作执行出错");
        if (isComplete(entry)) {
          file = extractOutput(entry);
          break;
        }
      }
      if (!file) throw new Error("ComfyUI 超时或未产出文件");

      const params = new URLSearchParams({
        filename: file.filename,
        subfolder: file.subfolder ?? "",
        type: file.type ?? "output",
      });
      const blob = await fetch(`${base()}/view?${params.toString()}`).then((r) => {
        if (!r.ok) throw new Error(`拉取生成结果失败（${r.status}）`);
        return r.blob();
      });
      return { name: file.filename, blob, duration: request.durationSeconds };
    },
  };
}

/** 示例模板（AnimateDiff 类节点仅作格式示例，实际以本机已装节点为准）。 */
export const EXAMPLE_WORKFLOW = `{
  "3": { "class_type": "KSampler", "inputs": { "seed": {{seed}}, "steps": 20, "cfg": 7, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] } },
  "5": { "class_type": "EmptyLatentImage", "inputs": { "width": {{width}}, "height": {{height}}, "batch_size": {{seconds}} } },
  "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{prompt}}", "clip": ["4", 1] } },
  "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "blurry, low quality", "clip": ["4", 1] } },
  "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
  "9": { "class_type": "VHS_VideoCombine", "inputs": { "frame_rate": 8, "loop_count": 0, "filename_prefix": "cpvidego", "format": "video/h264-mp4", "images": ["8", 0] } }
}`;
