import type { DraftReport } from "../plan-quality";
import type { MediaAsset, Slot } from "../types";
import { buildLibraryIndex, buildTimelineIndex } from "./library";
import { sanitizeProposal } from "./plan";
import type {
  AIProvider,
  ChatMessage,
  DirectorEvent,
  DirectorResult,
  EditProposal,
  LibraryItem,
  ToolCall,
  ToolSpec,
} from "./types";

export interface DirectorDeps {
  provider: AIProvider;
  styleProfile: () => unknown;
  listMaterials: (args: {
    query?: string;
    source?: string;
    limit?: number;
  }) => Promise<LibraryItem[]>;
  timeline: () => Slot[];
  apply: (proposal: EditProposal) => {
    report: DraftReport;
    reasons: Record<string, string>;
    applied: number;
    rejected: string[];
  };
  evaluate: () => DraftReport;
  importItem?: (item: LibraryItem) => Promise<MediaAsset | null>;
}

const SLOT_REF = {
  oneOf: [{ type: "string" }, { type: "integer" }],
  description: "槽位 id 或从 0 开始的序号",
};

export const DIRECTOR_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "get_style_profile",
      description: "读取参考片的风格档案：BPM、切点节奏、色彩/运动/构图统计与风格标签。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_materials",
      description:
        "查询可接入的素材库（本地或 Pexels 在线）。返回每条素材的 id 与亮度/饱和/横移/构图统计，供你挑选。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "关键词，可空" },
          source: {
            type: "string",
            description: "素材源 id：local（本地）/ pexels（在线）/ 或用户已登记的自定义源（URL 清单、GitHub 仓库）",
          },
          limit: { type: "integer", description: "最多返回条数" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_timeline",
      description: "读取当前时间线：每个槽位的 id、时长、参考目标色调与当前素材。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_edit",
      description:
        "提交剪辑提案：为槽位指定素材（可附理由）、效果强度、变速与混音。系统会校验并应用，返回体检报告。",
      parameters: {
        type: "object",
        properties: {
          assignments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                slot: SLOT_REF,
                asset: { type: "string", description: "素材 id，必须来自 list_materials" },
                reason: { type: "string", description: "一句中文理由" },
              },
              required: ["slot", "asset"],
            },
          },
          effects: {
            type: "array",
            items: {
              type: "object",
              properties: {
                slot: SLOT_REF,
                flash: { type: "number" },
                shake: { type: "number" },
                zoom: { type: "number" },
                rgb: { type: "number" },
                glitch: { type: "number" },
                grade: { type: "number" },
              },
              required: ["slot"],
            },
          },
          speeds: {
            type: "array",
            items: {
              type: "object",
              properties: { slot: SLOT_REF, speed: { type: "number" } },
              required: ["slot", "speed"],
            },
          },
          audio: {
            type: "object",
            properties: {
              bgmVolume: { type: "number" },
              originalVolume: { type: "number" },
            },
          },
          summary: { type: "string", description: "整体剪辑思路，中文" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_draft",
      description: "对当前时间线跑体检：空洞/切点漂移/色彩残差/黑场/频闪/卡点命中率与 0-100 分。",
      parameters: { type: "object", properties: {} },
    },
  },
];

const SYSTEM_PROMPT = `你是 CPvidego 的剪辑导演。你只通过工具操作一个确定性剪辑引擎，不直接渲染像素。
规则：
1. 先 get_style_profile 与 get_timeline 理解参考风格与槽位结构；需要选材时调用 list_materials，可跨 local/pexels/自定义源查询。
2. 只能使用 list_materials 返回的素材 id；槽位时长不可更改，素材会被自动适配。
3. 选材要匹配槽位目标色调与构图，并避免同一条素材过度重复；优先有动作/主体的镜头，避开近黑近白。
4. 效果克制：闪白/震屏只给高能量或重拍镜头；整片闪白不超过每秒 2 次。变速保持在 0.3×–3×，不要极端快进或近静止。
5. 用 propose_edit 提交提案并附中文理由；随后用 evaluate_draft 看体检分，若低于 85 或出现 error，修正后再提交一次。
6. 最后用一句中文总结你的剪辑思路。不要输出与剪辑无关的内容。`;

function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function runDirector(
  deps: DirectorDeps,
  task: string,
  onEvent: (event: DirectorEvent) => void = () => undefined,
  maxRounds = 6,
): Promise<DirectorResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];
  const log: string[] = [];
  const itemById = new Map<string, LibraryItem>();
  let last = { report: null as DraftReport | null, reasons: {}, applied: 0, rejected: [] as string[] };
  let summary = "";
  let rounds = 0;
  let usedTools = true;

  const execute = async (call: ToolCall): Promise<unknown> => {
    const args = parseArgs(call);
    const name = call.function.name;
    log.push(`→ ${name}`);
    onEvent({ type: "tool", message: name });
    switch (name) {
      case "get_style_profile":
        return deps.styleProfile();
      case "get_timeline":
        return JSON.parse(buildTimelineIndex(deps.timeline()));
      case "list_materials": {
        const items = await deps.listMaterials({
          query: typeof args.query === "string" ? args.query : undefined,
          source: typeof args.source === "string" ? args.source : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
        for (const item of items) itemById.set(item.id, item);
        return JSON.parse(buildLibraryIndex(items));
      }
      case "evaluate_draft":
        return deps.evaluate();
      case "propose_edit": {
        const proposal = sanitizeProposal(args);
        if (deps.importItem) {
          for (const assignment of proposal.assignments ?? []) {
            const item = itemById.get(assignment.asset);
            if (item && item.source !== "local") {
              onEvent({ type: "stage", message: `导入在线素材 ${item.name}` });
              await deps.importItem(item);
            }
          }
        }
        last = deps.apply(proposal);
        if (proposal.summary) summary = proposal.summary;
        log.push(`← 应用 ${last.applied} 项，拒绝 ${last.rejected.length} 项`);
        onEvent({ type: "result", message: `应用 ${last.applied} 项修改` });
        return {
          applied: last.applied,
          rejected: last.rejected,
          score: last.report?.score,
          issues: last.report?.issues,
        };
      }
      default:
        return { error: `未知工具 ${name}` };
    }
  };

  while (rounds < maxRounds) {
    rounds += 1;
    onEvent({ type: "stage", message: `导演思考 ${rounds}/${maxRounds}` });
    let message: ChatMessage;
    try {
      const response = await deps.provider.chat({
        messages,
        tools: usedTools ? DIRECTOR_TOOLS : undefined,
        temperature: 0.4,
      });
      message = response.message;
    } catch (error) {
      if (usedTools) {
        usedTools = false;
        messages.push({
          role: "user",
          content:
            "该端点不支持工具调用。请改为只输出一个 JSON 对象（propose_edit 的参数格式），不要其它文字。",
        });
        continue;
      }
      onEvent({ type: "error", message: error instanceof Error ? error.message : "模型调用失败" });
      throw error;
    }

    if (message.tool_calls?.length) {
      messages.push(message);
      for (const call of message.tool_calls) {
        const result = await execute(call);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    summary = typeof message.content === "string" ? message.content : summary;
    if (!last.applied && summary) {
      const proposal = sanitizeProposal(extractJson(summary));
      if (proposal.assignments?.length || proposal.effects?.length) {
        last = deps.apply(proposal);
        log.push(`← JSON 兜底应用 ${last.applied} 项`);
      }
    }
    break;
  }

  onEvent({ type: "done", message: summary || "导演完成" });
  return {
    summary,
    reasons: last.reasons,
    applied: last.applied,
    rejected: last.rejected,
    rounds,
    log,
  };
}
