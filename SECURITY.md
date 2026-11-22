# 安全政策 Security Policy

## 支持的版本

| 版本 | 支持状态 |
|---|---|
| 0.1.x（当前） | ✅ 支持 |
| < 0.1 | ⚠️ 请升级后复测 |

## 架构安全边界（先读这个）

CPvidego 是**纯客户端**应用，安全模型与常规服务端不同：

- **你的素材不上传**：分析、排片、导出全在浏览器内完成；
- **API Key 只存本机**（localStorage / 会话内存）。AI 设置里填的 Key 会直接向你配置的 baseUrl 发请求；开启「本地代理」时经 dev 路由或部署的 Edge Function 转发，函数不记录请求体；
- **静态部署的 Edge Function 是无状态转发器**：只转发 OpenAI 兼容 chat 请求，不执行任意 URL —— 但会拒绝非 http(s) 协议（见 `src/app/api/ai/chat/route.ts`）。自部署时请勿给函数配置高权限 secret，除非你自己加了鉴权。

## 报告漏洞

发现漏洞**不要开公开 Issue**。请通过以下任一方式私报：

1. GitHub 私有安全报告：[Security → Report a vulnerability](https://github.com/Noob-stupid/cpvidego/security/advisories/new)；
2. Issue 只写一句「发现安全问题，求联系渠道」，维护者会私信你。

请附上：受影响版本、复现步骤、可能的影响面。我们会在 72 小时内回复确认，修复前请暂缓公开细节。

## 已知边界（非漏洞）

- 浏览器内 WebCodecs 解码不可信视频文件导致的崩溃 → 属上游浏览器/编解码器问题，可复现请提 issue 我们缓解（文件大小与类型校验已有）；
- 用户自行配置的 baseUrl 指向恶意服务器 → 请求头会携带你的 Key，这由用户自己的配置决定，AI 设置面板已有提示；
- IndexedDB 数据可被同浏览器同源的任意脚本读取 → 与所有本地优先 Web 应用相同。

## Capability summary (English)

Client-side only; media never leaves the browser. AI keys are user-supplied, stored locally, and sent only to the user-configured endpoint (optionally via a stateless same-origin relay function). Report vulnerabilities privately via GitHub security advisories.
