#!/usr/bin/env node
/**
 * IndexNow pinger — instantly notifies Bing, Yandex and other IndexNow engines
 * about new/updated URLs. Unlike Google's Indexing API this needs NO service
 * account and NO Search Console owner — just a key file hosted on the site.
 *
 * Submits the newly-added job URLs (data/new-urls.txt) when present,
 * otherwise all job URLs from jobs.json.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const KEY = "761d3fa6bfbb9013f7da584d6b8b4eaa";
const CFG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")); } catch { return {}; } })();
const SITE = (CFG.url || "https://news-views.in").replace(/\/$/, "");
const HOST = SITE.replace(/^https?:\/\//, "");

function collectUrls() {
  let urls = process.argv.slice(2);
  if (!urls.length) {
    try {
      const txt = fs.readFileSync(path.join(ROOT, "data", "new-urls.txt"), "utf8");
      urls = txt.split("\n").map((s) => s.trim()).filter(Boolean);
    } catch { /* ignore */ }
  }
  if (!urls.length) {
    try {
      const jobs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "jobs.json"), "utf8"));
      urls = jobs.filter((j) => j && j.id).map((j) => `${SITE}/jobs/${j.id}/`);
    } catch { urls = []; }
  }
  // Always include the hub pages so their "referring page" signal refreshes.
  const hubs = ["/", "/updates/", "/guides/",
    "/qualification/10th-pass/", "/qualification/12th-pass/", "/qualification/graduate/",
    "/qualification/engineering-diploma/", "/qualification/post-graduate/"].map((p) => SITE + p);
  return [...new Set([...hubs, ...urls])].slice(0, 10000);
}

async function main() {
  const urlList = collectUrls();
  if (!urlList.length) { console.log("IndexNow: no URLs to submit."); return; }
  const body = { host: HOST, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList };
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    // 200 or 202 = accepted
    if (res.status === 200 || res.status === 202) {
      console.log(`IndexNow: submitted ${urlList.length} URL(s) — accepted (${res.status}).`);
    } else {
      console.log(`IndexNow: response ${res.status} (non-fatal).`);
    }
  } catch (e) {
    console.log("IndexNow error (non-fatal): " + e.message);
  }
}
main();
