import { test } from "node:test";
import assert from "node:assert/strict";
import { briefText } from "../src/export/emailtab.ts";
import type { Recipient } from "../src/export/recipients.ts";

const base = {
  email: "recruiter@klschool.org",
  tier: "careers",
  schools: [{ name: "KL International School" }],
  factQuality: "none",
  flags: ["no specific fact found for this school — add one from their own site before sending"],
  missing: [],
  others: [],
  form: undefined,
  applications: [],
  skippedCount: 0,
  lastSent: undefined,
  skipped: undefined,
  brief: { website: null, careersPage: null, curriculum: [], jobs: [], principal: null, schoolFact: null, peFact: null },
} as unknown as Recipient;

test("the brief opens with exactly the lines that were being pasted by hand", () => {
  const text = briefText(base, "China · Chongqing · rank 83 of 436 · tuition fees (pay proxy)");
  assert.equal(
    text.split("\n").slice(0, 7).join("\n"),
    [
      "recruiter@klschool.org careers inbox no fact found",
      "",
      "KL International School",
      "",
      "China · Chongqing · rank 83 of 436 · tuition fees (pay proxy)",
      "",
      "check: no specific fact found for this school — add one from their own site before sending",
    ].join("\n"),
  );
});

test("without an advertised role it says so, and never invents a job", () => {
  assert.match(briefText(base, "x"), /Job: PE Teacher \(no advertised role/);
});

test("the extras appear only when they exist", () => {
  const rich = {
    ...base,
    others: [{ email: "hr@klschool.org", kind: "hr", score: 0.9 }],
    form: { kind: "word", url: "https://klschool.org/form.docx", school: "KL" },
    brief: { ...base.brief, website: "https://klschool.org", jobs: [{ title: "PE Teacher", url: "https://x/y", deadline: null, school: "KL" }], principal: "A B (confirmed on the school's own page)" },
  } as unknown as Recipient;
  const text = briefText(rich, "x");
  assert.match(text, /Website: https:\/\/klschool\.org/);
  assert.match(text, /Principal: A B \(confirmed/);
  assert.match(text, /Other addresses on file: hr@klschool\.org \(hr\)/);
  assert.match(text, /Application form to fill in: Word document — https:\/\/klschool\.org\/form\.docx/);
  assert.match(text, /Job: PE Teacher — https:\/\/x\/y/);
  assert.doesNotMatch(briefText(base, "x"), /Website:|Principal:|Other addresses|Application form/);
});

import { EMAIL_TAB_SCRIPT, EMAIL_TAB_CSS } from "../src/export/emailtab.ts";

test("the Email tab's script is valid JavaScript once it is written into the page", () => {
  // A backslash lost inside a template literal once broke every button and filter on the tab at once.
  assert.doesNotThrow(() => new Function(EMAIL_TAB_SCRIPT));
  assert.ok(EMAIL_TAB_SCRIPT.includes("function copyFormatted"));
  assert.ok(EMAIL_TAB_CSS.length > 100);
});
