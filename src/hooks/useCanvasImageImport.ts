import { useCallback, useRef, useState } from "react";
import { hasImageFile, getImageFile, readImageFile } from "../lib/imageUtils";
import type { WindowSize } from "./useWindowSize";

interface Params {
  canvasLocked: boolean;
  windowSize: WindowSize;
  getTransform: () => { offsetX: number; offsetY: number; scale: number };
  createNote: (canvasX: number, canvasY: number, dataUrl?: string, aspect?: number) => Promise<void> | void;
}

export function useCanvasImageImport({ canvasLocked, windowSize, getTransform, createNote }: Params) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (canvasLocked) return;
    if (hasImageFile(e.dataTransfer)) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }, [canvasLocked]);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    setIsDragOver(false);
    if (canvasLocked) return;
    const file = getImageFile(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    const t = getTransform();
    const canvasX = (e.clientX - windowSize.w / 2 - t.offsetX) / t.scale;
    const canvasY = (e.clientY - windowSize.h / 2 - t.offsetY) / t.scale;
    const { dataUrl, aspect } = await readImageFile(file);
    await createNote(canvasX, canvasY, dataUrl, aspect);
  }, [canvasLocked, getTransform, windowSize, createNote]);

  const handleImageInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const t = getTransform();
    const spread = 40;
    const canvasX = -t.offsetX / t.scale + (Math.random() - 0.5) * spread;
    const canvasY = -t.offsetY / t.scale + (Math.random() - 0.5) * spread;
    const { dataUrl, aspect } = await readImageFile(file);
    await createNote(canvasX, canvasY, dataUrl, aspect);
  }, [getTransform, createNote]);

  return { imageInputRef, isDragOver, handleDragOver, handleDragLeave, handleDrop, handleImageInput };
}
