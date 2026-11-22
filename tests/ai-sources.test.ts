import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseGitHubRepo,
  parseGitHubTree,
  parseManifest,
} from "../src/lib/cpv/ai/sources";
import { clipToLibraryItem } from "../src/lib/cpv/ai/generation";

test("URL 清单支持数组与 {items} 两种形态，并区分图片/视频", () => {
  const arrayForm = parseManifest(
    [
      { name: "a", url: "https://x/a.mp4", duration: 3 },
      { name: "b", url: "https://x/b.png" },
      { name: "bad" },
    ],
    "src1",
  );
  assert.equal(arrayForm.length, 2);
  assert.equal(arrayForm[0].kind, "video");
  assert.equal(arrayForm[1].kind, "image");
  assert.equal(arrayForm[0].fileUrl, "https://x/a.mp4");

  const objectForm = parseManifest({ items: [{ url: "https://x/c.webm" }] }, "src1");
  assert.equal(objectForm.length, 1);
  assert.equal(objectForm[0].kind, "video");
});

test("GitHub 仓库地址多种写法都能解析", () => {
  assert.deepEqual(parseGitHubRepo("owner/repo"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGitHubRepo("https://github.com/owner/repo"), {
    owner: "owner",
    repo: "repo",
  });
  assert.deepEqual(parseGitHubRepo("https://github.com/owner/repo.git/"), {
    owner: "owner",
    repo: "repo",
  });
  assert.equal(parseGitHubRepo("not a repo"), null);
});

test("GitHub 文件树只保留媒体文件并生成 raw 下载地址", () => {
  const items = parseGitHubTree(
    [
      { path: "README.md", type: "blob" },
      { path: "clips/a.mp4", type: "blob" },
      { path: "clips/b.png", type: "blob" },
      { path: "clips", type: "tree" },
      { path: "audio/c.mp3", type: "blob" },
    ],
    "owner",
    "repo",
    "gh1",
  );
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.fileUrl?.startsWith("https://raw.githubusercontent.com/owner/repo/HEAD/")));
  assert.equal(items[0].kind, "video");
  assert.equal(items[1].kind, "image");
  assert.ok(items[0].tags?.includes("clips"));
});

test("GitHub 列表受 limit 约束", () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ path: `v/${i}.mp4`, type: "blob" }));
  assert.equal(parseGitHubTree(entries, "o", "r", "gh", 10).length, 10);
});

test("生成产物可转成素材索引项，进入同一挑选流程", () => {
  const item = clipToLibraryItem({ name: "gen.mp4", fileUrl: "https://x/gen.mp4", duration: 4 }, "gen1");
  assert.equal(item.kind, "video");
  assert.equal(item.id, "gen1");
  assert.ok(item.tags?.includes("ai-generated"));
});
