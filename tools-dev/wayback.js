#!/usr/bin/env node
/* wayback.js — lists the pages the domain had before the jobs site (Internet Archive CDX index), with how often
   each was archived and what it returns today, so old addresses that still have links can be redirected or rebuilt.
   Writes data/old-urls.json. Read-only. */
const fs = require("fs"), path = require("path");
(async () => {
  const out = { at: new Date().toISOString(), urls: [] };
  try {
    const cdx = "https://web.archive.org/cdx/search/cdx?url=news-views.in/*&output=json&fl=original,timestamp,statuscode,mimetype&filter=statuscode:200&to=20261001&limit=20000";
    const r = await fetch(cdx, { signal: AbortSignal.timeout(90000) });
    const rows = (await r.json()).slice(1);
    const m = new Map();
    for (const [orig, ts, , mime] of rows) {
      let u; try { u = new URL(orig.replace(/^http:/, "https:")); } catch { continue; }
      if (!/html/i.test(mime)) continue;
      const key = (u.pathname.replace(/\/+$/, "") || "/") + (u.search || "");
      const v = m.get(key) || { path: key, captures: 0, first: ts, last: ts };
      v.captures++; if (ts < v.first) v.first = ts; if (ts > v.last) v.last = ts;
      m.set(key, v);
    }
    out.urls = [...m.values()].sort((a, b) => b.captures - a.captures).slice(0, 400);
    out.firstCapture = out.urls.reduce((f, u) => (f && f < u.first ? f : u.first), null);
    // what do these addresses return now?
    for (const u of out.urls.slice(0, 150)) {
      try {
        const res = await fetch("https://news-views.in" + u.path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
        u.now = res.status; if (res.status >= 300 && res.status < 400) u.to = res.headers.get("location");
      } catch (e) { u.now = "error"; }
    }
  } catch (e) { out.error = e.message; }
  fs.writeFileSync(path.join(__dirname, "..", "data", "old-urls.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`old urls: ${out.urls.length}${out.error ? " error " + out.error : ""}`);
})();
