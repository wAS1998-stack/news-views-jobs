// node --test: classify (jobs vs updates) and the id / fingerprint rules (fetch-jobs.js, shared by watch.js).
const test = require("node:test");
const assert = require("node:assert");
const F = require("../fetch-jobs.js");

test("classify: a cancellation or postponement notice is never a new job", () => {
  assert.notStrictEqual(F.classify("APS Bareilly Recruitment 2026 Cancelled – Official Notice PDF"), "job");
  assert.notStrictEqual(F.classify("Assam Rifles Technical and Tradesman Recruitment Rally 2026 Cancelled"), "job");
  assert.notStrictEqual(F.classify("XYZ Recruitment 2026 Postponed"), "job");
  assert.strictEqual(F.classify("SSC CGL Recruitment 2026 – Apply Online for 14582 Posts"), "job");
  assert.strictEqual(F.classify("RRB NTPC Result 2026 Out"), "result");
  assert.strictEqual(F.classify("UPSSSC PET Answer Key 2026"), "answer-key");
});

test("cleanSlug keeps the numbers that tell recruitments apart", () => {
  const pairs = [["TNPSC Group 2 Recruitment 2026", "TNPSC Group 4 Recruitment 2026"], ["RRB NTPC CBT 1 Result 2026", "RRB NTPC CBT 2 Result 2026"]];
  for (const [a, b] of pairs) {
    assert.notStrictEqual(F.cleanSlug(a), F.cleanSlug(b));
    assert.notStrictEqual(F.fingerprint(a), F.fingerprint(b));
  }
  assert.strictEqual(F.cleanSlug("TNPSC Group 4 Recruitment 2026"), "tnpsc-group-4-2026");
  assert.strictEqual(F.cleanSlug("TNPSC Group IV Recruitment 2026"), "tnpsc-group-4-2026");
  assert.strictEqual(F.cleanSlug("RRB NTPC CBT 2 Result 2026"), "rrb-ntpc-cbt-2-result-2026");
  assert.strictEqual(F.cleanSlug("NTPC Jobs 2026 – Apply Online for 08 Senior Manager Engineer"), "ntpc-senior-manager-engineer-2026");
  assert.strictEqual(F.legacySlug("TNPSC Group 2 Recruitment 2026"), "tnpsc-group-2026");   // the old rule, for listings named before
});

test("a taken id held by a different recruitment gets a distinguisher", () => {
  const taken = new Set(["tnpsc-group-4-2026", "tnpsc-group-4-advt-11-2026"]);
  assert.strictEqual(F.distinctId("tnpsc-group-4-2026", { advt_no: "No. 11/2026", post_name: "Village Administrative Officer" }, taken), "tnpsc-group-4-village-administrative-2026");
  assert.strictEqual(F.sameRecruitment({ advt_no: "11/2026" }, { advt_no: "12/2026" }), false);
  assert.strictEqual(F.sameRecruitment({ post_name: "Junior Engineer", total_vacancies: 40 }, { post_name: "Junior Engineer", total_vacancies: 40 }), true);
});

test("fetch-jobs self-test passes", () => { F.selfTest(); });
