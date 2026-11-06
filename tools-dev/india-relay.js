#!/usr/bin/env node
/**
 * india-relay.js — the site's relay (functions/api/relay.js) as a tiny Node server for a machine in India.
 * Many state recruitment sites refuse every foreign address (GitHub runners, Cloudflare's US data centres); a cheap VPS
 * in India can read them. Same interface: GET /relay?url=<official page or PDF>. Same rules: GET only, government
 * hosts only (checked again on every redirect), streamed through without being stored, 15 MB cap, served as inert text.
 *
 *   PORT=8787 node tools-dev/india-relay.js        (Node 18+, no dependencies)
 * Then set the GitHub secret INDIA_RELAY_URL (or config.json "indiaRelayUrl") to http://<server>:8787/relay
 */
const http = require("http");
const { Readable } = require("stream");

const EXTRA_HOSTS = ["ibps.in", "nta.ac.in", "opportunities.rbi.org.in", "rbi.org.in", "aiimsexams.ac.in", "westbengalssc.com", "tgprb.in", "ncs.gov.in", "cdac.in"];
const allowed = (host) => { host = String(host || "").toLowerCase().replace(/\.$/, ""); return /\.(gov|nic)\.in$/.test(host) || EXTRA_HOSTS.some((h) => host === h || host.endsWith("." + h)); };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_BYTES = 15e6;
const reply = (res, status, text) => { res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" }); res.end(text); };

async function relay(req, res) {
  const u = new URL(req.url, "http://relay.local");
  if (req.method !== "GET") return reply(res, 405, "GET only");
  if (u.pathname !== "/relay" && u.pathname !== "/api/relay") return reply(res, 404, "not found");
  let target;
  try { target = new URL(u.searchParams.get("url") || ""); } catch { return reply(res, 400, "url parameter missing or invalid"); }
  for (let hop = 0; hop <= 5; hop++) {
    if (!/^https?:$/.test(target.protocol) || (target.port && !["80", "443"].includes(target.port))) return reply(res, 400, "only plain http(s) URLs");
    if (!allowed(target.hostname)) return reply(res, 403, "host not allowed: " + target.hostname);
    let r;
    try {
      r = await fetch(target.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(25000),
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8", "accept-language": "en-IN,en;q=0.9,hi;q=0.8" } });
    } catch (e) { return reply(res, 502, "upstream error: " + ((e.cause && e.cause.code) || e.message)); }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { target = new URL(r.headers.get("location"), target); continue; }   // re-checked above
    if (Number(r.headers.get("content-length") || 0) > MAX_BYTES) return reply(res, 413, "too large");
    // Served as inert text (PDFs stay PDFs): the original type travels in x-relay-content-type, like the Cloudflare relay.
    const upstreamType = r.headers.get("content-type") || "application/octet-stream";
    const charset = (upstreamType.match(/charset=([^;\s]+)/i) || [])[1];
    res.writeHead(r.status, { "content-type": /pdf/i.test(upstreamType) ? "application/pdf" : `text/plain${charset ? "; charset=" + charset : ""}`,
      "x-relay-content-type": upstreamType, "x-relay-final-url": target.toString(), "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff", "cache-control": "no-store", "x-robots-tag": "noindex" });
    if (!r.body) return res.end();
    let bytes = 0;
    const body = Readable.fromWeb(r.body);
    body.on("data", (c) => { bytes += c.length; if (bytes > MAX_BYTES) { body.destroy(); res.destroy(); } else res.write(c); });
    body.on("end", () => res.end());
    body.on("error", () => res.destroy());
    return;
  }
  reply(res, 508, "too many redirects");
}

const port = Number(process.env.PORT || 8787);
http.createServer((req, res) => relay(req, res).catch((e) => reply(res, 500, "error: " + e.message))).listen(port, () => console.log(`india-relay listening on :${port} (GET /relay?url=…)`));
module.exports = { allowed };
