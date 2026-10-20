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
  assert.equal(d.subject, "Leo Sevin — Application: PE Teacher — Harbour Pine International School");
  // The instructions: say it is an application for a PE position, then who I am.
  assert.match(d.body, /I am applying for a PE position at Harbour Pine International School\. I am a PE teacher with 8 years/);
  assert.match(d.body, /I noticed the 25 metre pool\./);
  assert.doesNotMatch(d.body, /writing speculatively|keep me in mind/);
});

test("a school fact is used only when one is held; accreditation and roll are never said back", () => {
  const d = speculativeEmail({
    school: "Harbour Pine International School",
    accreditation: "CIS, WASC",
    curriculum: ["IB", "American"],
    studentCount: 1200,
  });
  assert.doesNotMatch(d.body, /CIS|WASC|1,?200|accredit/);
  assert.match(d.body, /take responsibility for their own progress/);
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

// --- the new letter standard ---------------------------------------------------

import { buildLetter, themeOf } from "../src/export/email.ts";

test("the formatted version bolds the keywords and the plain version has no markers", () => {
  const d = speculativeEmail({ school: "Harbour Pine", peHook: "the 25 metre pool" });
  assert.doesNotMatch(d.body, /\*\*/);
  for (const bold of ["8 years of experience", "PE coordination", "Cambridge IGCSE PE", "WHAT I WOULD BRING", "Holistic assessment.", "Online tools.", "4 years as PE coordinator", "5 core skills holistic assessment with levels 1 to 4", "August 2027"]) {
    assert.ok(d.marked.includes(`**${bold}**`), `${bold} should be bold`);
  }
  assert.equal(d.marked.replace(/\*\*/g, ""), d.body);
});

test("the line after a school's own fact answers in kind: innovation, responsibility, holistic, understanding", () => {
  assert.equal(themeOf("labs opened to primary students"), "innovation");
  assert.equal(themeOf("students take responsibility for their learning"), "responsibility");
  assert.equal(themeOf("a holistic, whole-child approach"), "holistic");
  assert.equal(themeOf("conceptual understanding and inquiry"), "understanding");
  assert.equal(themeOf("a 25 metre pool"), null);
  const d = buildLetter({ schools: ["X"], peHook: "labs opened to primary students" });
  assert.match(d.body, /I noticed labs opened to primary students\. I bring that spirit to PE/);
});

test("the letter is signed in full and the website is one link", () => {
  const d = speculativeEmail({ school: "X", peHook: "the sports hall" });
  assert.match(d.body, /Kind regards,\nLeo SEVIN\nCoordinator and Physical Education Teacher$/);
  assert.equal((d.body.match(/my website: https:\/\/mrleo-pe\.github\.io\/CV\//g) ?? []).length, 1);
});

test("a group letter says PE positions, not a speculative introduction", () => {
  const d = groupSpeculativeEmail({ schools: ["A School", "B School"] });
  assert.match(d.body, /I am applying for PE positions across your schools: A School and B School\./);
});

test("a fact that was cut off mid-sentence is left out, and flagged, not said back", () => {
  const d = speculativeEmail({ school: "X", peHook: "your sports programme covering rugby or hockey, having taught Physical Education as" });
  assert.doesNotMatch(d.body, /I noticed/);
  assert.ok(d.flags.some((f) => /cut off/.test(f)));
  const fine = speculativeEmail({ school: "X", peHook: "your sports programme covering rugby and hockey" });
  assert.match(fine.body, /I noticed your sports programme covering rugby and hockey\./);
});

test("a value the school states leads, in the school's own words, ahead of a facility", () => {
  const d = speculativeEmail({ school: "Harbour Pine", peHook: "the sports hall", schoolHook: "states its values as \u201ccaring, responsible global citizens\u201d" });
  assert.match(d.body, /I was drawn to your values: \u201ccaring, responsible global citizens\u201d\./);
  assert.doesNotMatch(d.body, /I noticed the sports hall/);
});
