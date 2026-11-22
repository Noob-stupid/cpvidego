const ENV_KEY_HOSTS = [
  "api.deepseek.com",
  "api.openai.com",
  "api.moonshot.cn",
  "dashscope.aliyuncs.com",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    return json({ ok: true, service: "cpvidego-ai", path: url.pathname });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
  const model = typeof body.model === "string" ? body.model : "";
  const messages = body.messages;
  if (!baseUrl || !model || !Array.isArray(messages)) {
    return json({ error: "缺少 baseUrl / model / messages" }, 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return json({ error: "baseUrl 不是合法 URL" }, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return json({ error: "baseUrl 仅支持 http/https" }, 400);
  }

  let key = typeof body.apiKey === "string" ? body.apiKey : "";
  if (!key && ENV_KEY_HOSTS.includes(parsed.hostname)) {
    key = Deno.env.get("AI_API_KEY") ?? "";
  }
  if (!key) {
    return json({ error: "需要 API Key：在 AI 设置中填写，或为站点配置 AI_API_KEY" }, 400);
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: body.tools,
        temperature: typeof body.temperature === "number" ? body.temperature : 0.4,
        stream: false,
      }),
    });
    const text = await upstream.text();
    if (!upstream.ok) return json({ error: `上游 ${upstream.status}: ${text.slice(0, 300)}` }, 502);
    return new Response(text, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "无法连接模型端点" }, 502);
  }
});
