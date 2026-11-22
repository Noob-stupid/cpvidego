name: CPvidego · PR & Issues
description: 提 PR 前请读 CONTRIBUTING.md
body: |
  <!-- 一个 PR 只做一件事；引擎改动必须有测试 -->

  ## 动机 Why
  <!-- 这个 PR 解决什么问题？关联 issue 用 `closes #123` -->

  ## 改了什么 What
  - 

  ## 影响的层
  <!-- 勾选 -->
  - [ ] 分析/排片引擎 (src/lib/cpv)
  - [ ] 音乐轨道/混音
  - [ ] 导出/渲染
  - [ ] UI (src/components/cpv)
  - [ ] 状态/持久化
  - [ ] AI 层
  - [ ] 基座 (上游 OpenVideo 代码)

  ## 自测证据 Tests
  <!-- 必填。例：pnpm typecheck 通过；pnpm test 91/91；新增 xx 用例 -->
  - [ ] `pnpm typecheck` 通过
  - [ ] `pnpm test` 通过（新增用例：）
  - [ ] UI 改动已附前后截图
  - [ ] 用真实参考片 + 素材完整走过一遍 分析→初剪→导出

  ## 风险与回滚
  <!-- 数据格式变更（IndexedDB）必须写迁移/兼容说明 -->
