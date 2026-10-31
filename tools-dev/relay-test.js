#!/usr/bin/env node
/**
 * relay-test.js — can the site's own relay (functions/api/relay.js on Cloudflare) reach the official
 * recruitment websites that refuse GitHub's runners? Tries every source in data/sources-official.json
 * directly and through the relay, and writes the comparison to data/relay-test.json.
 */
const fs = require("fs");
const path = require("path");
const L = require("../lib.js");

const SITE = (L.CONFIG.url || "https://news-views.in").replace(/\/$/, "");
// Optional filter (the inspect workflow's "urls" box in relay mode): comma-separated source ids, "prefix*" allowed.
const only = String(process.env.URLS || "").split(/[\s,]+/).filter(Boolean);
const pick = (id) => !only.length || only.some((o) => (o.endsWith("*") ? id.startsWith(o.slice(0, -1)) : id === o));
const sources = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "sources-official.json"), "utf8")).sources.filter((s) => pick(s.id));

async function get(url, ms, headers = L.HDRS) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms), redirect: "follow" });
    const body = await r.text();
    const links = (body.match(/<a\s[^>]*href=/gi) || []).length;
    return { status: r.status, bytes: body.length, links, ms: Date.now() - t0, colo: r.headers.get("x-relay-colo") || undefined, final: r.headers.get("x-relay-final-url") || undefined,
      note: r.ok ? undefined : body.slice(0, 120).replace(/\s+/g, " ") };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: String((e.cause && (e.cause.code || e.cause.message)) || e.message).slice(0, 120) };
  }
}
const works = (x) => x.status >= 200 && x.status < 300 && x.bytes > 1500 && x.links >= 5;

async function main() {
  const trace = await get(`${SITE}/api/relay?trace=1`, 20000, { accept: "application/json" });
  let traceBody = null;
  try { traceBody = JSON.parse((await (await fetch(`${SITE}/api/relay?trace=1`, { signal: AbortSignal.timeout(20000) })).text())); } catch (e) { traceBody = { error: e.message, status: trace.status }; }
  const rows = [];
  const queue = [...sources];
  // 8 sources at a time (the India relay allows 10 at once on a new AWS account); the three routes in parallel.
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let s; (s = queue.shift()); ) {
      const viaIndia = async () => {
        if (!L.hasIndiaRelay()) return null;
        const t0 = Date.now();
        try {
          const r = await L.fetchViaIndia(s.url, 45000);
          const body = r.buffer.toString("utf8");
          return { status: 200, bytes: body.length, links: (body.match(/<a\s[^>]*href=/gi) || []).length, ms: Date.now() - t0, final: r.url };
        } catch (e) { return { status: 0, ms: Date.now() - t0, error: String(e.message).slice(0, 120) }; }
      };
      const [direct, relay, india] = await Promise.all([
        get(s.url, 15000),
        get(`${SITE}/api/relay?url=${encodeURIComponent(s.url)}`, 35000, { "user-agent": "news-views-relay-test", accept: "*/*" }),
        viaIndia(),
      ]);
      rows.push({ id: s.id, url: s.url, direct, relay, india, directOk: works(direct), relayOk: works(relay), indiaOk: !!india && works(india) });
    }
  }));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const out = {
    at: new Date().toISOString(), sources: rows.length,
    directOk: rows.filter((r) => r.directOk).length, relayOk: rows.filter((r) => r.relayOk).length,
    indiaRelay: L.hasIndiaRelay(), indiaOk: rows.filter((r) => r.indiaOk).length,
    reachable: rows.filter((r) => r.directOk || r.relayOk || r.indiaOk).length,
    unreachable: rows.filter((r) => !r.directOk && !r.relayOk && !r.indiaOk).map((r) => r.id),
    relayOnly: rows.filter((r) => r.relayOk && !r.directOk).map((r) => r.id),
    trace: traceBody, rows,
  };
  fs.writeFileSync(path.join(__dirname, "..", "data", "relay-test.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`relay-test: direct ${out.directOk}/${out.sources}, relay ${out.relayOk}/${out.sources}, india ${out.indiaOk}/${out.sources}; unreachable: ${out.unreachable.join(", ") || "none"}`);
  console.log("trace: " + JSON.stringify(traceBody).slice(0, 400));
}
main().catch((e) => { console.log("relay-test error: " + e.message); process.exit(0); });
