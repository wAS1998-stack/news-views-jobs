#!/usr/bin/env node
/**
 * Google Indexing API pinger.
 * Notifies Google to (re)crawl JobPosting URLs for near-instant indexing.
 * Officially supported ONLY for pages with JobPosting/BroadcastEvent schema —
 * so this pings JOB pages only (never guides/updates/other pages).
 *
 * Auth: a Google Cloud service-account JSON key, provided via the
 * GOOGLE_SERVICE_ACCOUNT_JSON environment variable (a GitHub secret).
 * If the secret is absent, this script exits quietly (no-op) so the
 * workflow never fails just because indexing isn't configured yet.
 *
 * Usage:
 *   node ping-google.js            # pings every job URL in data/jobs.json
 *   node ping-google.js url1 url2  # pings only the given URLs
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const SITE_URL = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")).url.replace(/\/$/, ""); }
  catch { return "https://news-views.in"; }
})();

const RAW = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
if (!RAW.trim()) {
  console.log("Indexing API: GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping (this is optional).");
  process.exit(0);
}

let KEY;
try { KEY = JSON.parse(RAW); }
catch { console.log("Indexing API: service-account JSON is not valid JSON — skipping."); process.exit(0); }

// ---- Build a signed JWT and exchange it for an access token (no deps) ----
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: KEY.client_email,
    scope: "https://www.googleapis.com/auth/indexing",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = b64url(signer.sign(KEY.private_key));
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("token error: " + JSON.stringify(data));
  return data.access_token;
}

async function publish(token, url) {
  const res = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url, type: "URL_UPDATED" }),
  });
  return res.status;
}

async function main() {
  // Priority order for which URLs to submit:
  //   1. CLI args (explicit)
  //   2. data/new-urls.txt (exactly the jobs added this run) — precise & quota-friendly
  //   3. all jobs in jobs.json (fallback, e.g. first-ever run)
  let urls = process.argv.slice(2);
  let source = "cli";
  if (!urls.length) {
    try {
      const txt = fs.readFileSync(path.join(ROOT, "data", "new-urls.txt"), "utf8");
      urls = txt.split("\n").map((s) => s.trim()).filter(Boolean);
      source = "new-urls.txt";
    } catch { /* fall through */ }
  }
  if (!urls.length) {
    try {
      const jobs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "jobs.json"), "utf8"));
      urls = jobs.filter((j) => j && j.id).map((j) => `${SITE_URL}/jobs/${j.id}/`);
      source = "all jobs";
    } catch { urls = []; }
  }
  if (!urls.length) { console.log("Indexing API: no job URLs to submit."); return; }

  // Google quota is 200 URLs/day. Cap per run to stay safe.
  urls = urls.slice(0, 180);
  console.log(`Indexing API: ${urls.length} URL(s) from ${source}.`);

  let token;
  try { token = await getAccessToken(); }
  catch (e) { console.log("Indexing API: auth failed — " + e.message + " (skipping)."); return; }

  let ok = 0, fail = 0;
  for (const url of urls) {
    try {
      const status = await publish(token, url);
      if (status === 200) ok++;
      else { fail++; if (fail <= 3) console.log(`  ping ${status}: ${url}`); }
    } catch (e) { fail++; }
    await new Promise((r) => setTimeout(r, 120)); // gentle pacing
  }
  console.log(`Indexing API: submitted ${ok} job URL(s) to Google${fail ? `, ${fail} failed/limited` : ""}.`);
}

main().catch((e) => { console.log("Indexing API error (non-fatal): " + e.message); });
