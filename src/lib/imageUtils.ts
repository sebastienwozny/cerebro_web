/**
 * Read an image File and return its data URL + aspect ratio (height / width).
 */
export function readImageFile(file: File): Promise<{ dataUrl: string; aspect: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new window.Image();
      img.onload = () => resolve({ dataUrl, aspect: img.naturalHeight / img.naturalWidth });
      img.onerror = reject;
      img.src = dataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Check whether a DataTransfer contains at least one image file.
 */
export function hasImageFile(dt: DataTransfer): boolean {
  for (const item of Array.from(dt.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return true;
  }
  return false;
}

/**
 * Extract the first image File from a DataTransfer, if any.
 */
export function getImageFile(dt: DataTransfer): File | null {
  for (const file of Array.from(dt.files)) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}
