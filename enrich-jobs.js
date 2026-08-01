#!/usr/bin/env node
/**
 * enrich-jobs.js — upgrades EXISTING jobs to rich AI-written content.
 *
 * Jobs fetched before the richer prompt only have template content. This walks
 * data/jobs.json, finds entries missing the AI fields, and fills them in a few
 * at a time so the whole archive is upgraded over several runs without a huge
 * one-off API bill.
 *
 * Grounded: it writes ONLY from facts already stored on the job. It never
 * invents vacancy counts, dates or fees — anything unknown stays unknown.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")); } catch { return {}; } })();
const JOBS = path.join(ROOT, "data", "jobs.json");

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || CONFIG.aiModel || "gpt-4o-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
const AI = OPENAI_KEY ? "OpenAI" : (ANTHROPIC_KEY ? "Claude" : "");
const MAX_PER_RUN = Number(process.env.ENRICH_MAX || CONFIG.maxEnrichPerRun || 5);

function needsEnrich(j) {
  return !(Array.isArray(j.overview) && j.overview.length >= 2)
      || !(Array.isArray(j.faq) && j.faq.length >= 3);
}

async function askAI(prompt, attempt = 1) {
  try {
    if (AI === "OpenAI") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: 3000 }),
      });
      if (!res.ok) {
        if (attempt < 2 && res.status !== 401) { await new Promise((r) => setTimeout(r, 2000)); return askAI(prompt, attempt + 1); }
        console.log(`  (OpenAI HTTP ${res.status})`); return null;
      }
      const d = await res.json();
      return d.choices?.[0]?.message?.content || "";
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 3000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) { console.log(`  (Claude HTTP ${res.status})`); return null; }
    const d = await res.json();
    return (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  } catch (e) { console.log("  (AI error: " + e.message + ")"); return null; }
}
function parseJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { return null; }
}
const strArr = (x, n) => (Array.isArray(x) ? x : []).map((v) => String(v || "").trim()).filter(Boolean).slice(0, n);

async function enrich(job) {
  const facts = [
    `Title: ${job.title}`, `Organisation: ${job.organization || ""}`, `Post: ${job.post_name || ""}`,
    `Vacancies: ${job.total_vacancies ?? "not stated"}`, `Qualification: ${job.qualification || "not stated"}`,
    `Location: ${job.location || "not stated"}`, `Application start: ${job.application_start || "not stated"}`,
    `Last date: ${job.application_end || "not stated"}`, `Exam date: ${job.exam_date || "not stated"}`,
    `Fee: ${job.fee || "not stated"}`, `Salary: ${job.salary || "not stated"}`,
    `Existing summary: ${job.summary || ""}`,
  ].join("\n");
  const prompt = `You are writing the content for one recruitment page on an Indian government-jobs website. ` +
    `Use ONLY the verified facts below. Never invent vacancy numbers, dates, fees, salaries or cut-offs. ` +
    `Where a fact is "not stated", tell the reader to check the official notification instead of guessing.\n\n` +
    `Return ONLY a JSON object with keys: ` +
    `overview (array of 3 paragraphs, 160-220 words total, explaining this recruitment in plain English: what the post involves, who it suits, and what applicants should check before applying), ` +
    `about_organization (2-3 sentences, 50-70 words, on the recruiting body and the work it does), ` +
    `eligibility_notes (2-3 sentences explaining the eligibility in plain language, flagging any conditions worth noting), ` +
    `preparation_tips (array of 3-4 practical pointers tailored to THIS exam and post, naming the actual subjects or stages where known), ` +
    `faq (array of 4-5 objects with keys q and a, answering what a real candidate would ask about this specific recruitment; each answer 1-3 sentences).\n\n` +
    `Write genuinely useful original prose in a clear, neutral, informative style — never filler, never repeated boilerplate.\n\nVERIFIED FACTS:\n${facts}`;

  const o = parseJson(await askAI(prompt));
  if (!o) return null;
  const overview = strArr(o.overview, 4);
  const faq = (Array.isArray(o.faq) ? o.faq : [])
    .map((x) => ({ q: String(x?.q || x?.question || "").trim(), a: String(x?.a || x?.answer || "").trim() }))
    .filter((x) => x.q && x.a).slice(0, 6);
  // Quality gate: don't overwrite good template content with a weak AI answer.
  if (overview.length < 2 || overview.join(" ").split(/\s+/).length < 100 || faq.length < 3) return null;
  return {
    overview,
    about_organization: String(o.about_organization || "").trim() || undefined,
    eligibility_notes: String(o.eligibility_notes || "").trim() || undefined,
    preparation_tips: strArr(o.preparation_tips, 5),
    faq,
  };
}

async function main() {
  if (!AI) { console.log("Enrich: no AI key — skipping."); return; }
  let jobs = [];
  try { jobs = JSON.parse(fs.readFileSync(JOBS, "utf8")); } catch { console.log("Enrich: cannot read jobs.json"); return; }
  if (!Array.isArray(jobs)) return;

  const pending = jobs.filter((j) => j && j.id && j.title && needsEnrich(j));
  console.log(`Enrich: AI ${AI} (${AI === "OpenAI" ? OPENAI_MODEL : ANTHROPIC_MODEL}) | ${pending.length} job(s) still on template content | doing up to ${MAX_PER_RUN} this run`);
  if (!pending.length) { console.log("Enrich: every job already has full AI content."); return; }

  let done = 0;
  for (const job of pending.slice(0, MAX_PER_RUN)) {
    const rich = await enrich(job);
    if (!rich) { console.log(`  - skipped (quality gate): ${job.title}`); continue; }
    Object.assign(job, rich);
    done++;
    console.log(`  ✓ enriched: ${job.title}`);
    await new Promise((r) => setTimeout(r, 800));   // gentle on rate limits
  }
  if (!done) { console.log("Enrich: nothing written."); return; }
  fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 2) + "\n");
  console.log(`Enrich: upgraded ${done} job page(s). ${Math.max(0, pending.length - done)} remaining for future runs.`);
}
main();
