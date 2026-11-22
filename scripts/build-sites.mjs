import { existsSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const apiDir = "src/app/api";
const hiddenDir = "src/app/_api_disabled";
let moved = false;

// 清掉 dev 期生成的 .next（含旧路由的 validator 类型），避免静态构建误报。
rmSync(".next", { recursive: true, force: true });

// Qoder Sites 只托管静态文件：构建窗口内把 API 路由移进私有目录（_ 前缀不参与路由）。
if (existsSync(apiDir)) {
  renameSync(apiDir, hiddenDir);
  moved = true;
}

try {
  const result = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, SITES_BUILD: "1", NEXT_PUBLIC_SITES: "1" },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (moved) renameSync(hiddenDir, apiDir);
}
