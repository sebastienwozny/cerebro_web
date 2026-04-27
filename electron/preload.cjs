// Bridges select main-process capabilities to the renderer via a small,
// versioned `electronAPI` global. Required because `nodeIntegration` is
// off + `contextIsolation` is on (the safe default).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Fetch a URL from the main process (no browser CORS, free Referer).
   * Used to pull video.twimg.com binaries that 403 cross-origin in the
   * renderer.
   *
   * @param url Absolute URL to fetch
   * @param headers Optional request headers (e.g. { Referer: "https://twitter.com/" })
   * @returns { arrayBuffer, contentType } on success, throws on failure.
   */
  fetchBinary: (url, headers) => ipcRenderer.invoke("fetch-binary", url, headers),
});
