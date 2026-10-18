import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEmail } from "../src/enrich/email.ts";

const score = (e: string) => classifyEmail(e, "", "html").score;
const kind = (e: string) => classifyEmail(e, "", "html").kind;

test("an address that says recruitment outranks a run-on of several desks that merely starts with hr", () => {
  assert.ok(score("ism-recruit@s.edu") > score("hradmissionsadminassistant@s.edu"));
  assert.ok(score("recruitment@s.edu") > score("hrmanager@s.edu"));
});

test("hr@, hr.name@ and hr-team@ are HR; a longer word that begins with hr is weaker, not nothing", () => {
  assert.equal(kind("hr@s.edu"), "hr");
  assert.equal(kind("hr.recruitment@s.edu") === "hr" || kind("hr.recruitment@s.edu") === "careers", true);
  assert.equal(kind("hr-team@s.edu"), "hr");
  assert.equal(kind("hrmanager@s.edu"), "hr");
  assert.ok(score("hr@s.edu") > score("hrmanager@s.edu"));
});

test("HR and recruitment addresses outrank admissions, info and anonymous ones", () => {
  for (const hiring of ["recruitment@s.edu", "hr@s.edu", "careers@s.edu"]) {
    for (const other of ["admissions@s.edu", "info@s.edu", "office@s.edu", "john.smith@s.edu"]) {
      assert.ok(score(hiring) > score(other), `${hiring} should outrank ${other}`);
    }
  }
});

test("a student careers adviser is not a hiring address", () => {
  assert.notEqual(kind("careers.counsellor@s.edu"), "careers");
});
