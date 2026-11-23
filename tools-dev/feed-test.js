/* Test RSS feeds from GitHub's runners: the configured ones plus candidates (URLS env, comma-separated).
   Writes data/feed-test.json: items, newest date, sample titles, how it was fetched. inspect.yml mode=feeds. */
const fs = require("fs"), path = require("path");
const L = require("../lib.js");
(async () => {
  const urls = [...new Set([...(L.CONFIG.feeds || []), ...String(process.env.URLS || "").split(",").map((s) => s.trim()).filter(Boolean)])];
  const out = { at: new Date().toISOString(), feeds: {} };
  for (const u of urls) {
    const r = await L.fetchFeed(u).catch((e) => ({ items: [], via: "", errors: [e.message] }));
    const dates = r.items.map((i) => Date.parse(i.date)).filter((n) => n > 0).sort((a, b) => b - a);
    out.feeds[u] = { configured: (L.CONFIG.feeds || []).includes(u), items: r.items.length, via: r.via,
      newest: dates[0] ? new Date(dates[0]).toISOString().slice(0, 10) : null, sample: r.items.slice(0, 6).map((i) => i.title), errors: r.errors.slice(0, 3) };
    console.log(u, out.feeds[u].items, out.feeds[u].newest, r.via);
  }
  fs.writeFileSync(path.join(L.ROOT, "data", "feed-test.json"), JSON.stringify(out, null, 2) + "\n");
})();
