"use client";

import { useState, useCallback } from "react";
import { useAssetsStore, type ProjectFile } from "@/stores/assets-store";
import { generateThumbnail } from "@/lib/thumbnail-generator";
import { analyzeVideo } from "@/lib/video-analysis";

export type MediaType = "image" | "video" | "audio";

interface UploadResult {
  success: boolean;
  fileName: string;
  error?: string;
}

interface UseAssetUploadOptions {
  spaceId: string | null;
  onComplete?: () => void;
}

export function useAssetUpload({ spaceId, onComplete }: UseAssetUploadOptions) {
  const [isUploading, setIsUploading] = useState(false);
  const { addFiles, updateFile } = useAssetsStore();

  const detectFileType = (file: File): MediaType => {
    const mime = file.type.toLowerCase();
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext))
      return "audio";
    if (mime.startsWith("video/") || ["mp4", "webm", "mov", "avi", "mkv"].includes(ext))
      return "video";
    return "image";
  };

  const createTempFile = (file: File, spaceId: string): ProjectFile => ({
    id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    spaceId,
    name: file.name,
    type: detectFileType(file),
    src: "",
    duration: undefined,
    size: file.size,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    indexingStatus: null,
    uploadProgress: 0,
  });

  const processFile = async (file: File, tempId: string): Promise<UploadResult> => {
    const type = detectFileType(file);
    const targetSpaceId = spaceId || "guest";

    try {
      const [videoInfo, thumbnailBlob] = await Promise.all([
        type === "video" ? analyzeVideo(file) : Promise.resolve(undefined),
        generateThumbnail(file).catch(() => null),
      ]);

      const src = URL.createObjectURL(file);
      const thumbnailSrc = thumbnailBlob ? URL.createObjectURL(thumbnailBlob) : null;
      const assetId = crypto.randomUUID();

      updateFile(tempId, {
        id: assetId,
        src,
        thumbnailSrc,
        duration: videoInfo?.duration,
        width: videoInfo?.width,
        height: videoInfo?.height,
        uploadProgress: null,
        indexingStatus: null,
        indexingStage: null,
        indexingProgress: null,
        indexingError: null,
        updatedAt: new Date().toISOString(),
      });

      return { success: true, fileName: file.name };
    } catch (error: any) {
      console.error(`[Upload] Failed for ${file.name}:`, error);
      updateFile(tempId, { uploadProgress: null, indexingStatus: "failed" });
      return { success: false, fileName: file.name, error: error.message };
    }
  };

  const uploadFiles = useCallback(
    async (files: FileList | null) => {
      const targetSpaceId = spaceId || "guest";
      if (!files?.length) return;

      setIsUploading(true);
      const fileArray = Array.from(files);

      const tempFiles = fileArray.map((file) => createTempFile(file, targetSpaceId));
      addFiles(tempFiles);

      const results = await Promise.all(
        fileArray.map((file, index) => processFile(file, tempFiles[index].id)),
      );

      setIsUploading(false);
      onComplete?.();

      return results;
    },
    [spaceId, addFiles, updateFile, onComplete],
  );

  return { uploadFiles, isUploading };
}
