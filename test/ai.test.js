// AI outages: what a failed call tells the pipeline, and what happens to records read without the AI.
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const L = require("../lib.js");

/** Runs a snippet in a fresh process (the keys are read when lib.js loads) with fetch replaced; returns what it prints as JSON. */
function withAI(env, mocks, body) {
  const script = `
    const calls = { openai: 0, claude: 0 };
    ${mocks}
    global.fetch = async (url) => {
      const openai = /openai/.test(url); calls[openai ? "openai" : "claude"]++;
      const r = (openai ? OPENAI : CLAUDE)(calls);
      return { ok: r.status === 200, status: r.status, headers: { get: () => null }, json: async () => r.body };
    };
    const L = require("./lib.js");
    (async () => { ${body}
      process.removeAllListeners("exit");   // no usage file from a test
      console.log(JSON.stringify({ calls, out, status: L.aiStatus(), down: L.aiDown() }));
    })();`;
  const out = execFileSync(process.execPath, ["-e", script], { cwd: ROOT, encoding: "utf8",
    env: { ...process.env, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", ...env } });
  return JSON.parse(out.trim().split("\n").pop());
}
const NO_CREDIT = `({ status: 429, body: { error: { code: "insufficient_quota", type: "insufficient_quota" } } })`;

test("askAI: no credit is named, asked once, and stops further calls", () => {
  const r = withAI({ OPENAI_API_KEY: "k" }, `const OPENAI = () => ${NO_CREDIT}; const CLAUDE = () => ({ status: 500, body: {} });`, `
    const out = [await L.askAI("a"), await L.askAI("b"), await L.askAI("c", { essential: true })];`);
  assert.deepStrictEqual(r.out, [null, null, null]);
  assert.strictEqual(r.calls.openai, 1, "one refused call, no retry, later calls are not sent");
  assert.strictEqual(r.calls.claude, 0, "no second key: no fallback");
  assert.strictEqual(r.down, "insufficient_quota");
  assert.match(r.status, /OpenAI refused: insufficient_quota/);
});

test("askAI: essential calls go to the second provider while the first one refuses", () => {
  const r = withAI({ OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k2" }, `const OPENAI = () => ${NO_CREDIT};
    const CLAUDE = () => ({ status: 200, body: { content: [{ type: "text", text: '{"ok":1}' }], usage: { input_tokens: 10, output_tokens: 5 } } });`, `
    const out = [await L.askAI("a", { essential: true }), await L.askAI("b"), await L.askAI("c", { essential: true })];`);
  assert.deepStrictEqual(r.out, ['{"ok":1}', null, '{"ok":1}']);
  assert.strictEqual(r.calls.openai, 1);
  assert.strictEqual(r.calls.claude, 2, "only the essential calls");
  assert.match(r.status, /2 answered by the second provider/);
});

test("askAI: a working call reports ok", () => {
  const r = withAI({ OPENAI_API_KEY: "k" }, `const OPENAI = () => ({ status: 200, body: { choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } } });
    const CLAUDE = () => ({ status: 500, body: {} });`, `
    const out = [await L.askAI("a")];`);
  assert.deepStrictEqual(r.out, ['{"a":1}']);
  assert.strictEqual(r.down, "");
  assert.strictEqual(r.status, "ok (1 calls)");
});

test("the stand-in apply steps name no way of applying", () => {
  assert.strictEqual(L.applyMode({ title: "X Recruitment 2026", how_to_apply: L.GENERIC_STEPS }), "unknown");
  assert.strictEqual(L.applyMode({ title: "SCERT Project Officer Recruitment 2026 – Apply Offline", how_to_apply: L.GENERIC_STEPS }), "offline");
  assert.ok(!/regist|online|post\b|e-?mail|walk/i.test(L.GENERIC_STEPS.join(" ")));
  assert.strictEqual(L.GENERIC_STEPS.length, L.GENERIC_STEPS_HI.length);
});

test("sanitizeJob replaces the old stand-in steps (English and Hindi)", () => {
  const old = ["Visit the official website linked on this page and open the recruitment/registration link.",
    "Complete the one-time registration with a valid email and mobile number.", "Fill in your personal, educational and category details exactly as in your documents."];
  const j = L.sanitizeJob({ id: "a", title: "A Walk-in 2026", how_to_apply: old, hi: { title: "अ", how_to_apply: ["क", "ख", "ग"] } });
  assert.deepStrictEqual(j.how_to_apply, L.GENERIC_STEPS);
  assert.deepStrictEqual(j.hi.how_to_apply, L.GENERIC_STEPS_HI);
  assert.strictEqual(j.hi.title, "अ");
  const real = ["Go to ssc.gov.in", "Register", "Fill the form"];
  assert.deepStrictEqual(L.sanitizeJob({ id: "b", title: "B", how_to_apply: real }).how_to_apply, real);
});

test("factless / factsPending: only headline-only records, for 30 days and 3 tries", () => {
  const today = L.todayIST();
  const base = { id: "x", title: "X Recruitment 2026", source: "https://example.com/x", published: today };
  assert.ok(L.factless(base) && L.factsPending(base));
  assert.ok(!L.factless({ ...base, post_name: "Clerk" }));
  assert.ok(!L.factless({ ...base, application_end: today }));
  assert.ok(!L.factless({ ...base, facts_read: today }), "read, and the notice names nothing");
  assert.ok(!L.factsPending({ ...base, facts_tries: 3 }));
  assert.ok(!L.factsPending({ ...base, published: "2026-01-01" }, "2026-03-01"));
  assert.ok(!L.factsPending({ ...base, source: "" }));
});

test("enrich: a thin update is read again once; an update is due until it is marked", () => {
  const E = require("../enrich-jobs.js");
  const recent = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  assert.ok(E.needsUpdateEnrich({ id: "u", date: recent }));
  assert.ok(E.needsUpdateEnrich({ id: "u", date: recent, enriched: "partial" }));
  assert.ok(!E.needsUpdateEnrich({ id: "u", date: recent, enriched: "partial-2" }));
  assert.ok(!E.needsUpdateEnrich({ id: "u", date: "2026-01-01", enriched: "partial" }));
  assert.ok(!E.needsUpdateEnrich({ id: "u", date: recent, steps: ["a", "b", "c"] }));
});

test("enrich: reading the facts again fills the record and keeps what must not change", async () => {
  const E = require("../enrich-jobs.js"), F = require("../fetch-jobs.js");
  const keep = { readSource: F.readSource, aiExtract: F.aiExtract };
  const today = L.todayIST();
  const job = { id: "asrb-ta-sta-2026", title: "ASRB TA STA Recruitment 2026 - Apply Online for 1393 Posts", organization: "ASRB TA STA", summary: "feed text",
    apply_link: "https://asrb.gov.in/", official_website: "https://asrb.gov.in/", source: "https://example.com/asrb", published: today,
    how_to_apply: L.GENERIC_STEPS.slice(), apply_checked: today, apply_tries: 1, hi: { title: "पुराना" } };
  try {
    F.readSource = async () => ({ text: "notice", cands: [{ url: "https://asrb.gov.in/notice.pdf", host: "asrb.gov.in", text: "Notification", pdf: true }] });
    // the AI did not answer (returns nothing while lib reports a failure): nothing changes, not a try
    F.aiExtract = async () => ({});
    const before = JSON.stringify(job);
    assert.strictEqual(await E.readFacts(job), "empty");          // no AI fault recorded in this process: an empty reading is a try
    assert.strictEqual(job.facts_tries, 1);
    job.facts_tries = 0; assert.ok(before.length > 0);
    F.aiExtract = async () => ({ organization: "Agricultural Scientists Recruitment Board", org_short: "ASRB", post_name: "Technical Assistant, Senior Technical Assistant",
      total_vacancies: "1393", qualification: "Bachelor's degree", application_end: "2099-12-31", summary: "ASRB has announced 1393 posts of TA and STA.",
      apply_link: "https://evil.example/apply", official_notification: "https://asrb.gov.in/notice.pdf", title: "changed", published: "2020-01-01",
      fee: { General: "1000", SC: "Nil" }, how_to_apply: ["Open asrb.gov.in", "Register", "Fill the form", "Pay the fee"] });
    assert.strictEqual(await E.readFacts(job), "ok");
    assert.strictEqual(job.id, "asrb-ta-sta-2026");
    assert.strictEqual(job.title, "ASRB TA STA Recruitment 2026 - Apply Online for 1393 Posts", "the headline is not the AI's");
    assert.strictEqual(job.published, today);
    assert.strictEqual(job.organization, "Agricultural Scientists Recruitment Board");
    assert.strictEqual(job.total_vacancies, 1393);
    assert.strictEqual(job.fee, "General: 1000; SC: Nil", "objects become text");
    assert.strictEqual(job.official_notification, "https://asrb.gov.in/notice.pdf");
    assert.notStrictEqual(job.apply_link, "https://evil.example/apply", "a link that is not on the page is never stored");
    assert.ok(!job.hi && !job.apply_checked && !job.apply_tries && !job.facts_tries);
    assert.ok(!L.factless(job) && !L.factsPending(job));
    assert.strictEqual(job.how_to_apply.length, 4);
  } finally { Object.assign(F, keep); }
});
