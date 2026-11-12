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

const daysAgo = (n) => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

test("hasHiPage: a Hindi detail page only for open jobs and a week after the last date", () => {
  const hi = { title: "भर्ती 2026" };
  assert.strictEqual(B.hasHiPage({ hi, application_end: daysAgo(-10), published: daysAgo(2) }), true);
  assert.strictEqual(B.hasHiPage({ hi, application_end: daysAgo(3), published: daysAgo(20) }), true);
  assert.strictEqual(B.hasHiPage({ hi, application_end: daysAgo(30), published: daysAgo(50) }), false);
  assert.strictEqual(B.hasHiPage({ application_end: daysAgo(-10), published: daysAgo(2) }), false);   // no Hindi version
  assert.strictEqual(B.hasHiPage({ hi, published: daysAgo(5) }), true);                                // no last date: while it is fresh
});

test("fitToBudget: nothing leaves while the site fits; past the limit the oldest closed pages go, never an open job", () => {
  const open = Array.from({ length: 5 }, (_, i) => ({ id: `open-${i}`, title: "Open", published: daysAgo(3), application_end: daysAgo(-20) }));
  const closed = Array.from({ length: 30 }, (_, i) => ({ id: `closed-${i}`, title: "Closed", published: daysAgo(150 + i), application_end: daysAgo(100 + i) }));
  const updates = Array.from({ length: 20 }, (_, i) => ({ id: `upd-${i}`, title: "Result", type: "result", date: daysAgo(101 + i * 2) }));
  const roomy = B.fitToBudget([...open, ...closed], updates, 20000);
  assert.strictEqual(roomy.jobs.size + roomy.updates.size, 0);
  const tight = B.fitToBudget([...open, ...closed], updates, roomy.estimate - 25);
  assert.strictEqual(tight.jobs.size + tight.updates.size, 25);                 // each of these costs one file
  assert.ok(tight.estimate <= roomy.estimate - 25);
  assert.ok(![...tight.jobs].some((id) => id.startsWith("open-")), "an open job was archived");
  // oldest first: everything archived is older than everything kept
  const when = new Map([...closed.map((j) => [j.id, j.application_end]), ...updates.map((u) => [u.id, u.date])]);
  const gone = [...tight.jobs, ...tight.updates].map((id) => when.get(id)).sort();
  const kept = [...when].filter(([id]) => !tight.jobs.has(id) && !tight.updates.has(id)).map(([, d]) => d).sort();
  assert.ok(gone[gone.length - 1] <= kept[0], "a newer page was archived before an older one");
  // even an impossible limit never removes open jobs
  const impossible = B.fitToBudget([...open, ...closed], updates, 2100);
  assert.strictEqual(impossible.jobs.size, 30);
  assert.strictEqual(impossible.updates.size, 20);
});

test("state names count only as whole words", () => {
  const { statesOf } = require("../build.js");
  const st = (location, extra = {}) => statesOf({ id: "x", title: "X Recruitment 2026", organization: "X", location, ...extra }).map((s) => s.slug).join(",");
  assert.strictEqual(st("Visakhapatnam, Andhra Pradesh"), "andhra-pradesh", "'patna' inside Visakhapatnam is not Bihar");
  assert.strictEqual(st("College of Horticulture, Durgapura, Jaipur"), "rajasthan", "'durgapur' inside Durgapura is not West Bengal");
  assert.strictEqual(st("Evening Court, Lakhisarai"), "bihar", "'hisar' inside Lakhisarai is not Haryana");
  assert.strictEqual(st("Patna, Bihar"), "bihar");
  assert.strictEqual(st("Kota, Rajasthan"), "rajasthan");
});

test("qualification tags: 'be' is not B.E., a Postmaster or Headmaster post is not a master's degree", () => {
  const { qualsOf } = require("../build.js");
  const q = (qualification, title = "X Recruitment 2026") => qualsOf({ qualification, title }).map((x) => x.slug).join(",");
  assert.strictEqual(q("10th pass. Candidates must be residents of the district."), "10th-pass");
  assert.strictEqual(q("BE/B.Tech in Civil Engineering"), "engineering-diploma");
  assert.strictEqual(q("B.E. in Mechanical"), "engineering-diploma");
  assert.strictEqual(q("10th pass with Mathematics and English", "India Post GDS Branch Postmaster Recruitment 2026"), "10th-pass");
  assert.strictEqual(q("Graduation in any stream", "RRB Station Master Recruitment 2026"), "graduate");
  assert.strictEqual(q("Master's Degree in Economics"), "post-graduate");
  assert.strictEqual(q("M. Sc. in Chemistry"), "post-graduate");
  assert.strictEqual(q("Foreign Going Master's Certificate"), "");
});
