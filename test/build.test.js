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

test("_redirects: wildcard rules go last, or Cloudflare stops reading 100 rules after the first one", () => {
  const lines = ["/jobs/a/ /jobs/ 301", "/author/* /about/ 301", "/jobs/b/ /jobs/b-2/ 301", "/category/:name/ /guides/ 301", "/jobs/c/ /jobs/ 301"];
  const out = B.orderRedirects(lines);
  assert.deepStrictEqual(out, ["/jobs/a/ /jobs/ 301", "/jobs/b/ /jobs/b-2/ 301", "/jobs/c/ /jobs/ 301", "/author/* /about/ 301", "/category/:name/ /guides/ 301"]);
  const firstDynamic = out.findIndex(B.isDynamicRedirect);
  assert.ok(out.slice(firstDynamic).every(B.isDynamicRedirect), "a plain rule after a wildcard rule would count as dynamic");
  // limits: 1,900 plain rules (specific ones kept over fallbacks to a section page) and 100 wildcard rules
  const many = [...Array.from({ length: 1500 }, (_, i) => `/jobs/x${i}/ /jobs/ 301`), ...Array.from({ length: 800 }, (_, i) => `/jobs/y${i}/ /jobs/z${i}/ 301`), ...Array.from({ length: 130 }, (_, i) => `/old${i}/* / 301`)];
  const capped = B.orderRedirects(many);
  assert.strictEqual(capped.filter((l) => !B.isDynamicRedirect(l)).length, 1900);
  assert.strictEqual(capped.filter(B.isDynamicRedirect).length, 100);
  assert.strictEqual(capped.filter((l) => /\/jobs\/z\d+\/ 301$/.test(l)).length, 800, "specific redirects are kept");
});
