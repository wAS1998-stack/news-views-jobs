// node --test: the Indexing API plan (ping-google.js) — order, daily budget, changed pages, retired URLs.
const test = require("node:test");
const assert = require("node:assert");
const { plan, hashOf } = require("../ping-google.js");

const U = (id) => `https://news-views.in/jobs/${id}/`;
const job = (id, extra = {}) => ({ id, title: `${id} Recruitment 2099`, organization: "X Board", application_end: "2099-12-31", published: "2099-01-01", total_vacancies: 10, ...extra });

test("new jobs first, then changed ones, then the backlog (biggest first), then retired URLs", () => {
  const changed = job("changed");
  const jobs = [job("new1"), changed, job("small", { total_vacancies: 5 }), job("big", { total_vacancies: 900 }), job("sent")];
  const state = { [U("changed")]: { hash: "old" }, [U("sent")]: { hash: hashOf(job("sent")) }, [U("gone")]: { hash: "h" } };
  const { todo } = plan({ jobs, redirects: [["/jobs/gone/", "/jobs/"]], state, newUrls: [U("new1")], today: "2099-06-01", budget: 50, drainLeft: 10 });
  assert.deepStrictEqual(todo.map((x) => `${x.type === "URL_DELETED" ? "D" : "U"} ${x.url.split("/")[4]}`), ["U new1", "U changed", "U big", "U small", "D gone"]);
});

test("the budget is respected and new URLs that do not fit are deferred, not lost", () => {
  const jobs = [job("a"), job("b"), job("c")];
  const { todo, deferred } = plan({ jobs, redirects: [], state: {}, newUrls: [U("a"), U("b"), U("c")], today: "2099-06-01", budget: 2, drainLeft: 0 });
  assert.strictEqual(todo.length, 2);
  assert.deepStrictEqual(deferred, [U("c")]);
});

test("closed or nearly closed jobs are not drained", () => {
  const jobs = [job("closing", { application_end: "2099-06-03" }), job("closed", { application_end: "2099-05-01" })];
  const { todo } = plan({ jobs, redirects: [], state: {}, newUrls: [], today: "2099-06-01", budget: 50, drainLeft: 50 });
  assert.strictEqual(todo.length, 0);
});
