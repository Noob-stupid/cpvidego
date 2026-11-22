import { generateUUID } from "@/utils/id";
import type { BeatGrid } from "./beat-grid";
import type {
  AnalysisResult,
  AudioClip,
  AudioSettings,
  BeatSettings,
  ColorStats,
  CompositionStats,
  EditKind,
  MatchSettings,
  MediaKind,
  MotionStats,
  ShotTags,
  Slot,
} from "./types";

export interface ProfileRecord {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  bio?: string;
  cover?: string;
}

export type ProjectStatus = "draft" | "analyzing" | "dna" | "editing" | "exported";

export interface ProjectRecord {
  id: string;
  profileId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: ProjectStatus;
  thumbnail?: string;
  referenceName?: string;
  duration?: number;
  bpm?: number;
  shotCount?: number;
}

export interface ProjectAssetMeta {
  id: string;
  name: string;
  kind: MediaKind;
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  sourceIn?: number;
  sourceOut?: number;
  fileKey?: string;
  fileId?: string;
  groupName?: string;
  colorStats?: ColorStats;
  motionStats?: MotionStats;
  compositionStats?: CompositionStats;
  sourceTag?: string;
  tags?: ShotTags;
}

export interface ProjectDataRecord {
  id: string;
  analysis?: AnalysisResult;
  slots?: Slot[];
  assetsMeta: ProjectAssetMeta[];
  referenceMeta?: { duration: number; width: number; height: number };
  bgmName?: string;
  matchSettings?: MatchSettings;
  audioSettings?: AudioSettings;
  editKind?: EditKind;
  beatSettings?: BeatSettings;
  beatGrid?: BeatGrid | null;
  styleTarget?: ShotTags | null;
  audioClips?: AudioClip[];
}

const DB_NAME = "cpvidego";
const DB_VERSION = 1;
const ACTIVE_PROFILE_KEY = "cpv.activeProfile";
const PROFILE_COLORS = ["#d9482b", "#1f5c4a", "#3a4a7a", "#7a4a2a", "#4a4a4a", "#6b3f5e"];

let dbPromise: Promise<IDBDatabase> | null = null;
const savedFiles = new Set<string>();

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前浏览器不支持 IndexedDB"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("profiles")) {
          db.createObjectStore("profiles", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("projects")) {
          const store = db.createObjectStore("projects", { keyPath: "id" });
          store.createIndex("profileId", "profileId", { unique: false });
        }
        if (!db.objectStoreNames.contains("project_data")) {
          db.createObjectStore("project_data", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("无法打开本地数据库"));
    });
  }
  return dbPromise;
}

export function newId() {
  return generateUUID();
}

export function referenceFileKey(projectId: string) {
  return `${projectId}:reference`;
}

export function assetFileKey(projectId: string, assetId: string) {
  return `${projectId}:asset:${assetId}`;
}

export function bgmFileKey(projectId: string) {
  return `${projectId}:bgm`;
}

export function getActiveProfileId() {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

export function setActiveProfileId(id: string) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  }
}

export async function listProfiles(): Promise<ProfileRecord[]> {
  const db = await openDb();
  return requestAsPromise(db.transaction("profiles", "readonly").objectStore("profiles").getAll());
}

export async function putProfile(profile: ProfileRecord): Promise<void> {
  const db = await openDb();
  await requestAsPromise(db.transaction("profiles", "readwrite").objectStore("profiles").put(profile));
}

export function makeProfile(name: string, index = 0): ProfileRecord {
  return {
    id: newId(),
    name: name.trim() || `主页 ${index + 1}`,
    color: PROFILE_COLORS[index % PROFILE_COLORS.length],
    createdAt: Date.now(),
    bio: "本地主页，项目与素材保存在这台设备。",
  };
}

export async function listProjects(profileId: string): Promise<ProjectRecord[]> {
  const db = await openDb();
  const index = db.transaction("projects", "readonly").objectStore("projects").index("profileId");
  const projects = await requestAsPromise(index.getAll(profileId));
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putProject(project: ProjectRecord): Promise<void> {
  const db = await openDb();
  await requestAsPromise(
    db.transaction("projects", "readwrite").objectStore("projects").put(project),
  );
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  const db = await openDb();
  return requestAsPromise(db.transaction("projects", "readonly").objectStore("projects").get(id));
}

export async function putProjectData(data: ProjectDataRecord): Promise<void> {
  const db = await openDb();
  await requestAsPromise(
    db.transaction("project_data", "readwrite").objectStore("project_data").put(data),
  );
}

export async function getProjectData(id: string): Promise<ProjectDataRecord | undefined> {
  const db = await openDb();
  return requestAsPromise(
    db.transaction("project_data", "readonly").objectStore("project_data").get(id),
  );
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const keys = await requestAsPromise(
    db.transaction("files", "readonly").objectStore("files").getAllKeys(),
  );
  const tx = db.transaction(["projects", "project_data", "files"], "readwrite");
  tx.objectStore("projects").delete(id);
  tx.objectStore("project_data").delete(id);
  const files = tx.objectStore("files");
  for (const key of keys) {
    if (String(key).startsWith(`${id}:`)) files.delete(key);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("删除项目失败"));
  });
}

export async function putFile(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await requestAsPromise(db.transaction("files", "readwrite").objectStore("files").put(blob, key));
  savedFiles.add(key);
}

export async function getFile(key: string): Promise<Blob | undefined> {
  const db = await openDb();
  return requestAsPromise(db.transaction("files", "readonly").objectStore("files").get(key));
}

export function markFileSaved(key: string) {
  savedFiles.add(key);
}

export function isFileSaved(key: string) {
  return savedFiles.has(key);
}

export async function pruneProjectAssetFiles(projectId: string, keepKeys: Set<string>) {
  const db = await openDb();
  const allKeys = await requestAsPromise(
    db.transaction("files", "readonly").objectStore("files").getAllKeys(),
  );
  const prefix = `${projectId}:asset:`;
  const tx = db.transaction("files", "readwrite");
  const files = tx.objectStore("files");
  for (const key of allKeys) {
    const text = String(key);
    if (text.startsWith(prefix) && !keepKeys.has(text)) files.delete(key);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("清理素材文件失败"));
  });
}

export function formatProjectDate(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}