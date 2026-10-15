#!/usr/bin/env node
/**
 * purge-cache.js — purge Cloudflare's edge cache for news-views.in after a deploy.
 *
 * Why: the domain sits behind a Cloudflare zone. If the zone has a cache rule that
 * caches HTML (e.g. "Cache Everything"), every new Pages deploy stays invisible on
 * news-views.in until the cache expires — even though news-views-jobs.pages.dev is
 * already up to date. This script waits for the Pages build of the current commit
 * to finish, then purges the zone so visitors and Googlebot see fresh pages.
 *
 * Needs two repo secrets (optional — without them it exits quietly):
 *   CLOUDFLARE_API_TOKEN  token with permission  Zone → Cache Purge → Purge
 *   CLOUDFLARE_ZONE_ID    the zone id shown on the news-views.in Overview page
 */
const ROOT = __dirname;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const ZONE = process.env.CLOUDFLARE_ZONE_ID || "";
const PAGES_URL = "https://news-views-jobs.pages.dev/";
const WAIT_MAX_MS = Number(process.env.PURGE_WAIT_MS || 6 * 60 * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function liveStamp(url) {
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "nv=" + Date.now(), { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    return (t.match(/name="nv-build" content="([^"]+)"/) || [])[1] || "";
  } catch { return ""; }
}

async function main() {
  if (!TOKEN || !ZONE) {
    console.log("Purge: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set — skipping. (Add them so news-views.in never serves a stale build.)");
    return;
  }
  // Wait until the Pages production deploy carries the commit we just pushed.
  const want = (process.env.PURGE_SHA || process.env.GITHUB_SHA || "").slice(0, 7);
  const t0 = Date.now();
  if (want) {
    while (Date.now() - t0 < WAIT_MAX_MS) {
      const got = await liveStamp(PAGES_URL);
      if (got.startsWith(want)) { console.log(`Purge: Pages is serving ${got}.`); break; }
      await sleep(20000);
    }
  } else await sleep(120000);

  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ purge_everything: true }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.success) console.log("Purge: Cloudflare cache purged — news-views.in now serves the latest build.");
  else console.log("Purge: failed (non-fatal): " + JSON.stringify(j.errors || res.status));
}
main().catch((e) => console.log("Purge error (non-fatal): " + e.message));
