#!/usr/bin/env node
/* test-indexing.js — sends 2 real Indexing API notifications (newest job pages) and records Google's exact replies,
   plus metadata lookups, so we can see whether our job-page pings are accepted. Writes data/indexing-test.json. */
const fs = require("fs"), path = require("path"), G = require("../google.js");
const ROOT = path.join(__dirname, "..");
(async () => {
  const key = G.loadKey(); if (!key) { console.log("no key"); return; }
  const out = { at: new Date().toISOString(), serviceAccount: key.client_email, project: key.project_id, calls: [] };
  let token;
  try { token = await G.getToken("https://www.googleapis.com/auth/indexing"); } catch (e) { out.tokenError = e.message; }
  if (token) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "jobs.json"), "utf8"));
    const jobs = (Array.isArray(raw) ? raw : raw.jobs).filter((j) => j && j.id).sort((a, b) => String(b.published).localeCompare(String(a.published)));
    const urls = jobs.slice(0, 2).map((j) => `https://news-views.in/jobs/${j.id}/`);
    const oldest = `https://news-views.in/jobs/${jobs[jobs.length - 1].id}/`;
    for (const url of urls) {
      const r = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ url, type: "URL_UPDATED" }) });
      out.calls.push({ op: "publish", url, status: r.status, body: (await r.text()).slice(0, 600) });
    }
    for (const url of [...urls, oldest]) {
      const r = await fetch(`https://indexing.googleapis.com/v3/urlNotifications/metadata?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${token}` } });
      out.calls.push({ op: "metadata", url, status: r.status, body: (await r.text()).slice(0, 400) });
    }
  }
  fs.writeFileSync(path.join(ROOT, "data", "indexing-test.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => console.log("test error " + e.message));
