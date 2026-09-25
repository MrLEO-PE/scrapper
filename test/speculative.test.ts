/**
 * The speculative letter — for a school that is not advertising.
 *
 * Most international appointments are made before a vacancy is published, so
 * this is arguably the more valuable of the two letters. It has less to work
 * with than a job application: no role to name, no advert to answer. What it
 * must never do is compensate by inventing, or by sending the same admiring
 * paragraph to five hundred schools.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { schoolFact, speculativeEmail } from "../src/export/email.ts";

test("uses a prose fact from the school's own pages when there is one", () => {
  const fact = schoolFact({
    school: "Tenby Setia Eco Park",
    schoolHook: "became the first school in Selangor to earn IPC accreditation",
  });
  assert.match(fact!, /first school in Selangor/);
});

test("falls back to facts we hold, which are real even if not prose", () => {
  // Only one school in ten has a prose hook, but far more have verified
  // structured detail. Using it takes the reachable set from 52 to 130.
  const fact = schoolFact({
    school: "Westview Cambodian International School",
    accreditation: "CIS, WASC",
    curriculum: ["American"],
    studentCount: 450,
  });
  assert.match(fact!, /accreditation with CIS and WASC/);
  assert.match(fact!, /American programme you run/);
  assert.match(fact!, /around 450 students/);
});

test("reads as a list, not as one run-on clause", () => {
  // "accreditation with CIS, WASC and the American programme" made the
  // programme sound like a third accrediting body.
  const fact = schoolFact({
    school: "A School",
    accreditation: "CIS, WASC",
    curriculum: ["American"],
  });
  assert.match(fact!, /CIS and WASC, and the American/);
});

test("says nothing when there is nothing true to say", () => {
  // A letter with no specific fact is a form letter, which is what this column
  // exists to avoid.
  assert.equal(schoolFact({ school: "A School" }), null);
  assert.equal(schoolFact({ school: "A School", curriculum: [], studentCount: null }), null);
  // A tiny roll is not a distinguishing fact worth opening a letter with.
  assert.equal(schoolFact({ school: "A School", studentCount: 30 }), null);
});

test("writes a complete letter with no role named", () => {
  const d = speculativeEmail({
    school: "Westview Cambodian International School",
    principal: "Ms Jane Doe",
    accreditation: "CIS, WASC",
    curriculum: ["American"],
  });
  assert.deepEqual(d.missing, []);
  assert.match(d.subject, /speculative enquiry/i);
  assert.match(d.body, /^Dear Ms Jane Doe and the HR Team,/);
  assert.match(d.body, /keep me in mind for future PE openings/);
  assert.match(d.body, /when a PE position next opens/);
  // It must not pretend to be answering an advert.
  assert.doesNotMatch(d.body, /position at .* I am writing to express my strong interest/);
  assert.doesNotMatch(d.body, /\{\w+\}/);
});

test("refuses to write when the school is a blank to us", () => {
  const d = speculativeEmail({ school: "A School" });
  assert.equal(d.body, "");
  assert.deepEqual(d.missing, ["something specific about the school"]);
});

test("leaves the head's name visibly open rather than blocking", () => {
  const d = speculativeEmail({ school: "A School", accreditation: "IB" });
  assert.ok(d.body);
  assert.match(d.body, /\[add the head's name — not published\]/);
});

test("mentions their sport only when something real was found", () => {
  const withPe = speculativeEmail({
    school: "A School", accreditation: "IB", peHook: "the Olympic-size swimming pool",
  });
  assert.match(withPe.body, /Olympic-size swimming pool/);

  const without = speculativeEmail({ school: "A School", accreditation: "IB" });
  assert.doesNotMatch(without.body, /I also like/);
  // And still says what I bring.
  assert.match(without.body, /I have taught PE since 2019/);
});
