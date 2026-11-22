export function formatTime(seconds: number, withMs = false) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const base = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (!withMs) return base;
  const ms = Math.floor((safe % 1) * 1000);
  return `${base}.${String(ms).padStart(3, "0")}`;
}

export function formatDurationLabel(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return safe < 1 ? `${Math.round(safe * 1000)}ms` : `${safe.toFixed(1)}s`;
}

export async function getVideoMeta(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("无法读取视频信息"));
    });
    return {
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

export async function makeVideoThumbnail(src: string, time = 1): Promise<string> {
  const [thumbnail] = await makeVideoThumbnails(src, [time]);
  return thumbnail ?? "";
}

/** 复用同一个 video 元素批量取帧，长素材不必反复加载元数据。 */
export async function makeVideoThumbnails(
  src: string,
  times: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  if (!times.length) return [];
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.src = src;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("加载素材超时")), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("无法加载视频"));
      };
    });

    const width = 320;
    const height = Math.max(1, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return times.map(() => "");

    const results: string[] = [];
    for (let i = 0; i < times.length; i += 1) {
      const target = Math.min(Math.max(0.05, times[i]), Math.max(0.05, video.duration - 0.05));
      await seekWithTimeout(video, target);
      ctx.drawImage(video, 0, 0, width, height);
      results.push(canvas.toDataURL("image/jpeg", 0.7));
      onProgress?.(i + 1, times.length);
    }
    return results;
  } catch {
    return times.map(() => "");
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

function seekWithTimeout(video: HTMLVideoElement, time: number, timeoutMs = 4000): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.002) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.onseeked = null;
      resolve();
    };
    video.onseeked = done;
    setTimeout(done, timeoutMs);
    video.currentTime = time;
  });
}

export function isVideoFile(file: File) {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name);
}

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

/** 浏览器要把整段媒体读进内存，超大文件会直接卡死页面。 */
export function mediaSizeError(file: File): string | null {
  if (file.size <= MAX_MEDIA_BYTES) return null;
  const mb = Math.round(file.size / 1024 / 1024);
  return `${file.name} 有 ${mb}MB，超过 500MB 上限；请先压缩或剪短再导入`;
}

export function isAudioFile(file: File) {
  if (file.type.startsWith("audio/")) return true;
  return /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.name);
}

export function isImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}
