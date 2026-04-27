/**
 * Cerebro — X/Twitter media proxy.
 *
 * Why: video.twimg.com refuses cross-origin browser requests (Referer
 * check) so a renderer can't fetch the mp4 directly. This Worker fetches
 * the binary from CloudFlare's edge with a Twitter-domain Referer, then
 * re-emits the response with permissive CORS so our app can pull it as
 * a Blob from anywhere.
 *
 * Whitelisted to *.twimg.com only so this can't be used to proxy
 * arbitrary URLs.
 *
 * ── Deploy ──────────────────────────────────────────────────────────
 *  1. Cloudflare Dashboard → Workers & Pages → Create Worker
 *  2. Paste this entire file as the Worker code, click "Deploy"
 *  3. (optional) Settings → Variables → add Secret `AUTH_TOKEN`. The
 *     app will send it as `?token=...` so randoms can't burn through
 *     your free-tier quota.
 *  4. Note the Worker URL (e.g. https://cerebro-x.<you>.workers.dev)
 *     and put it in the app: `.env.local` →
 *       VITE_X_MEDIA_PROXY_URL=https://cerebro-x.<you>.workers.dev
 *       VITE_X_MEDIA_PROXY_TOKEN=<the AUTH_TOKEN you set above>
 */

export default {
  async fetch(request, env) {
    // CORS preflight (the app uses POST=GET fetch but browsers may probe).
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);

    // Optional shared-secret check.
    if (env.AUTH_TOKEN && url.searchParams.get("token") !== env.AUTH_TOKEN) {
      return text("Unauthorized", 401);
    }

    const target = url.searchParams.get("url");
    if (!target) return text("Missing ?url= param", 400);

    let parsed;
    try { parsed = new URL(target); } catch { return text("Invalid url", 400); }
    if (!/(^|\.)twimg\.com$/.test(parsed.hostname)) {
      return text("Only *.twimg.com URLs are proxied", 403);
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        // Twitter's CDN serves video only with a twitter.com / x.com
        // referer. UA is set to a real browser to dodge any naive
        // bot-detection on their edge.
        headers: {
          Referer: "https://twitter.com/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        // Cache responses on Cloudflare's edge for a day so repeat
        // fetches of the same media are instant + free.
        cf: { cacheTtl: 86400, cacheEverything: true },
      });
    } catch (e) {
      return text(`Upstream fetch failed: ${e.message ?? e}`, 502);
    }

    // Rebuild headers: keep Content-Type/Length, force open CORS, allow
    // the renderer to read all response headers.
    const headers = new Headers();
    const ct = upstream.headers.get("Content-Type");
    if (ct) headers.set("Content-Type", ct);
    const cl = upstream.headers.get("Content-Length");
    if (cl) headers.set("Content-Length", cl);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Type");
    headers.set("Cache-Control", "public, max-age=86400");

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function text(body, status) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
