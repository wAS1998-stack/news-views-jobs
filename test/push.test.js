// node --test: app alert targeting (push-notify.js) — who receives a job alert, and when a result counts as declared.
const test = require("node:test");
const assert = require("node:assert");
const P = require("../push-notify.js");

const bihar = { id: "b", s: ["bihar"], q: ["graduate"], v: 100 };
const central = { id: "c", s: ["all-india"], q: ["10th-pass"], v: 500 };

test("a state job reaches 'All states' phones only when it was picked for that audience", () => {
  assert.deepStrictEqual(P.jobConditions(bihar, "en", { any: false }), ["'s-bihar' in topics && 'q-graduate' in topics && 'l-en' in topics"]);
  assert.deepStrictEqual(P.jobConditions(bihar, "en", { any: true }), ["('s-bihar' in topics || 's-any' in topics) && 'q-graduate' in topics && 'l-en' in topics"]);
  assert.deepStrictEqual(P.jobConditions(central, "hi", { any: false }), ["'s-central' in topics && 'q-10th-pass' in topics && 'l-hi' in topics"]);
  for (const c of P.jobConditions({ id: "m", s: ["bihar", "up", "mp"], q: ["graduate", "engineering-diploma"] }, "en", { any: true }))
    assert.ok((c.match(/' in topics/g) || []).length <= 5, "FCM allows at most 5 topics in a condition: " + c);
});

test("'Result declared' only when the English headline says the result is out", () => {
  const u = (t, th) => ({ ty: "result", t, th, o: "" });
  assert.match(P.updateBody(u("SSC CGL Tier 1 Result 2026 Out"), "en"), /Result declared/);
  assert.match(P.updateBody(u("UPSC CSE Result 2026 Declared"), "hi"), /रिजल्ट जारी/);
  assert.doesNotMatch(P.updateBody(u("SBI Clerk Prelims Result 2026 - Check Result Date, Mains Exam Schedule", "SBI क्लर्क प्रीलिम्स रिजल्ट 2026 जारी"), "en"), /declared/);
  assert.doesNotMatch(P.updateBody(u("RRB NTPC Result 2026 Out Soon"), "en"), /declared/);
  assert.doesNotMatch(P.updateBody({ ty: "admit-card", t: "SSC GD Admit Card 2026 Out", o: "" }, "en"), /declared/);
});
