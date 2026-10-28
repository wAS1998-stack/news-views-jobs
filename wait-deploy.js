#!/usr/bin/env node
/**
 * wait-deploy.js — wait until Cloudflare Pages is serving the commit we just pushed,
 * so Google / Telegram / IndexNow are only told about pages that are already live.
 * Reads /version.json (never cached) on the project's production address.
 * Usage: WAIT_SHA=<commit sha> node wait-deploy.js
 */
const SHA = (process.env.WAIT_SHA || "").slice(0, 7);
const URL_ = process.env.WAIT_URL || "https://news-views-jobs.pages.dev/version.json";
const MAX_MS = Number(process.env.WAIT_MAX_MS || 6 * 60 * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (!SHA) { console.log("wait-deploy: no sha given — waiting 90s instead."); await sleep(90000); return; }
  const t0 = Date.now();
  while (Date.now() - t0 < MAX_MS) {
    try {
      const r = await fetch(`${URL_}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const v = r.ok ? await r.json() : null;
      if (v && String(v.build || "").startsWith(SHA)) { console.log(`wait-deploy: live after ${Math.round((Date.now() - t0) / 1000)}s (${v.build}).`); return; }
    } catch { /* keep polling */ }
    await sleep(15000);
  }
  console.log(`wait-deploy: ${SHA} not live after ${MAX_MS / 1000}s — continuing anyway.`);
})();
