# CPvidego 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-22

首次公开发布（source-available）。编辑器基座为 OpenVideo 0.1.6（`@openvideo/core` / `engine-pixi` / `timeline` 1.3.1）。

### Added

- **分析引擎**：镜头切点检测、BPM / 节拍网格、踩点率评分、镜头时长分布；长视频自适应降帧采样（>90s→3fps，>240s→2fps，帧数上限 1200）；
- **一键初剪（双模式）**：「复刻剪辑」按参考切点结构排片，「踩点成片」按鼓点重排；输出可编辑时间线草稿与 0–100 质量评分；
- **素材适配**：长素材高光扫描取段、短素材慢放填槽，速度夹在观感安全区（0.4–2.5×）；图片素材按槽位铺满；
- **音乐轨道编辑**：分段重复 / 变速 / 音量（0–200%）/ 淡入淡出 / 循环；纯函数模型（`audio-track.ts`）+ 预览导出共用同一音量包络；
- **参考音床**：默认以参考片整条音频为连续音乐床，素材原声默认静音；
- **逐槽色彩匹配** 与 7 项卡点效果（闪黑、缩放、摇摆等），全部对齐节拍；
- **AI 导演（可选）**：任意 OpenAI 兼容 API + VLM 素材打标；Key 仅存本地，AI 只做建议不接管成片；本地开发代理 + 静态部署 Edge Function 两种通道；
- **浏览器内 1080p MP4 导出**（WebCodecs + Remotion），预览与导出口径一致；
- **本地项目库**：项目 / 素材 / 音频轨持久化于 IndexedDB / OPFS，自定义封面、重命名、续作；
- **静态部署**：`pnpm build:sites` 一键纯静态导出，可部署到任意静态托管；
- 91 个单元测试覆盖全部引擎纯函数。

[0.1.0]: https://github.com/Noob-stupid/cpvidego/releases/tag/v0.1.0

<!-- 上游 OpenVideo 的变更历史见其仓库；本文件只记录 CPvidego 层。 -->
