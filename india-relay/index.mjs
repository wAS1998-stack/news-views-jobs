/**
 * India relay for news-views.in: an AWS Lambda in the Mumbai region (ap-south-1). Setup: india-relay/SETUP.md.
 *
 * Most Indian government recruitment websites refuse connections from outside India, and the site's
 * fetchers run on GitHub's US servers. This function fetches an official page or PDF from India and
 * hands it back. Deliberately narrow:
 *   - requires the secret in the "x-relay-key" header (env RELAY_TOKEN), so it is not an open proxy
 *   - GET only, Indian hosts only (*.in plus the central-government domains below, plus any in the optional
 *     env EXTRA_HOSTS, comma-separated), re-checked on every redirect
 *   - nothing stored; one response is at most ~4.2 MB (the Lambda limit is 6 MB after base64). Bigger PDFs are
 *     read in pieces with &range=START-END when the government server supports byte ranges.
 *   - TLS stays verified; for government servers that omit their intermediate certificate, the missing
 *     issuer is downloaded from the certificate's own AIA address (as browsers do) and verification is kept.
 * Runs within the AWS free tier (1 million requests a month).
 */
import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";

// Central-government recruiters whose websites are not under .in (keep in sync automatically: lib.js reads this list).
const EXTRA_HOSTS = [
  "iocl.com", "ongcindia.com", "bhel.com", "gailonline.com", "nhpcindia.com", "hindustanpetroleum.com", "oil-india.com",
  "nalcoindia.com", "pfcindia.com", "engineersindia.com", "balmerlawrie.com", "hindustancopper.com", "sailcareers.com",
  "rites.com", "ircon.org", "irctc.com", "rvnl.org", "dfccil.com", "konkanrailway.com", "railtelindia.com", "aai.aero",
  "delhimetrorail.com", "shipindia.com", "dredge-india.com", "vizagport.com", "nhidcl.com", "nationalfertilizers.com",
  "rcfltd.com", "lifecarehll.com", "aicofindia.com", "nabard.org", "nabfid.org", "licindia.com", "bankofbaroda.com",
  "canarabank.com", "ucobank.com", "rrcnr.org", "rrc-wr.com", "rrccr.com", "rrcer.org", "rrcpryj.org", "awesindia.com",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_BYTES = 4.2e6;
const CHAIN_ERR = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|unable to verify the first certificate/i;

const envHosts = () => String(process.env.EXTRA_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const allowed = (host) => {
  host = String(host || "").toLowerCase().replace(/\.$/, "");
  return host.endsWith(".in") || [...EXTRA_HOSTS, ...envHosts()].some((h) => host === h || host.endsWith("." + h));
};
const reply = (statusCode, text, extra = {}) => ({ statusCode, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra }, body: text });

/* ---- certificate chains: fetch the missing intermediate (verification stays on) ---- */
const AIA = new Map();
function getRaw(url, ms = 12000) {
  return new Promise((res, rej) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { timeout: ms }, (r) => { const b = []; r.on("data", (c) => b.push(c)); r.on("end", () => res(Buffer.concat(b))); });
    req.on("error", rej); req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}
const derToPem = (der) => "-----BEGIN CERTIFICATE-----\n" + der.toString("base64").match(/.{1,64}/g).join("\n") + "\n-----END CERTIFICATE-----\n";
async function intermediatesFor(host, port) {
  const key = host + ":" + port;
  if (AIA.has(key)) return AIA.get(key);
  const leaf = await new Promise((res, rej) => {
    // Only reads the server's certificate to learn its issuer address; no content is trusted from this connection.
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 12000 }, () => { const c = s.getPeerCertificate(false); s.end(); res(c && c.raw); });
    s.on("error", rej); s.on("timeout", () => s.destroy(new Error("timeout")));
  });
  const pems = [];
  let cert = new X509Certificate(leaf);
  for (let i = 0; i < 3; i++) {
    const m = String(cert.infoAccess || "").match(/CA Issuers - URI:(\S+)/);
    if (!m) break;
    const der = await getRaw(m[1]);
    if (/^-----BEGIN/.test(der.toString("latin1", 0, 11))) { pems.push(der.toString()); cert = new X509Certificate(der); }
    else { cert = new X509Certificate(der); pems.push(derToPem(der)); }
    if (cert.issuer === cert.subject) break;
  }
  AIA.set(key, pems);
  return pems;
}

/* ---- one request, no automatic redirects ---- */
function request(url, ca, range) {
  const u = new URL(url);
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((res, rej) => {
    const req = mod.get(url, {
      timeout: 25000, servername: u.hostname, ...(ca ? { ca } : {}),
      headers: {
        "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8", "accept-language": "en-IN,en;q=0.9,hi;q=0.8",
        ...(range ? { range: `bytes=${range}` } : {}),
      },
    }, (r) => {
      const chunks = []; let size = 0;
      r.on("data", (c) => {
        size += c.length;
        if (size > MAX_BYTES) { const e = new Error("too large"); e.tooLarge = true; e.length = Number(r.headers["content-length"]) || 0; e.ranges = /bytes/i.test(r.headers["accept-ranges"] || ""); req.destroy(e); return; }
        chunks.push(c);
      });
      r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
      r.on("error", rej);
    });
    req.on("error", rej); req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

export const handler = async (event) => {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!process.env.RELAY_TOKEN || headers["x-relay-key"] !== process.env.RELAY_TOKEN) return reply(401, "unauthorized");
  const q = event.queryStringParameters || {};
  if (q.trace) return reply(200, JSON.stringify({ region: process.env.AWS_REGION, ok: true, version: 2 }));
  const range = /^\d{1,9}-\d{1,9}$/.test(q.range || "") ? q.range : "";

  let target;
  try { target = new URL(q.url || ""); } catch { return reply(400, "url parameter missing or invalid"); }
  for (let hop = 0; hop <= 5; hop++) {
    if (!/^https?:$/.test(target.protocol) || (target.port && !["80", "443"].includes(target.port))) return reply(400, "only plain http(s) URLs");
    if (!allowed(target.hostname)) return reply(403, "relay: host not allowed: " + target.hostname);
    let r;
    try {
      try {
        r = await request(target.href, null, range);
      } catch (e) {
        if (!(CHAIN_ERR.test(String(e.code || e.message)) && target.protocol === "https:")) throw e;
        const extra = await intermediatesFor(target.hostname, Number(target.port) || 443);
        r = await request(target.href, [...tls.rootCertificates, ...extra], range);
      }
    } catch (e) {
      if (e.tooLarge) return reply(413, "relay: too large for one response; use &range=", { "x-relay-length": String(e.length || ""), "x-relay-ranges": e.ranges ? "1" : "0", "x-relay-final-url": target.href });
      return reply(502, "relay: upstream error: " + (e.code || e.message));
    }
    if (r.status >= 300 && r.status < 400 && r.headers.location) { target = new URL(r.headers.location, target); continue; }
    return {
      statusCode: r.status,
      headers: {
        "content-type": r.headers["content-type"] || "application/octet-stream",
        "x-relay-final-url": target.href,
        "x-relay-region": process.env.AWS_REGION || "",
        ...(r.headers["content-range"] ? { "x-relay-range": r.headers["content-range"] } : {}),
        "cache-control": "no-store",
      },
      body: r.body.toString("base64"),
      isBase64Encoded: true,
    };
  }
  return reply(508, "relay: too many redirects");
};
