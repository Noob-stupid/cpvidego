import { create } from "zustand";
import {
  assetFileKey,
  bgmFileKey,
  deleteProject as deleteProjectDb,
  formatProjectDate,
  getActiveProfileId,
  getFile,
  getProject,
  getProjectData,
  isFileSaved,
  listProfiles,
  listProjects,
  makeProfile,
  markFileSaved,
  newId,
  putFile,
  putProfile,
  putProject,
  putProjectData,
  pruneProjectAssetFiles,
  referenceFileKey,
  setActiveProfileId,
  type ProfileRecord,
  type ProjectAssetMeta,
  type ProjectRecord,
} from "@/lib/cpv/db";
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_BEAT_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  type MediaAsset,
} from "@/lib/cpv/types";
import { useCPVStore } from "@/stores/cpv-store";

interface LibraryState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  storageWarning: string | null;
  profile: ProfileRecord | null;
  profiles: ProfileRecord[];
  projects: ProjectRecord[];
  currentProjectId: string | null;
  lastSavedAt: number | null;

  init: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProfile: (name: string) => Promise<ProfileRecord>;
  switchProfile: (profileId: string) => Promise<void>;
  updateProfile: (patch: Partial<ProfileRecord>) => Promise<void>;
  createProject: () => Promise<string>;
  renameCurrentProject: (name: string) => Promise<void>;
  saveCurrentProject: () => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  setCurrentProjectId: (projectId: string | null) => void;
}

let initPromise: Promise<void> | null = null;
const bgmSignatures = new Map<string, string>();

