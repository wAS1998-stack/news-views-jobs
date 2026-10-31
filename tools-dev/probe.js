#!/usr/bin/env node
/**
 * probe.js — look inside official websites from a GitHub runner (diagnostics; writes data/probe.json).
 *
 * Some recruiters' sites (SSC, NCS, MPSC …) are JavaScript apps: their HTML has no notice links, the list is
 * loaded from a JSON API. For each URL this records how the page was reached (direct / India relay / proxy),
 * its title, links and notice links, RSS feeds, and — from the page's own scripts — the API addresses the app
 * calls, so a source can be pointed at the API instead.
 *
 * URLs: PROBE_URLS (comma-separated; the inspect workflow's "urls" box). Default: the sources whose last
 * watch result was "0 notice links".
 */
const fs = require("fs");
const path = require("path");
const L = require("../lib.js");
const { noticeLinks } = require("../watch.js");

const ROOT = path.join(__dirname, "..");
function defaults() {
  try {
    const health = (JSON.parse(fs.readFileSync(path.join(ROOT, "data", "last-run.json"), "utf8")).watch || {}).sources_health || {};
    const src = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sources-official.json"), "utf8")).sources;
    return src.filter((s) => /^0 notice links/.test(health[s.id] || "")).map((s) => s.url).slice(0, 12);
  } catch { return []; }
}
const urls = String(process.env.PROBE_URLS || "").split(/[\s,]+/).filter((u) => /^https?:\/\//i.test(u));
const API_RE = /["'`]((?:https?:\/\/[^"'`\s<>]{3,120})?\/(?:api|apis|rest|services?|backend|ws|webapi|portal|graphql|json|cms|wp-json)\b[^"'`\s<>]{0,140})["'`]/gi;
const BASE_RE = /\b(?:baseURL|baseUrl|BASE_URL|apiUrl|API_URL|apiBase|API_BASE|serverUrl|SERVER_URL|endpoint)\s*[:=]\s*["'`]([^"'`]{4,160})["'`]/g;

async function get(url, ms = 20000) {
  try { const r = await L.fetchText(url, ms, { proxyMs: 25000 }); return { ok: true, ...r }; }
  catch (e) { return { ok: false, error: String(e.message).slice(0, 300) }; }
}

async function probe(url) {
  const page = await get(url);
  if (!page.ok) return { url, ok: false, error: page.error };
  const html = page.text || "";
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const anchors = (html.match(/<a\s[^>]*href=/gi) || []).length;
  const notices = noticeLinks(html, page.url || url);
  const feeds = [...html.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)].map((m) => (m[0].match(/href=["']([^"']+)/i) || [])[1]).filter(Boolean);
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => { try { return new URL(L.decodeEntities(m[1]), page.url || url).href; } catch { return null; } }).filter(Boolean);
  const origin = new URL(page.url || url).origin;
  const own = scripts.filter((s) => s.startsWith(origin) && !/jquery|bootstrap|analytics|gtag|recaptcha|polyfill/i.test(s)).slice(0, 8);
  const apis = new Set(), bases = new Set();
  const scan = (txt) => {
    for (const m of txt.matchAll(API_RE)) apis.add(m[1]);
    for (const m of txt.matchAll(BASE_RE)) bases.add(m[1]);
  };
  scan(html);
  const scriptInfo = [];
  for (const s of own) {
    const r = await get(s, 25000);
    scriptInfo.push({ src: s, ok: r.ok, bytes: r.ok ? r.text.length : 0, via: r.via, error: r.ok ? undefined : r.error.slice(0, 120) });
    if (r.ok) scan(r.text.slice(0, 6e6));
  }
  return {
    url, ok: true, via: page.via, final: page.url, bytes: html.length, title: title ? L.stripTags(title).trim().slice(0, 120) : undefined,
    anchors, noticeLinks: notices.length, sampleNotices: notices.slice(0, 6).map((n) => ({ text: n.text.slice(0, 100), url: n.url })),
    feeds, scripts: scripts.slice(0, 20), scriptInfo, apis: [...apis].slice(0, 80), bases: [...bases].slice(0, 20),
    textSample: L.stripTags(html).replace(/\s+/g, " ").slice(0, 400),
  };
}

async function main() {
  const list = urls.length ? urls : defaults();
  const out = { at: new Date().toISOString(), indiaRelay: L.hasIndiaRelay(), results: [] };
  for (const u of list) { const r = await probe(u); out.results.push(r); console.log(`probe: ${u} → ${r.ok ? `${r.via}, ${r.anchors} links, ${r.noticeLinks} notices, ${r.apis.length} api strings` : "ERROR " + r.error.slice(0, 120)}`); }
  fs.writeFileSync(path.join(ROOT, "data", "probe.json"), JSON.stringify(out, null, 2) + "\n");
}
main().catch((e) => { console.log("probe error: " + e.message); process.exit(0); });
