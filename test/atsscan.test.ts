/**
 * The hiring-system scan: which accounts a school's page links to.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { atsLinks } from "../src/atsscan.ts";

test("names the account behind each hiring-system link", () => {
  const html = `<a href="https://esf.wd102.myworkdayjobs.com/en-US/ESF">Jobs</a>
    <a href="https://apply.workable.com/elevate-7/">Workable</a>
    <a href="https://jobs.lever.co/gess/abc">Lever</a>
    <iframe src="https://boards.greenhouse.io/embed/job_board?for=someschool"></iframe>
    <a href="https://greenschool.bamboohr.com/careers">BambooHR</a>
    <a href="https://jobs.smartrecruiters.com/AcmeSchool1">SR</a>`;
  assert.deepEqual(atsLinks(html), [
    { system: "workday", account: "esf/ESF" },
    { system: "workable", account: "elevate-7" },
    { system: "lever", account: "gess" },
    { system: "greenhouse", account: "someschool" },
    { system: "bamboohr", account: "greenschool" },
    { system: "smartrecruiters", account: "AcmeSchool1" },
  ]);
});

test("ignores the systems' own pages and repeats", () => {
  assert.deepEqual(atsLinks(`<a href="https://www.bamboohr.com">x</a><a href="https://apply.workable.com/j/ABC">y</a>`), []);
  assert.equal(atsLinks(`jobs.lever.co/gess jobs.lever.co/gess/1`).length, 1);
});
