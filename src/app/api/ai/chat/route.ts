import { type NextRequest, NextResponse } from "next/server";
import { canUseEnvKey } from "@/lib/cpv/ai/config";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体无效" }, { status: 400 });

  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
  const model = typeof body.model === "string" ? body.model : "";
  const messages = body.messages;
  if (!baseUrl || !model || !Array.isArray(messages)) {
    return NextResponse.json({ error: "缺少 baseUrl / model / messages" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return NextResponse.json({ error: "baseUrl 不是合法 URL" }, { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return NextResponse.json({ error: "baseUrl 仅支持 http/https" }, { status: 400 });
  }

  let key = typeof body.apiKey === "string" && body.apiKey ? body.apiKey : "";
  if (!key && canUseEnvKey(baseUrl)) {
    key =
      process.env.DEEPSEEK_API_KEY ||
      process.env.AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "";
  }
  if (!key) {
    return NextResponse.json(
      { error: "需要 API Key：在 AI 设置中填写，或为官方端点配置服务端环境变量" },
      { status: 400 },
    );
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
        temperature: body.temperature ?? 0.4,
        stream: false,
      }),
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `上游 ${upstream.status}：${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const data = await upstream.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法连接模型端点" },
      { status: 502 },
    );
  }
}
