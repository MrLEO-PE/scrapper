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
import { draftEmail, emailCell } from "../src/export/email.ts";

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

test("refuses to write when the Principal is unknown", () => {
  const d = draftEmail({ ...complete, principal: null });
  assert.equal(d.body, "");
  assert.deepEqual(d.missing, ["principal name"]);
});

test("refuses to write when a hook is missing, and names which", () => {
  const noSchool = draftEmail({ ...complete, schoolHook: null });
  assert.equal(noSchool.body, "");
  assert.deepEqual(noSchool.missing, ["school fact"]);

  const noPe = draftEmail({ ...complete, peHook: null });
  assert.equal(noPe.body, "");
  assert.deepEqual(noPe.missing, ["PE/sport fact"]);

  const none = draftEmail({ role: "PE Teacher", school: "A School" });
  assert.deepEqual(none.missing, ["principal name", "school fact", "PE/sport fact"]);
});

test("the cell tells you what to go and find", () => {
  const cell = emailCell(draftEmail({ ...complete, principal: null, peHook: null }));
  assert.match(cell, /^NEEDS: principal name, PE\/sport fact/);
  assert.match(cell, /check the school's website/);
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

test("never leaves an unfilled placeholder in the text", () => {
  const d = draftEmail(complete);
  assert.doesNotMatch(d.body, /\{\w+\}/);
});

test("stays near the intended length", () => {
  const words = draftEmail(complete).body.split(/\s+/).length;
  // The model email is about 180 words; allow room for a longer school name.
  assert.ok(words > 120 && words < 260, `email was ${words} words`);
});
