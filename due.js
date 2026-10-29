#!/usr/bin/env node
/**
 * due.js <section> <minutes> — prints "true" when data/last-run.json shows that <section> last ran more than
 * <minutes> ago (or not yet today), else "false". The workflow runs several times an hour so new notifications
 * are picked up fast; the expensive AI steps (enrichment, news digest) use this to run only when due.
 * FORCE_ALL=1 (manual runs) always prints "true".
 */
const fs = require("fs");
const path = require("path");
const section = process.argv[2], minutes = Number(process.argv[3] || 0);
let at = null;
try { const r = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "last-run.json"), "utf8")); at = r[section] && r[section].at; } catch {}
const due = process.env.FORCE_ALL === "1" || !at || (Date.now() - Date.parse(at)) / 60000 >= minutes;
console.log(due ? "true" : "false");
