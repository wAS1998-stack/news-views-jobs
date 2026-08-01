#!/usr/bin/env node
/**
 * heartbeat.js — keeps the published "updated" date honest.
 *
 * The site header shows the build date. A build only runs when data changes,
 * so on a quiet day (feeds publish nothing new) the date froze and the site
 * looked stale even though the automation was working perfectly.
 *
 * This writes data/last-run.json once per calendar day. That single-line change
 * is enough for the commit step to push, which triggers a Cloudflare rebuild,
 * which refreshes the date. On the 2nd and 3rd run of the same day nothing is
 * written, so we don't spam commits.
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "data", "last-run.json");
const today = new Date().toISOString().slice(0, 10);

let prev = null;
try { prev = JSON.parse(fs.readFileSync(FILE, "utf8")).date || null; } catch { /* first run */ }

if (prev === today) {
  console.log(`Heartbeat: already refreshed today (${today}) — no commit needed.`);
} else {
  fs.writeFileSync(FILE, JSON.stringify({ date: today, note: "Daily freshness marker — triggers a rebuild so the site's updated date stays current." }, null, 2) + "\n");
  console.log(`Heartbeat: marked ${today} (was ${prev || "never"}) — site will rebuild and show today's date.`);
}
