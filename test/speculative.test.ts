/**
 * The letter to a school that is not advertising, and the one to a shared
 * inbox. Same model, same rules: nothing is said about a school that was not
 * found, and a missing fact is flagged rather than invented.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { groupSpeculativeEmail, schoolFact, speculativeEmail } from "../src/export/email.ts";

test("opens with the speculative line, then who I am, with no role named", () => {
  const d = speculativeEmail({ school: "Harbour Pine International School", peHook: "the 25 metre pool" });
  assert.equal(d.subject, "LEO SEVIN - Speculative application, PE Teacher");
  assert.match(d.body, /introduce myself as a Physical Education teacher/);
  assert.match(d.body, /Harbour Pine International School\. I am a PE teacher with 8 years/);
  assert.match(d.body, /I noticed the 25 metre pool\./);
  assert.doesNotMatch(d.body, /position at/);
});

test("a school fact is used only when one is held; accreditation and roll are never said back", () => {
  const d = speculativeEmail({
    school: "Harbour Pine International School",
    accreditation: "CIS, WASC",
    curriculum: ["IB", "American"],
    studentCount: 1200,
  });
  assert.doesNotMatch(d.body, /CIS|WASC|1,?200|accredit/);
  assert.ok(d.flags.some((f) => /no specific fact/.test(f)));
  assert.ok(d.body, "the letter is still written");
});

test("a PE fact comes before a general school fact", () => {
  const d = speculativeEmail({ school: "Harbour Pine", peHook: "the sports hall", schoolHook: "was founded in 1974" });
  assert.match(d.body, /I noticed the sports hall\./);
  assert.doesNotMatch(d.body, /founded in 1974/);
});

test("a general school fact is said plainly, as a fact", () => {
  const d = speculativeEmail({ school: "Harbour Pine", schoolHook: "was founded in 1974" });
  assert.match(d.body, /Harbour Pine was founded in 1974\./);
});

test("leaves out the head's name rather than leaving a gap", () => {
  const d = speculativeEmail({ school: "Harbour Pine", peHook: "the sports hall" });
  assert.match(d.body, /^Dear Principal and the HR Team,/);
  assert.doesNotMatch(d.body, /\[|add the head/);
});

test("a shared inbox gets one letter that is specific to none of its schools", () => {
  const d = groupSpeculativeEmail({ schools: ["BASIS Shenzhen", "BASIS Chengdu", "BASIS Beijing"] });
  assert.match(d.body, /^Dear HR Team,/);
  assert.match(d.body, /BASIS Shenzhen, BASIS Chengdu and BASIS Beijing/);
  assert.doesNotMatch(d.body, /I noticed/);
  assert.equal(groupSpeculativeEmail({ schools: ["Only One"] }).body, "");
});

test("schoolFact reports whether anything verified is held, without being used as a hook", () => {
  assert.equal(schoolFact({ school: "X" }), null);
  assert.match(schoolFact({ school: "X", accreditation: "CIS, WASC" })!, /accredited by CIS and WASC/);
  assert.equal(schoolFact({ school: "X", schoolHook: "was founded in 1974" }), "X was founded in 1974");
});
