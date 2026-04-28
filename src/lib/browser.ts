/** True for desktop/iOS Safari (WebKit Safari, not Chrome/Edge/Brave). */
export const IS_SAFARI = (() => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR\//.test(ua);
})();
