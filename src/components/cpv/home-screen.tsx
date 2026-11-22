"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFilmLine,
  RiFolderLine,
  RiSearchLine,
  RiUserLine,
} from "@remixicon/react";
import { Brand } from "@/components/cpv/brand";
import { isImageFile } from "@/lib/cpv/media";
import { formatDurationLabel } from "@/lib/cpv/media";
import type { ProjectRecord } from "@/lib/cpv/db";
import { formatProjectDate, useLibraryStore } from "@/stores/library-store";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ProjectRecord["status"], string> = {
  draft: "草稿",
  analyzing: "分析中",
  dna: "待编辑",
  editing: "编辑中",
  exported: "已导出",
};

function gradientCover(from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="1600" height="600" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 自定义背景统一压到 1600px 宽的 JPEG，避免把原图塞进项目库。 */
function compressCover(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(1, image.width));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("无法处理图片"));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.82);
      URL.revokeObjectURL(url);
      resolve(data);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    image.src = url;
  });
}

/** 内置背景：即使没有任何项目也能换背景。 */
const BUILTIN_COVERS = [
  gradientCover("#2b2722", "#6b3f2a"),
  gradientCover("#161a2b", "#3a4a7a"),
  gradientCover("#221a2b", "#6b3f5e"),
  gradientCover("#1d2622", "#1f5c4a"),
  gradientCover("#161616", "#4a4a4a"),
];

type TabKey = "home" | "projects" | "exported" | "drafts";

