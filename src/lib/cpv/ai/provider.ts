import type { AIConfig, AIProvider, ChatMessage, ChatRequest } from "./types";

const DIRECT = process.env.NEXT_PUBLIC_SITES === "1";

/** 本地开发走本站代理；静态站（Qoder Sites）没有 Node 服务，直接连用户配置的端点。 */
export function createHttpProvider(config: AIConfig): AIProvider {
  async function chatDirect(request: ChatRequest) {
    const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: request.messages,
        tools: request.tools,
        temperature: request.temperature ?? 0.4,
        stream: false,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`模型请求失败（${response.status}）${text.slice(0, 160)}`);
    }
    const data = (await response.json()) as { choices?: { message?: ChatMessage }[] };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("模型未返回有效消息");
    return { message };
  }

  async function chatViaFunction(request: ChatRequest) {
    const response = await fetch("/functions/v1/app", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey || undefined,
        messages: request.messages,
        tools: request.tools,
        temperature: request.temperature,
      }),
    });
    if ((response.status === 404 || response.status === 405) && config.apiKey) {
      return chatDirect(request);
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(detail?.error ?? `模型请求失败（${response.status}）`);
    }
    const data = (await response.json()) as { choices?: { message?: ChatMessage }[] };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("模型未返回有效消息");
    return { message };
  }

  return {
    chat: async (request: ChatRequest) => {
      if (DIRECT) return chatViaFunction(request);
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: config.apiKey || undefined,
          messages: request.messages,
          tools: request.tools,
          temperature: request.temperature,
        }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `模型请求失败（${response.status}）`);
      }
      const data = (await response.json()) as { choices?: { message?: ChatMessage }[] };
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error("模型未返回有效消息");
      return { message };
    },
  };
}

