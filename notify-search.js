#!/usr/bin/env node
/**
 * notify-search.js — runs right after a deploy is confirmed live (see update-jobs.yml).
 *
 *  1. Re-submits sitemap-latest.xml (pages from the last 3 days) and feed.xml to Search Console.
 *     Submitting through the Search Console API is Google's supported way to say "this sitemap changed"
 *     (the old sitemap ping URL was retired in 2023).
 *  2. Pings the WebSub hub declared in feed.xml, so feed subscribers fetch the new items straight away.
 *
 * Results go to data/last-run.json ("notify"). Never fails the workflow.
 */
const fs = require("fs");
const path = require("path");
const G = require("./google.js");
const L = require("./lib.js");

const SITE = (L.CONFIG.url || "https://news-views.in").replace(/\/$/, "");

async function main() {
  const res = {};
  try {
    const r = await fetch("https://pubsubhubbub.appspot.com/", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ "hub.mode": "publish", "hub.url": `${SITE}/feed.xml` }), signal: AbortSignal.timeout(20000),
    });
    res.websub = r.status;   // 204 = accepted
  } catch (e) { res.websub = "error: " + e.message; }

  if (G.loadKey()) {
    let prop = `${SITE}/`;   // the property the service account owns (gsc.js records which one it found)
    try { prop = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "gsc.json"), "utf8")).property || prop; } catch {}
    try {
      const token = await G.getToken("https://www.googleapis.com/auth/webmasters");
      for (const f of ["sitemap-latest.xml", "feed.xml"]) {
        const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/sitemaps/${encodeURIComponent(`${SITE}/${f}`)}`,
          { method: "PUT", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
        res[f] = r.status;   // 204 = submitted
        if (!r.ok) res[f + "_error"] = (await r.text()).slice(0, 200);
      }
    } catch (e) { res.searchConsole = "error: " + e.message; }
  } else res.searchConsole = "GOOGLE_SERVICE_ACCOUNT_JSON not set";

  console.log("notify-search: " + JSON.stringify(res));
  L.logRun("notify", { ok: res.websub === 204 && (res["sitemap-latest.xml"] === undefined || res["sitemap-latest.xml"] === 204), ...res });
}
main().catch((e) => console.log("notify-search error (non-fatal): " + e.message));
