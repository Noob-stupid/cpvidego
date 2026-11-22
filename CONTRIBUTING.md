# 贡献指南 Contributing

欢迎加入 CPvidego 社区！提 bug、建议功能、直接改代码、分享一支用 CPvidego 剪的片子，都是贡献。

Thanks for your interest in CPvidego! Bugs, ideas, code and showcase posts are all welcome.

## 从哪开始

- 看 [Roadmap](docs/ROADMAP.md)，在对应 issue 下回复认领；
- [`good first issue`](https://github.com/Noob-stupid/cpvidego/labels/good%20first%20issue) 是最平滑的入口，通常是引擎纯函数级别的改动；
- 不确定方向先开 [Discussion](https://github.com/Noob-stupid/cpvidego/discussions)，别直接开写大 PR。

## 本地开发

要求 Node.js ≥ 20（建议 pnpm）。

```bash
pnpm install
pnpm dev            # http://localhost:3000，零后端可跑通全部主流程

# 提交前必跑
pnpm typecheck
pnpm test           # tsc -p tsconfig.test.json && node --test .tmp-test/tests/*.test.js
```

目录心智模型：

| 位置 | 性质 | 改动要求 |
|---|---|---|
| `src/lib/cpv/**` | 确定性引擎，纯函数、无 UI 依赖 | **必须带单测**（放 `tests/`），这是社区最欢迎的改动区 |
| `src/components/cpv/**` | 工作流 UI | PR 附改动前后截图 |
| `src/stores/**` | 状态与持久化 | 注意 IndexedDB 结构兼容，改动需在 PR 里说明迁移策略 |
| `src/lib/cpv/ai/**` | AI 建议层 | 不得让 AI 绕过确定性引擎直接决定成片 |
| 编辑器基座（其余） | 上游 OpenVideo | 谨慎小改，大改请开 issue 先讨论 |

## 提 Issue

- **Bug**：用 [模板](https://github.com/Noob-stupid/cpvidego/issues/new?template=bug_report.yml)，附复现步骤、浏览器与版本、控制台报错全文（脱敏密钥）、必要时附最小复现素材；
- **功能**：说清楚场景与收益，避免一句话需求；能附上参考片的节奏结构截图更好。

## 提 PR

1. Fork 后从 `main` 建分支（`feat/xxx`、`fix/xxx`、`engine/xxx`）；
2. 一个 PR 只做一件事；
3. 引擎改动跑 `pnpm test` 并新增用例；UI 改动附截图；
4. 提交信息说明动机（中英文均可）；
5. 按 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md) 填写；CI（typecheck + tests）必须绿。

## 代码风格

- 与现有代码一致：TypeScript strict、函数式优先、`src/lib/cpv` 内不引 React；
- 注释默认不写，只在写清楚"为什么"（隐藏约束、workaround）时写；
- 不引入新依赖除非确实必要，PR 里说明理由与替代方案比较。

## 行为准则与安全

交流请遵守 [行为准则](CODE_OF_CONDUCT.md)。发现安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 issue。
