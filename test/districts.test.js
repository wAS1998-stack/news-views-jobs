"use strict";
const test = require("node:test");
const assert = require("node:assert");
const D = require("../districts.js");

test("districtState: a district names its state, ambiguous or common-word names don't", () => {
  assert.strictEqual(D.districtState("Zilla Panchayat, Dharwad"), "karnataka");
  assert.strictEqual(D.districtState("DHFWS Purba Medinipur"), "west-bengal");
  assert.strictEqual(D.districtState("Unnao District Court"), "uttar-pradesh");
  assert.strictEqual(D.districtState("Collector, Chhota Udaipur"), "gujarat");
  assert.strictEqual(D.districtState("Dharwad and Unnao"), "");          // two states: no guess
  assert.strictEqual(D.districtState("Sidhi Bharti 2026"), "");          // "direct recruitment", not the MP district
  assert.strictEqual(D.districtState("Bank of Baroda Manager"), "");     // a national bank, not Vadodara
  assert.strictEqual(D.districtState("Aurangabad Municipal Corporation"), ""); // Bihar and Maharashtra
  assert.strictEqual(D._shared.size, 0, "a district listed under two states: " + [...D._shared].join(", "));
});

test("domainState: state-government and district web addresses", () => {
  assert.strictEqual(D.domainState("https://bhadrak.odisha.gov.in/en/notice"), "odisha");
  assert.strictEqual(D.domainState("https://vijayapura.dcourts.gov.in/"), "karnataka");
  assert.strictEqual(D.domainState("https://cmd.kerala.gov.in/"), "kerala");
  assert.strictEqual(D.domainState("https://dharwad.nic.in/en/"), "karnataka");
  assert.strictEqual(D.domainState("https://upsc.gov.in/"), "");
  assert.strictEqual(D.domainState("not a url"), "");
});
