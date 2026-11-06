// node --test: build.js helpers (requiring build.js builds nothing; `node build.js` does).
const test = require("node:test");
const assert = require("node:assert");
const B = require("../build.js");

const quals = (q, title = "X Recruitment 2026") => B.qualsOf({ qualification: q, title }).map((x) => x.slug);

test("qualsOf: post-graduation is not graduation; nothing matched = []", () => {
  assert.deepStrictEqual(quals("Post Graduate in Economics"), ["post-graduate"]);
  assert.deepStrictEqual(quals("Post-Graduation with 55% marks"), ["post-graduate"]);
  assert.deepStrictEqual(quals("PG in Statistics"), ["post-graduate"]);
  assert.deepStrictEqual(quals("Master's degree in Social Work"), ["post-graduate"]);
  assert.deepStrictEqual(quals("Graduate or Post Graduate"), ["graduate", "post-graduate"]);
  assert.deepStrictEqual(quals("Bachelor's degree in any discipline"), ["graduate"]);
  assert.deepStrictEqual(quals("10th pass with ITI"), ["10th-pass", "engineering-diploma"]);
  assert.deepStrictEqual(quals("", "DMRC Chief Architect Recruitment 2026"), []);
});

test("JobPosting: no 'India' locality, sameAs only the official website, no guessed education", () => {
  const ld = B.jobLd({ id: "x", title: "X Recruitment 2026", organization: "X Board", location: "All India", apply_link: "https://x-portal.in/apply", published: "2026-11-01" });
  assert.strictEqual(ld.jobLocation.address.addressLocality, undefined);
  assert.strictEqual(ld.jobLocation.address.addressCountry, "IN");
  assert.strictEqual(ld.hiringOrganization.sameAs, undefined);
  assert.strictEqual(ld.educationRequirements, undefined);
  const ld2 = B.jobLd({ id: "y", title: "Y", organization: "Y", location: "Patna, Bihar", official_website: "https://y.gov.in/", qualification: "B.E. or Diploma", published: "2026-11-01" });
  assert.strictEqual(ld2.jobLocation.address.addressLocality, "Patna, Bihar");
  assert.strictEqual(ld2.hiringOrganization.sameAs, "https://y.gov.in/");
  assert.strictEqual(ld2.educationRequirements.credentialCategory, "professional certificate");   // the lowest level asked
});

test("shortTitle cuts the SEO tail but keeps the recruitment name", () => {
  assert.strictEqual(B.shortTitle("NTPC Recruitment 2026 – Apply Online for 78 Posts"), "NTPC Recruitment 2026");
  assert.strictEqual(B.shortTitle("SSC CGL Admit Card 2026 Out – Download Hall Ticket"), "SSC CGL Admit Card 2026");
  assert.strictEqual(B.shortTitle("UPSC Notification Out"), "UPSC Notification Out");
});

test("a cancelled recruitment is not live", () => {
  assert.strictEqual(B.statusOf({ application_end: "2099-01-01", notice_status: "cancelled" }).live, false);
  assert.strictEqual(B.statusOf({ application_end: "2099-01-01" }).live, true);
});
