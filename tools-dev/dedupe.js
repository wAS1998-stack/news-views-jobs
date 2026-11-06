#!/usr/bin/env node
/**
 * dedupe.js — find job pages that are the same recruitment twice and merge them, by the STRICT rule only:
 *   the same official notification PDF (identical URL) AND the same total_vacancies,
 * and, as a safety net, organisations that plainly belong together and post names that overlap (one PDF can be a
 * district's combined notice for unrelated single posts; one wrong extraction can attach another body's PDF).
 *
 *   node tools-dev/dedupe.js           list the pairs (nothing is written)
 *   node tools-dev/dedupe.js --write   merge them: keep the OLDER id, copy fields it lacks from the newer one, drop the
 *                                      newer record and add [newer -> older] 301s to data/redirects.json (English and
 *                                      Hindi pages), the format the build already reads. No page is removed without a
 *                                      redirect; a retired id is never re-added (fetch-jobs.js / watch.js read the file).
 * Check every printed pair by eye before committing the result.
 */
const fs = require("fs");
const path = require("path");
const L = require("../lib.js");

const ROOT = path.join(__dirname, "..");
const JOBS = path.join(ROOT, "data", "jobs.json");
const REDIRECTS = path.join(ROOT, "data", "redirects.json");
const write = process.argv.includes("--write");

// Fields never copied across: identity, the page's own wording and per-record bookkeeping.
const KEEP_OWN = new Set(["id", "title", "published", "hi", "summary", "summary_hindi", "overview", "faq", "via", "state_hint",
  "apply_checked", "apply_tries", "apply_link_prev", "apply_src", "links_checked", "faq_search_at", "faq_search"]);
const ORG_GENERIC = new Set("india indian national state central government govt department office institute institution university college school limited board commission council corporation authority society research district centre center ministry public service services bank pune delhi mumbai".split(" "));
const orgWords = (j) => new Set(`${j.organization || ""} ${j.org_short || ""}`.toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z]+/).filter((w) => w.length >= 4 && !ORG_GENERIC.has(w)));
const orgsRelated = (a, b) => L.sameOrg(a, b) || [...orgWords(a)].some((w) => orgWords(b).has(w));
const isPdf = (u) => /\.pdf(\?|#|$)/i.test(String(u || ""));
const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

function findPairs(jobs) {
  const groups = new Map();
  jobs.forEach((j, i) => {
    if (!isPdf(j.official_notification) || !(Number(j.total_vacancies) > 0)) return;
    const k = `${String(j.official_notification).trim()}|${Number(j.total_vacancies)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ j, i });
  });
  const pairs = [], doubtful = [];
  for (const [key, g] of groups) {
    if (g.length < 2) continue;
    // older first: earlier published date; on the same date the record further down jobs.json (newest-first) is older
    g.sort((a, b) => String(a.j.published || "").localeCompare(String(b.j.published || "")) || b.i - a.i);
    const keep = g[0].j;
    for (const { j: newer } of g.slice(1)) {
      const why = !orgsRelated(keep, newer) ? "different organisations" : !L.postsOverlap(keep.post_name, newer.post_name, { any: true }) ? "different posts" : "";
      (why ? doubtful : pairs).push({ key, older: keep, newer, why });
    }
  }
  return { pairs, doubtful };
}

function main() {
  const jobs = JSON.parse(fs.readFileSync(JOBS, "utf8"));
  const reds = JSON.parse(fs.readFileSync(REDIRECTS, "utf8"));
  const { pairs, doubtful } = findPairs(jobs);
  for (const p of pairs) {
    const conflicts = ["application_end", "application_start", "total_vacancies"].filter((k) => !empty(p.older[k]) && !empty(p.newer[k]) && String(p.older[k]) !== String(p.newer[k]));
    console.log(`TWIN  ${p.newer.id} -> ${p.older.id}\n      newer: ${p.newer.title} (${p.newer.published}, last date ${p.newer.application_end || "?"})\n      older: ${p.older.title} (${p.older.published}, last date ${p.older.application_end || "?"})` +
      (conflicts.length ? `\n      differs: ${conflicts.map((k) => `${k} ${p.older[k]} (kept) vs ${p.newer[k]}`).join("; ")}` : ""));
  }
  for (const p of doubtful) console.log(`SKIP  ${p.newer.id} / ${p.older.id}: same PDF and count but ${p.why} — not merged\n      ${p.newer.title}\n      ${p.older.title}`);
  console.log(`${pairs.length} twin pair(s), ${doubtful.length} skipped as not clearly the same recruitment.`);
  if (!write || !pairs.length) { if (pairs.length) console.log("Dry run: add --write to merge."); return; }

  const drop = new Set();
  const have = new Set(reds.map((r) => r[0]));
  for (const { older, newer } of pairs) {
    if (drop.has(older.id)) continue;   // never merge into a record that is itself being retired
    for (const [k, v] of Object.entries(newer)) if (!KEEP_OWN.has(k) && empty(older[k]) && !empty(v)) older[k] = v;
    drop.add(newer.id);
    for (const [from, to] of [[`/jobs/${newer.id}/`, `/jobs/${older.id}/`], [`/hi/jobs/${newer.id}/`, `/hi/jobs/${older.id}/`]]) {
      if (!have.has(from)) { reds.push([from, to]); have.add(from); }
    }
  }
  const kept = jobs.filter((j) => !drop.has(j.id));
  fs.writeFileSync(JOBS, JSON.stringify(kept, null, 2) + "\n");
  fs.writeFileSync(REDIRECTS, JSON.stringify(reds, null, 2) + "\n");
  console.log(`Merged ${drop.size} newer record(s) into their older twin; ${kept.length} jobs left; redirects added.`);
}

module.exports = { findPairs, orgsRelated };
if (require.main === module) main();
