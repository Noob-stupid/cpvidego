import type { LibraryItem } from "./types";

export type SourceKind = "local" | "pexels" | "manifest" | "github";

export interface SourceConfig {
  id: string;
  kind: SourceKind;
  label: string;
  url: string;
  token?: string;
}

export interface SourceProvider {
  id: string;
  label: string;
  kind: SourceKind;
  list(query?: string, limit?: number): Promise<LibraryItem[]>;
  resolve?(item: LibraryItem): Promise<Blob | null>;
}

const STORAGE_KEY = "cpv.sources";
const MEDIA_EXT = /\.(mp4|webm|mov|mkv|mp3|wav|ogg|m4a|png|jpe?g|webp)$/i;

export function loadSources(): SourceConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SourceConfig[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSources(sources: SourceConfig[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
}

const round = (value: number | undefined, digits = 2) =>
  value == null ? undefined : Math.round(value * 10 ** digits) / 10 ** digits;

interface ManifestEntry {
  name?: string;
  url?: string;
  type?: string;
  duration?: number;
  width?: number;
  height?: number;
  tags?: string[];
}

/** 任意地址返回的 JSON 清单（数组或 {items:[…]}），统一成素材索引。 */
export function parseManifest(data: unknown, sourceId: string): LibraryItem[] {
  const entries: ManifestEntry[] = Array.isArray(data)
    ? (data as ManifestEntry[])
    : Array.isArray((data as { items?: unknown })?.items)
      ? ((data as { items: ManifestEntry[] }).items)
      : [];
  return entries
    .filter((entry) => entry && typeof entry.url === "string")
    .map((entry, index) => {
      const isImage = /\.(png|jpe?g|webp)$/i.test(entry.url ?? "");
      return {
        id: `${sourceId}:${index}`,
        name: entry.name ?? `素材 ${index + 1}`,
        kind: isImage ? ("image" as const) : ("video" as const),
        duration: entry.duration,
        width: entry.width,
        height: entry.height,
        tags: entry.tags,
        source: "local" as const,
        fileUrl: entry.url,
      };
    });
}

export function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const match =
    /github\.com[/:]([^/]+)\/([^/]+)/i.exec(trimmed) ?? /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

interface GitHubTreeEntry {
  path: string;
  type: string;
  size?: number;
}

/** 把 GitHub 仓库的文件树过滤成媒体素材，raw 地址可直接下载。 */
export function parseGitHubTree(
  entries: GitHubTreeEntry[],
  owner: string,
  repo: string,
  sourceId: string,
  limit = 60,
): LibraryItem[] {
  return entries
    .filter((entry) => entry.type === "blob" && MEDIA_EXT.test(entry.path))
    .slice(0, limit)
    .map((entry, index) => {
      const isImage = /\.(png|jpe?g|webp)$/i.test(entry.path);
      const name = entry.path.split("/").pop() ?? entry.path;
      return {
        id: `${sourceId}:${index}`,
        name: `${repo}/${name}`,
        kind: isImage ? ("image" as const) : ("video" as const),
        size: entry.size,
        tags: [repo, ...entry.path.split("/").slice(0, -1)],
        source: "local" as const,
        fileUrl: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${entry.path}`,
      };
    });
}

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

export function manifestSource(config: SourceConfig): SourceProvider {
  return {
    id: config.id,
    label: config.label,
    kind: "manifest",
    list: async (query, limit = 60) => {
      const response = await fetch(config.url);
      if (!response.ok) throw new Error(`素材源 ${config.label} 不可达（${response.status}）`);
      const items = parseManifest(await response.json(), config.id);
      const filtered = query
        ? items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
        : items;
      return filtered.slice(0, limit);
    },
    resolve: (item) => (item.fileUrl ? fetchBlob(item.fileUrl) : Promise.resolve(null)),
  };
}

export function githubSource(config: SourceConfig): SourceProvider {
  const parsed = parseGitHubRepo(config.url);
  return {
    id: config.id,
    label: config.label,
    kind: "github",
    list: async (query, limit = 60) => {
      if (!parsed) throw new Error("GitHub 仓库格式应为 owner/repo 或完整 URL");
      const response = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/HEAD?recursive=1`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
          },
        },
      );
      if (!response.ok) throw new Error(`GitHub 仓库不可达（${response.status}）`);
      const data = (await response.json()) as { tree?: GitHubTreeEntry[] };
      const items = parseGitHubTree(data.tree ?? [], parsed.owner, parsed.repo, config.id, limit);
      return query
        ? items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
        : items;
    },
    resolve: async (item) => {
      if (!item.fileUrl) return null;
      const candidates = [
        item.fileUrl,
        `https://ghproxy.net/${item.fileUrl}`,
        `https://mirror.ghproxy.com/${item.fileUrl}`,
      ];
      for (const url of candidates) {
        const blob = await fetchBlob(url);
        if (blob) return blob;
      }
      return null;
    },
  };
}

export function buildSourceProvider(config: SourceConfig): SourceProvider | null {
  if (config.kind === "manifest") return manifestSource(config);
  if (config.kind === "github") return githubSource(config);
  return null;
}

/** 探活：取一条素材验证源可达，返回可读结果。 */
export async function probeSource(
  config: SourceConfig,
): Promise<{ ok: boolean; message: string }> {
  const provider = buildSourceProvider(config);
  if (!provider) return { ok: false, message: "内置源无需探活" };
  try {
    const items = await provider.list(undefined, 1);
    return { ok: true, message: `可达，示例：${items[0]?.name ?? "（空）"}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "不可达" };
  }
}

export function sourceStats(item: LibraryItem) {
  return {
    luma: item.color ? Math.round(item.color.luma) : undefined,
    sat: item.color ? round(item.color.saturation) : undefined,
  };
}
