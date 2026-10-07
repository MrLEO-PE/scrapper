/**
 * The application letter, held to Leo_Sevin_Cover_Letter_Model_and_Method.pdf.
 *
 * The rules under test are the sheet's own: structure in the model's order,
 * nothing about the school that was not found, nothing about me that is not in
 * config/profile.json, and every gap flagged beside the letter, never in it.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { draftEmail, emailCell, startClash, tidyRole } from "../src/export/email.ts";

const complete = {
  role: "Secondary PE Teacher",
  school: "Harbour Pine International School",
  principal: "Ms Anna Reyes",
  peHook: "a self-review at the end of each unit",
  advertText: "Cambridge IGCSE PE. Start August 2027.",
  curriculum: ["Cambridge"],
};

test("follows the model's order and wording of subject, greeting and opening", () => {
  const d = draftEmail(complete);
  assert.equal(d.subject, "LEO SEVIN - Application Secondary PE Teacher");
  const lines = d.body.split("\n");
  assert.equal(lines[0], "Dear Principal Anna Reyes and the HR Team,");
  assert.match(lines[2]!, /^I am applying for the Secondary PE Teacher position at Harbour Pine International School\. /);
  assert.match(lines[2]!, /8 years of experience/);
  assert.match(d.body, /I noticed a self-review at the end of each unit\./);
  assert.match(d.body, /Here is what I would bring:/);
  assert.match(d.body, /My contract ends in July 2027, so I can start in August 2027\./);
  assert.match(d.body, /Kind regards,\nLeo SEVIN$/);
});

test("no name found means the generic greeting, never a placeholder", () => {
  const d = draftEmail({ ...complete, principal: null });
  assert.match(d.body, /^Dear Principal and the HR Team,/);
  assert.doesNotMatch(d.body, /add the head|\[|\{\w+\}/);
});

test("the honorific is dropped: the salutation is Principal", () => {
  assert.match(draftEmail({ ...complete, principal: "Dr Myles Jackson" }).body, /^Dear Principal Myles Jackson and the HR Team,/);
});

test("no fact about the school: the letter is still written, and says so in its flags", () => {
  const d = draftEmail({ ...complete, peHook: null, schoolHook: null });
  assert.ok(d.body);
  assert.doesNotMatch(d.body, /I noticed/);
  assert.ok(d.flags.some((f) => /no specific fact/.test(f)));
});

test("a flag is never written into the letter", () => {
  const d = draftEmail({ ...complete, advertText: "Start January 2027. IB MYP required." });
  assert.ok(d.flags.length >= 2);
  for (const f of d.flags) assert.ok(!d.body.includes(f));
});

test("flags a start date earlier than my availability", () => {
  assert.match(startClash("The post starts in January 2027.", "2027-08")!, /January 2027/);
  assert.match(startClash("Join us ASAP.", "2027-08")!, /immediate/);
  assert.equal(startClash("Start August 2027.", "2027-08"), null);
  assert.equal(startClash("Start September 2028.", "2027-08"), null);
  assert.equal(startClash("No date given.", "2027-08"), null);
});

test("flags what the advert asks for that my profile does not hold", () => {
  const d = draftEmail({ ...complete, advertText: "IB MYP experience essential." });
  assert.ok(d.flags.some((f) => /IB MYP/.test(f)));
});

test("never claims what the profile does not: no PYP, MYP, football or swimming certificate", () => {
  const d = draftEmail({ ...complete, advertText: "PYP MYP football swimming skiing" });
  assert.doesNotMatch(d.body, /PYP|MYP|football|skiing|swimming/i);
});

test("the IGCSE tools bullet appears only when IGCSE or Cambridge is relevant", () => {
  assert.match(draftEmail(complete).body, /IGCSE tools\./);
  const plain = draftEmail({ ...complete, advertText: "Whole school PE.", curriculum: ["American"], peHook: "the sports hall" });
  assert.doesNotMatch(plain.body, /IGCSE tools\./);
  assert.match(plain.body, /PE assessment\./);
  assert.match(plain.body, /Programme and events\./);
});

test("the cell is the letter itself", () => {
  const d = draftEmail(complete);
  assert.equal(emailCell(d, "https://x.example"), d.body);
});

test("tidies a shouted job title without mangling its acronyms", () => {
  assert.equal(
    tidyRole("PHYSICAL EDUCATION TEACHER - SNA IB HCMC - SCHOOL YEAR 2027-2028"),
    "Physical Education Teacher - SNA IB HCMC - School Year 2027-2028",
  );
  assert.equal(tidyRole("HEAD OF PE"), "Head of PE");
  assert.equal(tidyRole("MYP/DP PHYSICAL EDUCATION TEACHER"), "MYP/DP Physical Education Teacher");
  for (const asWritten of ["Head of Physical Education (IGCSE)", "Teacher of PE and Games", "Director of Sport"]) {
    assert.equal(tidyRole(asWritten), asWritten);
  }
});

test("the letter and subject use the tidied title", () => {
  const d = draftEmail({ ...complete, role: "PE TEACHER - SECONDARY" });
  assert.equal(d.subject, "LEO SEVIN - Application PE Teacher - Secondary");
  assert.match(d.body, /PE Teacher - Secondary position/);
  assert.doesNotMatch(d.body, /PE TEACHER - SECONDARY/);
});

test("never leaves an unfilled placeholder in the text", () => {
  assert.doesNotMatch(draftEmail(complete).body, /\{\w+\}/);
});

test("the website is written once, as a plain link with no trailing full stop", () => {
  const body = draftEmail(complete).body;
  assert.equal((body.match(/https:\/\/mrleo-pe\.github\.io\/CV\//g) ?? []).length, 1);
  assert.doesNotMatch(body, /CV\/\./);
});
