import { useCallback, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { hasImageFile, getImageFile, readImageFile } from "../lib/imageUtils";
import { hasVideoFile, getVideoFile, readVideoFile, VideoTooLargeError } from "../lib/videoUtils";
import type { NoteBlock } from "../store/db";
import type { WindowSize } from "./useWindowSize";

interface Params {
  canvasLocked: boolean;
  windowSize: WindowSize;
  getTransform: () => { offsetX: number; offsetY: number; scale: number };
  createNote: (canvasX: number, canvasY: number, initialMediaBlock?: NoteBlock) => Promise<void> | void;
}

async function imageFileToBlock(file: File): Promise<NoteBlock> {
  const { dataUrl, aspect } = await readImageFile(file);
  return { id: uuid(), type: "image", content: "", imageDataUrl: dataUrl, imageAspect: aspect };
}

async function videoFileToBlock(file: File): Promise<NoteBlock | null> {
  try {
    const { blob, posterDataUrl, aspect, mimeType } = await readVideoFile(file);
    return {
      id: uuid(),
      type: "video",
      content: "",
      videoBlob: blob,
      videoPosterDataUrl: posterDataUrl,
      videoAspect: aspect,
      videoMimeType: mimeType,
    };
  } catch (err) {
    if (err instanceof VideoTooLargeError) alert("Video is larger than 500 MB and cannot be imported.");
    else alert("Couldn't decode this video file.");
    return null;
  }
}

/**
 * Handles drag-drop and file-picker upload of image/video files onto the
 * canvas background, creating a new note with the media as its header block.
 */
export function useCanvasMediaImport({ canvasLocked, windowSize, getTransform, createNote }: Params) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (canvasLocked) return;
    if (hasImageFile(e.dataTransfer) || hasVideoFile(e.dataTransfer)) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }, [canvasLocked]);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    setIsDragOver(false);
    if (canvasLocked) return;
    const imgFile = getImageFile(e.dataTransfer);
    const videoFile = imgFile ? null : getVideoFile(e.dataTransfer);
    if (!imgFile && !videoFile) return;
    e.preventDefault();
    const t = getTransform();
    const canvasX = (e.clientX - windowSize.w / 2 - t.offsetX) / t.scale;
    const canvasY = (e.clientY - windowSize.h / 2 - t.offsetY) / t.scale;
    const block = imgFile ? await imageFileToBlock(imgFile) : await videoFileToBlock(videoFile!);
    if (!block) return;
    await createNote(canvasX, canvasY, block);
  }, [canvasLocked, getTransform, windowSize, createNote]);

  const dropAtViewportCenter = useCallback(async (block: NoteBlock) => {
    const t = getTransform();
    const spread = 40;
    const canvasX = -t.offsetX / t.scale + (Math.random() - 0.5) * spread;
    const canvasY = -t.offsetY / t.scale + (Math.random() - 0.5) * spread;
    await createNote(canvasX, canvasY, block);
  }, [getTransform, createNote]);

  const handleImageInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const block = await imageFileToBlock(file);
    await dropAtViewportCenter(block);
  }, [dropAtViewportCenter]);

  const handleVideoInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const block = await videoFileToBlock(file);
    if (block) await dropAtViewportCenter(block);
  }, [dropAtViewportCenter]);

  return {
    imageInputRef, videoInputRef, isDragOver,
    handleDragOver, handleDragLeave, handleDrop,
    handleImageInput, handleVideoInput,
  };
}
