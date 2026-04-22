import { useEffect, useState } from "react";

/**
 * Samples an image at low resolution to determine if it's predominantly light or dark.
 * Returns true if the average luminance exceeds the threshold (default 160/255).
 */
export function useImageBrightness(dataUrl: string | undefined): boolean {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 32;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      }
      setIsLight(total / (size * size) > 128);
    };
    img.src = dataUrl;
  }, [dataUrl]);

  return isLight;
}
