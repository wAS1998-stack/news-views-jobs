#!/usr/bin/env node
/**
 * priority.js — did this run find something big enough to publish now instead of waiting for the next regular
 * build slot? Yes for a new recruitment with 500+ posts, or a new result / admit card / answer key / exam date of a
 * major exam. Compares the working tree's data with origin/main. Prints "yes" or "no" (details on stderr).
 * The commit step allows at most 2 such builds a day, at least 30 minutes apart, to protect the
 * Cloudflare Pages build budget (500 a month).
 */
const fs = require("fs");
const { execSync } = require("child_process");
const BIG = /\b(ssc|rrb|railway|ibps|sbi|rbi|upsc|nda|cds|nvs|jnvst?|ctet|police|constable|army|navy|air ?force|agniveer|bpsc|uppsc|upsssc|mppsc|mpesb|rpsc|rssb|rsmssb|hssc|hpsc|kpsc|kea|tnpsc|tgpsc|tspsc|appsc|wbpsc|wbssc|gpsc|gsssb|mpsc|jkssb|bssc|dsssb|kvs|lic|gds|india post|neet|jee|cuet)\b/i;
const list = (x) => (Array.isArray(x) ? x : (x && (x.jobs || x.updates)) || []);
const now = (f) => { try { return list(JSON.parse(fs.readFileSync(f, "utf8"))); } catch { return []; } };
const before = (f) => { try { return list(JSON.parse(execSync(`git show origin/main:${f}`, { maxBuffer: 1 << 30 }).toString())); } catch { return null; } };
const oldJobs = before("data/jobs.json"), oldUpd = before("data/updates.json");
if (!oldJobs || !oldUpd) { console.log("no"); process.exit(0); }
const seenJ = new Set(oldJobs.map((j) => j.id)), seenU = new Set(oldUpd.map((u) => u.id));
const big = [
  ...now("data/jobs.json").filter((j) => !seenJ.has(j.id) && (Number(j.total_vacancies) || 0) >= 500),
  ...now("data/updates.json").filter((u) => !seenU.has(u.id) && BIG.test(`${u.title} ${u.org_short || ""}`)),
];
if (big.length) console.error("priority: " + big.slice(0, 5).map((x) => x.title).join(" | "));
console.log(big.length ? "yes" : "no");
