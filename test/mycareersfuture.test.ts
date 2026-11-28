/**
 * MyCareersFuture: Singapore's government jobs portal, schools only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isSchool, tidyName, toRawJob, type McfJob } from "../src/sources/mycareersfuture.ts";

const JOB: McfJob = {
  uuid: "3556f3e6c598188ccbf39aef0404511a",
  title: "Physical Education and Sports Teacher",
  description: "<p>Dulwich College Singapore seeks a PE teacher.</p>",
  postedCompany: { name: "DULWICH COLLEGE (SINGAPORE) PTE. LTD.", ssicCode: "85230", companyUrl: "https://singapore.dulwich.org" },
  hiringCompany: null,
  salary: { minimum: 5600, maximum: 7500, type: { salaryType: "Monthly" } },
  employmentTypes: [{ employmentType: "Permanent" }],
  metadata: {
    newPostingDate: "2026-10-29",
    expiryDate: "2026-11-28",
    jobDetailsUrl: "https://www.mycareersfuture.gov.sg/job/education-training/physical-education-sports-teacher-dulwich-college-3556f3e6c598188ccbf39aef0404511a",
  },
};

test("reads a school's post with its salary", () => {
  const job = toRawJob(JOB)!;
  assert.equal(job.schoolName, "Dulwich College (Singapore)");
  assert.equal(job.country, "Singapore");
  assert.deepEqual(job.salary, { min: 5600, max: 7500, currency: "SGD", period: "MONTHLY" });
  assert.equal(job.deadlineAt, "2026-11-28");
  assert.equal(job.description, "Dulwich College Singapore seeks a PE teacher.");
});

test("drops employers that are not schools", () => {
  assert.equal(toRawJob({ ...JOB, postedCompany: { name: "SWIM IT RIGHT PTE. LTD.", ssicCode: "85407" } }), null);
});

test("names the school, not the agency, when an agency posts for it", () => {
  const job = toRawJob({ ...JOB, postedCompany: { name: "DIS MANPOWER PTE. LTD.", ssicCode: "78104" }, hiringCompany: { name: "XCL WORLD ACADEMY PTE. LTD.", ssicCode: "85230" } })!;
  assert.equal(job.schoolName, "XCL World Academy");
});

test("tidies company names", () => {
  assert.equal(tidyName("DOVER COURT INTERNATIONAL SCHOOL (PTE.) LTD."), "Dover Court International School");
  assert.equal(tidyName("ANGLO-CHINESE SCHOOL (INDEPENDENT)"), "Anglo-Chinese School (Independent)");
  assert.equal(tidyName("NUS HIGH SCHOOL OF MATHEMATICS AND SCIENCE"), "NUS High School of Mathematics and Science");
  assert.equal(tidyName("Rainbow Centre, Singapore"), "Rainbow Centre, Singapore");
});

test("keeps a school with no industry code, not a swim school", () => {
  assert.equal(isSchool({ name: "THE PERSE SCHOOL (SINGAPORE) PTE. LTD.", ssicCode: undefined }), true);
  assert.equal(isSchool({ name: "GERMAN EUROPEAN SCHOOL SINGAPORE", ssicCode: "85499" }), true);
  assert.equal(isSchool({ name: "LITTLE SPLASHES SWIM SCHOOL PTE. LTD.", ssicCode: "85407" }), false);
  assert.equal(isSchool({ name: "SUPA ATHLETICS PTE. LTD." }), false);
  assert.equal(isSchool({ name: "DIS MANPOWER PTE. LTD.", ssicCode: "78104" }), false);
});