function bgmSignature(asset: MediaAsset) {
  return `${asset.name}|${asset.size ?? 0}|${asset.file?.lastModified ?? 0}`;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  ready: false,
  loading: false,
  error: null,
  storageWarning: null,
  profile: null,
  profiles: [],
  projects: [],
  currentProjectId: null,
  lastSavedAt: null,

  init: async () => {
    if (get().ready) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      set({ loading: true, error: null });
      try {
        let profiles = await listProfiles();
        if (profiles.length === 0) {
          const first = makeProfile("我的主页", 0);
          await putProfile(first);
          profiles = [first];
        }
        const activeId = getActiveProfileId();
        const profile = profiles.find((item) => item.id === activeId) ?? profiles[0];
        setActiveProfileId(profile.id);
        const projects = await listProjects(profile.id);
        set({ profile, profiles, projects, ready: true, loading: false });
      } catch (error) {
        set({
          loading: false,
          ready: true,
          error: error instanceof Error ? error.message : "本地项目库不可用",
        });
      }
    })();
    return initPromise;
  },

  refreshProjects: async () => {
    const profile = get().profile;
    if (!profile) return;
    const projects = await listProjects(profile.id);
    set({ projects });
  },

  createProfile: async (name) => {
    const currentCount = get().profiles.length;
    const profile = makeProfile(name, currentCount);
    await putProfile(profile);
    setActiveProfileId(profile.id);
    const projects = await listProjects(profile.id);
    set({
      profile,
      profiles: [...get().profiles, profile],
      projects,
      currentProjectId: null,
    });
    useCPVStore.getState().reset();
    return profile;
  },

  switchProfile: async (profileId) => {
    const profile = get().profiles.find((item) => item.id === profileId);
    if (!profile) return;
    setActiveProfileId(profile.id);
    const projects = await listProjects(profile.id);
    set({ profile, projects, currentProjectId: null });
    useCPVStore.getState().reset();
  },

  updateProfile: async (patch) => {
    const profile = get().profile;
    if (!profile) return;
    const next = { ...profile, ...patch };
    await putProfile(next);
    set({
      profile: next,
      profiles: get().profiles.map((item) => (item.id === next.id ? next : item)),
    });
  },

  createProject: async () => {
    if (!get().profile) await get().init();
    const profile = get().profile;
    if (!profile) throw new Error("请先创建主页");
    const now = Date.now();
    const record: ProjectRecord = {
      id: newId(),
      profileId: profile.id,
      name: "未命名项目",
      createdAt: now,
      updatedAt: now,
      status: "draft",
    };
    await putProject(record);
    useCPVStore.getState().reset();
    useCPVStore.getState().setStep("upload");
    set({ currentProjectId: record.id, lastSavedAt: null });
    await get().refreshProjects();
    return record.id;
  },

  renameCurrentProject: async (name) => {
    const projectId = get().currentProjectId;
    if (!projectId) return;
    const record = await getProject(projectId);
    if (!record) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === record.name) return;
    await putProject({ ...record, name: trimmed, updatedAt: Date.now() });
    await get().refreshProjects();
  },

  saveCurrentProject: async () => {
    const profile = get().profile;
    if (!profile) return;
    const state = useCPVStore.getState();
    let projectId = get().currentProjectId;
    let existing = projectId ? await getProject(projectId) : undefined;

    if (!projectId) {
      projectId = newId();
      existing = {
        id: projectId,
        profileId: profile.id,
        name: "未命名项目",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "draft",
      };
      set({ currentProjectId: projectId });
    }

    const reference = state.reference;
    const now = Date.now();
    const fallbackName = reference?.name.replace(/\.[^.]+$/, "") || "未命名项目";
    const name =
      !existing?.name || existing.name === "未命名项目" ? fallbackName : existing.name;
    const status =
      state.step === "editor"
        ? "editing"
        : state.step === "dna"
          ? "dna"
          : state.step === "analyzing"
            ? "analyzing"
            : "draft";
    const slots = state.slots;
    const analysis = state.analysis;
    const thumbnail =
      slots[0]?.thumbnailUrl ?? analysis?.shots[0]?.thumbnailUrl ?? existing?.thumbnail;

    const meta: ProjectRecord = {
      id: projectId,
      profileId: profile.id,
      name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      status,
      thumbnail,
      referenceName: reference?.name ?? existing?.referenceName,
      duration: analysis?.analyzedDuration ?? existing?.duration,
      bpm: analysis?.bpm ?? existing?.bpm,
      shotCount: analysis?.shots.length ?? existing?.shotCount,
    };
    await putProject(meta);

    const userAssets = state.assets.filter((asset) => asset.origin === "user");
    const fileKeyByAsset = new Map<string, string>();
    const fileByKey = new Map<string, File>();
    for (const asset of userAssets) {
      if (!asset.file) continue;
      const key = assetFileKey(projectId, asset.fileId ?? asset.id);
      fileKeyByAsset.set(asset.id, key);
      if (!fileByKey.has(key)) fileByKey.set(key, asset.file);
    }

    const assetsMeta: ProjectAssetMeta[] = userAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      thumbnail: asset.thumbnailUrl,
      sourceIn: asset.sourceIn,
      sourceOut: asset.sourceOut,
      fileKey: fileKeyByAsset.get(asset.id),
      fileId: asset.fileId,
      groupName: asset.groupName,
      colorStats: asset.colorStats,
      motionStats: asset.motionStats,
      compositionStats: asset.compositionStats,
      sourceTag: asset.sourceTag,
      tags: asset.tags,
    }));

    await putProjectData({
      id: projectId,
      analysis: analysis ?? undefined,
      slots,
      assetsMeta,
      referenceMeta: reference
        ? {
            duration: reference.duration ?? 0,
            width: reference.width ?? 0,
            height: reference.height ?? 0,
          }
        : undefined,
      bgmName: state.bgm?.name,
      matchSettings: state.matchSettings,
      audioSettings: state.audioSettings,
      editKind: state.editKind,
      beatSettings: state.beatSettings,
      beatGrid: state.beatGrid,
      styleTarget: state.styleTarget,
      audioClips: state.audioClips,
    });

    try {
      if (reference?.file) {
        const key = referenceFileKey(projectId);
        if (!isFileSaved(key)) await putFile(key, reference.file);
      }
      for (const [key, file] of fileByKey) {
        if (!isFileSaved(key)) await putFile(key, file);
      }
      await pruneProjectAssetFiles(projectId, new Set(fileByKey.keys()));
      if (state.bgm?.file) {
        const key = bgmFileKey(projectId);
        const signature = bgmSignature(state.bgm);
        if (bgmSignatures.get(key) !== signature) {
          await putFile(key, state.bgm.file);
          bgmSignatures.set(key, signature);
        }
      }
    } catch {
      set({
        storageWarning: "本地存储空间不足，素材文件未能保存；重开项目可能缺素材。请删除旧项目或导出后清理。",
      });
    }

    set({ lastSavedAt: now });
    await get().refreshProjects();
  },

  openProject: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      if (estimate?.quota && estimate.usage != null && estimate.usage / estimate.quota > 0.85) {
        set({
          storageWarning: `本地存储已用 ${Math.round((estimate.usage / estimate.quota) * 100)}%，接近上限；建议清理旧项目。`,
        });
      } else {
        set({ storageWarning: null });
      }
      const meta = await getProject(projectId);
      const data = await getProjectData(projectId);
      if (!meta || !data) throw new Error("项目数据不存在");

      const referenceBlob = await getFile(referenceFileKey(projectId));
      if (!referenceBlob) throw new Error("参考片文件缺失");
      const referenceFile = new File([referenceBlob], meta.referenceName || "reference.mp4", {
        type: referenceBlob.type || "video/mp4",
      });
      const reference: MediaAsset = {
        id: "reference",
        kind: "video",
        name: referenceFile.name,
        url: URL.createObjectURL(referenceBlob),
        file: referenceFile,
        duration: data.referenceMeta?.duration ?? meta.duration,
        width: data.referenceMeta?.width,
        height: data.referenceMeta?.height,
        origin: "reference",
      };

      const userAssets: MediaAsset[] = [];
      for (const assetMeta of data.assetsMeta) {
        const fileKey = assetMeta.fileKey ?? assetFileKey(projectId, assetMeta.fileId ?? assetMeta.id);
        const blob = await getFile(fileKey);
        if (!blob) continue;
        markFileSaved(fileKey);
        const file = new File([blob], assetMeta.name, { type: blob.type || "video/mp4" });
        userAssets.push({
          id: assetMeta.id,
          kind: assetMeta.kind,
          name: assetMeta.name,
          url: URL.createObjectURL(blob),
          file,
          duration: assetMeta.duration,
          width: assetMeta.width,
          height: assetMeta.height,
          thumbnailUrl: assetMeta.thumbnail,
          sourceIn: assetMeta.sourceIn,
          sourceOut: assetMeta.sourceOut,
          fileId: assetMeta.fileId,
          groupName: assetMeta.groupName,
          colorStats: assetMeta.colorStats,
          motionStats: assetMeta.motionStats,
          compositionStats: assetMeta.compositionStats,
          sourceTag: assetMeta.sourceTag,
          tags: assetMeta.tags,
          origin: "user",
        });
      }

      let bgm: MediaAsset | null = null;
      if (data.bgmName) {
        const blob = await getFile(bgmFileKey(projectId));
        if (blob) {
          markFileSaved(bgmFileKey(projectId));
          const file = new File([blob], data.bgmName, { type: blob.type || "audio/mpeg" });
          bgm = {
            id: "bgm",
            kind: "audio",
            name: data.bgmName,
            url: URL.createObjectURL(blob),
            file,
            origin: "user",
          };
          bgmSignatures.set(bgmFileKey(projectId), bgmSignature(bgm));
        }
      }

      const slots = (data.slots ?? []).map((slot) => ({
        ...slot,
        speed: slot.speed ?? 1,
        volume: slot.volume ?? 1,
      }));
      markFileSaved(referenceFileKey(projectId));
      useCPVStore.setState({
        reference,
        analysis: data.analysis ?? null,
        assets: [reference, ...userAssets],
        slots,
        bgm,
        mode: "simple",
        selectedSlotId: slots[0]?.id ?? null,
        step: slots.length > 0 ? "editor" : "dna",
        matchSettings: { ...DEFAULT_MATCH_SETTINGS, ...(data.matchSettings ?? {}) },
        audioSettings: { ...DEFAULT_AUDIO_SETTINGS, ...(data.audioSettings ?? {}) },
        editKind: data.editKind ?? "style",
        beatSettings: { ...DEFAULT_BEAT_SETTINGS, ...(data.beatSettings ?? {}) },
        beatGrid: data.beatGrid ?? null,
        draftReport: null,
        styleTarget: data.styleTarget ?? null,
        audioClips: data.audioClips ?? [],
      });
      set({ currentProjectId: projectId, loading: false, lastSavedAt: meta.updatedAt });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "打开项目失败",
      });
    }
  },

  removeProject: async (projectId) => {
    await deleteProjectDb(projectId);
    if (get().currentProjectId === projectId) set({ currentProjectId: null });
    await get().refreshProjects();
  },

  setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),
}));

export { formatProjectDate };