export function HomeScreen() {
  const init = useLibraryStore((s) => s.init);
  const ready = useLibraryStore((s) => s.ready);
  const loading = useLibraryStore((s) => s.loading);
  const error = useLibraryStore((s) => s.error);
  const profile = useLibraryStore((s) => s.profile);
  const profiles = useLibraryStore((s) => s.profiles);
  const projects = useLibraryStore((s) => s.projects);
  const refreshProjects = useLibraryStore((s) => s.refreshProjects);
  const createProject = useLibraryStore((s) => s.createProject);
  const createProfile = useLibraryStore((s) => s.createProfile);
  const switchProfile = useLibraryStore((s) => s.switchProfile);
  const updateProfile = useLibraryStore((s) => s.updateProfile);
  const openProject = useLibraryStore((s) => s.openProject);
  const removeProject = useLibraryStore((s) => s.removeProject);

  const [tab, setTab] = useState<TabKey>("home");
  const [search, setSearch] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      await init();
      await refreshProjects();
    })();
  }, [init, refreshProjects]);

  useEffect(() => {
    setSignature(profile?.bio ?? "");
  }, [profile?.id, profile?.bio]);

  const exported = useMemo(() => projects.filter((item) => item.status === "exported"), [projects]);
  const drafts = useMemo(() => projects.filter((item) => item.status !== "exported"), [projects]);
  const searched = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(keyword));
  }, [projects, search]);
  const recent = useMemo(
    () => searched.filter((project) => project.status !== "exported"),
    [searched],
  );

  const railProjects = tab === "exported" ? exported : tab === "drafts" ? drafts : searched;
  const covers = useMemo(() => {
    const thumbs = projects
      .map((project) => project.thumbnail)
      .filter((thumb): thumb is string => Boolean(thumb));
    return Array.from(new Set([...BUILTIN_COVERS, ...thumbs]));
  }, [projects]);
  const cover = profile?.cover || covers[0] || "";
  const latest = projects[0];

  async function handleCreateProject() {
    try {
      await createProject();
    } catch (cause) {
      console.error(cause);
    }
  }

  async function handleOpenProject(id: string) {
    setBusyId(id);
    try {
      await openProject(id);
    } finally {
      setBusyId(null);
    }
  }

  function handleDeleteProject(project: ProjectRecord) {
    if (!window.confirm(`删除项目「${project.name}」？`)) return;
    void removeProject(project.id);
  }

  async function handleCreateProfile() {
    if (!profileName.trim()) return;
    await createProfile(profileName.trim());
    setProfileName("");
    setProfileModalOpen(false);
    setProfileMenuOpen(false);
  }

  function cycleCover() {
    if (!covers.length) return;
    const current = profile?.cover && covers.includes(profile.cover) ? profile.cover : covers[0];
    const index = covers.indexOf(current);
    const next = covers[(index + 1) % covers.length];
    void updateProfile({ cover: next });
  }

  async function onCoverFile(file: File | undefined) {
    if (!file || !isImageFile(file)) return;
    if (file.size > 12 * 1024 * 1024) return;
    try {
      const next = await compressCover(file);
      await updateProfile({ cover: next });
    } catch {
      // 图片处理失败时保持原背景。
    } finally {
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  return (
    <div className="min-h-dvh bg-[#ecebe6] text-[#161616]">
      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Brand compact />
            <nav className="hidden items-center gap-1 md:flex">
              {[
                { key: "home" as TabKey, label: "首页" },
                { key: "projects" as TabKey, label: "项目" },
                { key: "exported" as TabKey, label: "成片" },
                { key: "drafts" as TabKey, label: "草稿" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "px-2.5 py-1.5 text-[11px] transition-transform hover:-translate-y-0.5",
                    tab === item.key ? "text-[#161616]" : "text-[#8a857b] hover:text-[#161616]",
                  )}
                >
                  {item.label}
                </button>
              ))}
              <span className="px-2.5 py-1.5 text-[11px] text-[#c0bab0]">素材</span>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <label className="hidden items-center gap-1.5 border border-[#ddd8cf] bg-white px-2 py-1.5 lg:flex">
              <RiSearchLine className="size-3.5 text-[#8a857b]" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索项目"
                className="w-28 bg-transparent text-[10px] outline-none placeholder:text-[#b4aea3]"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleCreateProject()}
              className="flex items-center gap-1.5 bg-[#161616] px-3 py-1.5 text-[10px] font-medium text-white hover:bg-[#2b2b2b]"
            >
              <RiAddLine className="size-3.5" aria-hidden="true" />
              新建项目
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((value) => !value)}
                className="flex items-center gap-2 border border-[#ddd8cf] bg-white px-2 py-1.5 text-[10px] hover:bg-[#f6f4ef]"
              >
                <span
                  className="flex size-5 items-center justify-center text-[9px] text-white"
                  style={{ backgroundColor: profile?.color ?? "#161616" }}
                >
                  {profile?.name.slice(0, 1) ?? "主"}
                </span>
                <span className="max-w-[90px] truncate">{profile?.name ?? "我的主页"}</span>
                <RiArrowDownSLine className="size-3 text-[#8a857b]" aria-hidden="true" />
              </button>
              {profileMenuOpen && (
                <div className="absolute right-0 top-full z-40 mt-1 w-56 border border-[#ddd8cf] bg-white p-1 shadow-lg">
                  <div className="px-2 py-1.5 text-[9px] uppercase tracking-[0.14em] text-[#a39d92]">
                    切换主页
                  </div>
                  {profiles.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        void switchProfile(item.id);
                        setProfileMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-2 py-2 text-left text-[11px] hover:bg-[#f6f4ef]"
                    >
                      <span
                        className="flex size-5 items-center justify-center text-[9px] text-white"
                        style={{ backgroundColor: item.color }}
                      >
                        {item.name.slice(0, 1)}
                      </span>
                      <span className="truncate">{item.name}</span>
                      {item.id === profile?.id && <span className="ml-auto text-[#d9482b]">当前</span>}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-[#eeeae1]" />
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setProfileModalOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-2 py-2 text-left text-[11px] hover:bg-[#f6f4ef]"
                  >
                    <RiUserLine className="size-3.5" aria-hidden="true" />
                    新建主页
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pt-3">
        <div className="relative h-[230px] overflow-hidden bg-[#2b2722]">
          {cover && (
            <img
              src={cover}
              alt=""
              className="absolute inset-0 h-full w-full scale-105 object-cover blur-[2px]"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#151412]/85 via-[#151412]/25 to-transparent" />
          {!cover && (
            <div className="absolute inset-0 flex items-end justify-end p-8 text-[120px] font-black leading-none text-white/[0.04]">
              CP
            </div>
          )}
          <div className="absolute right-3 top-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={cycleCover}
              className="border border-white/30 bg-black/30 px-2 py-1 text-[9px] text-white/90 backdrop-blur hover:bg-black/50"
            >
              换背景
            </button>
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="border border-white/30 bg-black/30 px-2 py-1 text-[9px] text-white/90 backdrop-blur hover:bg-black/50"
            >
              上传背景
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void onCoverFile(event.target.files?.[0])}
            />
          </div>
          <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-4">
            <div className="flex items-end gap-3">
              <div
                className="flex size-16 items-center justify-center border-2 border-white/80 text-[22px] font-semibold text-white shadow-lg"
                style={{ backgroundColor: profile?.color ?? "#161616" }}
              >
                {profile?.name.slice(0, 1) ?? "主"}
              </div>
              <div>
                <h1 className="text-[22px] font-medium leading-none text-white drop-shadow">
                  {profile?.name ?? "我的主页"}
                </h1>
                <input
                  value={signature}
                  onChange={(event) => setSignature(event.target.value)}
                  onBlur={() => {
                    const next = signature.trim();
                    if (next !== (profile?.bio ?? "")) void updateProfile({ bio: next });
                  }}
                  placeholder="写一句签名"
                  className="mt-2 w-64 max-w-full border-b border-white/40 bg-transparent pb-1 text-[10px] text-white/85 outline-none placeholder:text-white/40 focus:border-white/80"
                />
              </div>
            </div>
            <div className="hidden items-end gap-5 pb-1 text-right text-[9px] text-white/75 sm:flex">
              <div>
                <div className="font-mono text-[18px] text-white">{projects.length}</div>
                <div className="mt-1">项目</div>
              </div>
              <div>
                <div className="font-mono text-[18px] text-white">{exported.length}</div>
                <div className="mt-1">成片</div>
              </div>
              <div>
                <div className="font-mono text-[18px] text-white">
                  {latest ? formatProjectDate(latest.updatedAt) : "—"}
                </div>
                <div className="mt-1">最近更新</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5 overflow-x-auto border border-[#e1ddd4] border-t-0 bg-white px-5 py-3">
          {[
            { key: "home" as TabKey, label: "主页" },
            { key: "projects" as TabKey, label: "项目" },
            { key: "exported" as TabKey, label: "成片" },
            { key: "drafts" as TabKey, label: "草稿" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                "relative pb-1 text-[11px] transition-colors",
                tab === item.key ? "text-[#161616]" : "text-[#8a857b] hover:text-[#161616]",
              )}
            >
              {item.label}
              {tab === item.key && (
                <span className="absolute inset-x-0 -bottom-1.5 h-0.5 bg-[#d9482b]" />
              )}
            </button>
          ))}
          <span className="ml-auto hidden text-[9px] text-[#a39d92] sm:block">
            本地主页 · 项目保存在这台设备
          </span>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-5">
        {error && (
          <div className="mb-4 border-l-2 border-[#d9482b] bg-[#fbf3f0] px-3 py-2 text-[10px] text-[#a33722]">
            {error}
          </div>
        )}

        {!ready || loading ? (
          <div className="space-y-4">
            {[0, 1].map((row) => (
              <section key={row} className="border border-[#e1ddd4] bg-white p-4">
                <div className="h-3 w-24 animate-pulse bg-[#eeeae1]" />
                <div className="mt-3 flex gap-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="w-[220px] shrink-0">
                      <div className="h-[125px] animate-pulse bg-[#f0ede6]" />
                      <div className="mt-2 h-3 w-2/3 animate-pulse bg-[#eeeae1]" />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : tab === "home" ? (
          <div className="space-y-4">
            <ProjectSection
              title="最近项目"
              count={recent.length}
              onMore={() => setTab("projects")}
              empty="还没有项目。上传参考视频，生成第一条槽位时间线。"
              onCreate={() => void handleCreateProject()}
            >
              {recent.slice(0, 8).map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  busy={busyId === project.id}
                  onOpen={() => void handleOpenProject(project.id)}
                  onDelete={() => handleDeleteProject(project)}
                />
              ))}
            </ProjectSection>
            <ProjectSection
              title="成片"
              count={exported.length}
              onMore={() => setTab("exported")}
              empty="还没有导出成片。"
              onCreate={() => void handleCreateProject()}
            >
              {exported.slice(0, 8).map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  busy={busyId === project.id}
                  onOpen={() => void handleOpenProject(project.id)}
                  onDelete={() => handleDeleteProject(project)}
                />
              ))}
            </ProjectSection>
          </div>
        ) : (
          <ProjectSection
            title={tab === "exported" ? "成片" : tab === "drafts" ? "草稿" : "全部项目"}
            count={railProjects.length}
            hiddenMore
            empty={tab === "exported" ? "还没有导出成片。" : "还没有项目。"}
            onCreate={() => void handleCreateProject()}
          >
            {railProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={busyId === project.id}
                onOpen={() => void handleOpenProject(project.id)}
                onDelete={() => handleDeleteProject(project)}
              />
            ))}
          </ProjectSection>
        )}
      </main>

      <button
        type="button"
        onClick={() => setInfoOpen((value) => !value)}
        className="fixed right-0 top-1/3 z-30 flex h-28 w-8 items-center justify-center border border-r-0 border-[#ddd8cf] bg-white/95 text-[10px] text-[#6c675e] shadow-sm hover:w-9"
        style={{ writingMode: "vertical-rl" }}
      >
        信息中心
      </button>
      {infoOpen && (
        <aside className="fixed right-3 top-24 z-40 w-64 border border-[#ddd8cf] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-[#eeeae1] bg-[#faf9f6] px-3 py-2">
            <span className="text-[11px] font-medium">信息中心</span>
            <button
              type="button"
              onClick={() => setInfoOpen(false)}
              className="p-1 text-[#8a857b] hover:text-[#161616]"
              aria-label="关闭信息中心"
            >
              <RiCloseLine className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-2 p-3 text-[10px] text-[#6c675e]">
            <InfoRow label="主页" value={profile?.name ?? "—"} />
            <InfoRow label="项目" value={String(projects.length)} />
            <InfoRow label="成片" value={String(exported.length)} />
            <InfoRow label="最近更新" value={latest ? formatProjectDate(latest.updatedAt) : "—"} />
            <InfoRow label="存储" value="IndexedDB · 本地" />
          </div>
        </aside>
      )}

      {profileModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#161616]/40 p-4">
          <div className="w-full max-w-xs border border-[#ddd8cf] bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[12px] font-medium">新建主页</h2>
                <p className="mt-0.5 text-[9px] text-[#8a857b]">项目按主页隔离保存在本地。</p>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="p-1 text-[#8a857b] hover:text-[#161616]"
                aria-label="关闭"
              >
                <RiCloseLine className="size-4" aria-hidden="true" />
              </button>
            </div>
            <label htmlFor="profile-name" className="mt-4 block text-[9px] text-[#6c675e]">
              主页名称
            </label>
            <input
              id="profile-name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              autoFocus
              placeholder="例如：剪辑练习"
              className="mt-1 w-full border border-[#ddd8cf] px-2.5 py-2 text-[11px] outline-none focus:border-[#161616]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="border border-[#ddd8cf] px-3 py-1.5 text-[10px] text-[#6c675e] hover:bg-[#f6f4ef]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleCreateProfile()}
                disabled={!profileName.trim()}
                className="bg-[#161616] px-3 py-1.5 text-[10px] text-white hover:bg-[#2b2b2b] disabled:opacity-40"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectSection({
  title,
  count,
  onMore,
  hiddenMore,
  empty,
  onCreate,
  children,
}: {
  title: string;
  count: number;
  onMore?: () => void;
  hiddenMore?: boolean;
  empty: string;
  onCreate: () => void;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="border border-[#e1ddd4] bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[12px] font-medium">{title}</h2>
          <span className="font-mono text-[9px] text-[#a39d92]">{count}</span>
        </div>
        {!hiddenMore && count > 0 && (
          <button
            type="button"
            onClick={onMore}
            className="text-[9px] text-[#8a857b] hover:text-[#161616]"
          >
            查看更多
          </button>
        )}
      </div>
      {count === 0 ? (
        <div className="flex flex-col items-center justify-center border border-dashed border-[#ddd8cf] bg-[#faf9f6] px-4 py-8 text-center">
          <RiFolderLine className="size-4 text-[#a39d92]" aria-hidden="true" />
          <p className="mt-2 text-[10px] text-[#8a857b]">{empty}</p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-3 flex items-center gap-1.5 border border-[#161616] px-2.5 py-1.5 text-[9px] text-[#161616] hover:bg-[#f4f2ec]"
          >
            <RiAddLine className="size-3" aria-hidden="true" />
            新建项目
          </button>
        </div>
      ) : (
        <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={onCreate}
            className="flex h-[190px] w-[220px] shrink-0 flex-col items-center justify-center gap-2 border border-dashed border-[#d8d3c9] bg-[#faf9f6] text-[#8a857b] hover:border-[#161616]/40 hover:text-[#161616]"
          >
            <RiAddLine className="size-5" aria-hidden="true" />
            <span className="text-[10px]">新建项目</span>
          </button>
          {children}
        </div>
      )}
    </section>
  );
}

function ProjectCard({
  project,
  busy,
  onOpen,
  onDelete,
}: {
  project: ProjectRecord;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="group w-[220px] shrink-0 overflow-hidden rounded-lg bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-transform hover:-translate-y-1">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative h-[125px] bg-[#f0ede6]">
          {project.thumbnail ? (
            <img src={project.thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <RiFilmLine className="size-5 text-[#c9c3b8]" aria-hidden="true" />
            </div>
          )}
          <span className="absolute left-2 top-2 bg-white/95 px-1.5 py-0.5 text-[8px] text-[#6c675e]">
            {STATUS_LABEL[project.status]}
          </span>
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-[9px] text-[#161616]">
              打开中…
            </span>
          )}
        </div>
        <div className="p-3">
          <h3 className="truncate text-[12px] font-medium text-[#161616]">{project.name}</h3>
          <div className="mt-1.5 flex items-center justify-between text-[9px] text-[#8a857b]">
            <span>
              {project.duration ? formatDurationLabel(project.duration) : "未分析"}
              {project.bpm ? ` · ${project.bpm} BPM` : ""}
            </span>
            <span className="font-mono">{formatProjectDate(project.updatedAt)}</span>
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between border-t border-[#eeeae1] px-3 py-1.5">
        <span className="truncate text-[8px] text-[#a39d92]">
          {project.referenceName ?? "无参考片"}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1 text-[8px] text-[#a39d92] hover:text-[#d9482b]"
        >
          <RiDeleteBinLine className="size-3" aria-hidden="true" />
          删除
        </button>
      </div>
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#f0ede6] pb-1.5 last:border-0 last:pb-0">
      <span className="text-[#8a857b]">{label}</span>
      <span className="truncate text-[#161616]">{value}</span>
    </div>
  );
}