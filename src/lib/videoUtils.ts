export const VIDEO_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

export interface VideoFileResult {
  blob: Blob;
  posterDataUrl: string;
  aspect: number;
  mimeType: string;
}

export class VideoTooLargeError extends Error {
  constructor() {
    super(`Video exceeds ${VIDEO_MAX_BYTES / (1024 * 1024)}MB limit`);
    this.name = "VideoTooLargeError";
  }
}

/**
 * Load a video File and extract: the raw Blob, a poster (thumbnail) data URL
 * captured ~1s in, aspect ratio, and the MIME type.
 *
 * Rejects with VideoTooLargeError if the file exceeds VIDEO_MAX_BYTES, or with
 * a generic Error if the browser cannot decode the file.
 */
export function readVideoFile(file: File): Promise<VideoFileResult> {
  if (file.size > VIDEO_MAX_BYTES) {
    return Promise.reject(new VideoTooLargeError());
  }
  return new Promise((resolve, reject) => {
    const blob = file;
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    // Needed on Safari/iOS for offscreen playback to paint frames to canvas.
    video.playsInline = true;
    video.src = url;
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    video.onerror = () => fail(new Error("Browser cannot decode this video file"));

    const capture = () => {
      if (settled) return;
      const { videoWidth: w, videoHeight: h } = video;
      if (!w || !h) {
        fail(new Error("Video has no decodable frame"));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        fail(new Error("Canvas 2D context unavailable"));
        return;
      }
      try {
        ctx.drawImage(video, 0, 0);
      } catch (e) {
        fail(e instanceof Error ? e : new Error("Poster capture failed"));
        return;
      }
      const posterDataUrl = canvas.toDataURL("image/jpeg", 0.95);
      settled = true;
      cleanup();
      resolve({
        blob,
        posterDataUrl,
        aspect: h / w,
        mimeType: file.type || "video/mp4",
      });
    };

    // Seek slightly off 0 — Chrome won't fire `seeked` if currentTime is already 0,
    // which would hang forever. 0.01s is small enough to still read as "first frame".
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) {
        fail(new Error("Video has no decodable frame"));
        return;
      }
      video.currentTime = 0.01;
    };

    video.onseeked = capture;
    // Fallback: if `seeked` doesn't fire (some codecs), capture on first frame.
    video.onloadeddata = () => {
      // Give the seek a moment; if it didn't fire by the time the first frame
      // is available, just grab what we have.
      setTimeout(() => capture(), 50);
    };
  });
}

/** Check whether a DataTransfer contains at least one video file. */
export function hasVideoFile(dt: DataTransfer): boolean {
  for (const item of Array.from(dt.items)) {
    if (item.kind === "file" && item.type.startsWith("video/")) return true;
  }
  return false;
}

/** Extract the first video File from a DataTransfer, if any. */
export function getVideoFile(dt: DataTransfer): File | null {
  for (const file of Array.from(dt.files)) {
    if (file.type.startsWith("video/")) return file;
  }
  return null;
}
