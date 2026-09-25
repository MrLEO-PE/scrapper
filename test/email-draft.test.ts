/**
 * The prepared application email.
 *
 * One rule governs this feature: nothing may be invented. A plausible but wrong
 * Principal's name, or praise for a facility the school does not have, is worse
 * than a blank — it is the kind of mistake that ends an application. So the
 * tests that matter most are the ones proving it refuses to write.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { draftEmail, emailCell, tidyRole } from "../src/export/email.ts";

const complete = {
  role: "PE Teacher",
  school: "Crescendo-HELP International School",
  principal: "Mr Myles Jackson",
  schoolHook: "became the first school in Johor Bahru to earn IPC accreditation",
  peHook: "your co-curricular sport programme across every age group",
};

test("writes the email when every detail is real", () => {
  const d = draftEmail(complete);
  assert.deepEqual(d.missing, []);
  assert.match(d.subject, /^Application for PE Teacher, /);
  assert.match(d.body, /^Dear Mr Myles Jackson and the HR Team,/);
  assert.match(d.body, /first school in Johor Bahru/);
  assert.match(d.body, /co-curricular sport programme/);
  assert.match(d.body, /Crescendo-HELP International School/);
  assert.match(d.body, /Kind regards,/);
});

test("still writes when the head's name is unpublished, leaving the gap visible", () => {
  // Only about one school in fourteen publishes the head's name. Blocking on
  // it threw away every otherwise-complete draft, and a salutation is not a
  // claim about the school — so the letter is written with the gap open in the
  // greeting, where it cannot be missed or sent by accident.
  const d = draftEmail({ ...complete, principal: null });
  assert.ok(d.body, "the letter should still be written");
  assert.match(d.body, /^Dear \[add the head's name — not published\] and the HR Team,/);
  assert.deepEqual(d.missing, []);
  // Everything that is a claim about the school is still real.
  assert.match(d.body, /Crescendo-HELP International School/);
});

test("refuses to write when a hook is missing, and names which", () => {
  // The hooks are the substance: they are why the letter reads as written for
  // this school. Without one there is nothing worth sending.
  const noSchool = draftEmail({ ...complete, schoolHook: null });
  assert.equal(noSchool.body, "");
  assert.deepEqual(noSchool.missing, ["school fact"]);

  const noPe = draftEmail({ ...complete, peHook: null });
  assert.equal(noPe.body, "");
  assert.deepEqual(noPe.missing, ["PE/sport fact"]);

  // When it cannot write at all, the missing name is listed too, so the cell
  // names everything still to find.
  const none = draftEmail({ role: "PE Teacher", school: "A School" });
  assert.deepEqual(none.missing, ["school fact", "PE/sport fact", "principal name"]);
});

test("the cell tells you what to go and find", () => {
  const cell = emailCell(draftEmail({ ...complete, schoolHook: null, peHook: null }));
  assert.match(cell, /^NEEDS: school fact, PE\/sport fact/);
  assert.match(cell, /school's website/);
});

test("the cell names the website, since that is where the answers are", () => {
  // Saying a detail is missing is only half the job. The website is the one
  // place all three details can be found, so an incomplete draft points at it
  // and becomes a two-minute task instead of a dead end.
  const cell = emailCell(
    draftEmail({ ...complete, schoolHook: null, peHook: null }),
    "https://www.aisdhaka.org",
  );
  assert.match(cell, /https:\/\/www\.aisdhaka\.org/);

  // No website known: still say what is missing, just without a dead link.
  const bare = emailCell(draftEmail({ ...complete, schoolHook: null }), null);
  assert.match(bare, /^NEEDS: school fact/);
  assert.doesNotMatch(bare, /https?:/);
});

test("a complete email is never replaced by the website prompt", () => {
  const cell = emailCell(draftEmail(complete), "https://www.aisdhaka.org");
  assert.doesNotMatch(cell, /^NEEDS/);
  assert.doesNotMatch(cell, /aisdhaka/);
});

test("matches what I bring to what their PE page talks about", () => {
  const swimming = draftEmail({ ...complete, peHook: "the Olympic-size swimming pool" });
  assert.match(swimming.body, /swim and fitness tracker/);

  const fitness = draftEmail({ ...complete, peHook: "the fitness suite and athletics track" });
  assert.match(fitness.body, /bleep test tracker/);

  // Something the profile has no specific answer for falls back.
  const other = draftEmail({ ...complete, peHook: "the dance studio" });
  assert.match(other.body, /I have taught PE since 2019/);
});

test("tidies a shouted job title without mangling its acronyms", () => {
  // Real title from the board. Pasted verbatim into a formal application it
  // reads as careless, which defeats the point of personalising it.
  assert.equal(
    tidyRole("PHYSICAL EDUCATION TEACHER - SNA IB HCMC - SCHOOL YEAR 2027-2028"),
    "Physical Education Teacher - SNA IB HCMC - School Year 2027-2028",
  );
  assert.equal(tidyRole("HEAD OF PE"), "Head of PE");
  assert.equal(tidyRole("MYP/DP PHYSICAL EDUCATION TEACHER"), "MYP/DP Physical Education Teacher");

  // A title the school already wrote properly is left exactly alone, including
  // its own deliberate capitals.
  for (const asWritten of [
    "Head of Physical Education (IGCSE)",
    "Teacher of PE and Games",
    "Director of Sport",
  ]) {
    assert.equal(tidyRole(asWritten), asWritten);
  }
});

test("the letter and subject use the tidied title", () => {
  const d = draftEmail({ ...complete, role: "PE TEACHER - SECONDARY" });
  assert.match(d.subject, /^Application for PE Teacher - Secondary, /);
  assert.match(d.body, /PE Teacher - Secondary position/);
  assert.doesNotMatch(d.body, /PE TEACHER - SECONDARY/);
});

test("never leaves an unfilled placeholder in the text", () => {
  const d = draftEmail(complete);
  assert.doesNotMatch(d.body, /\{\w+\}/);
});

test("stays near the intended length", () => {
  const words = draftEmail(complete).body.split(/\s+/).length;
  // The model email is about 180 words; allow room for a longer school name.
  assert.ok(words > 120 && words < 260, `email was ${words} words`);
});
