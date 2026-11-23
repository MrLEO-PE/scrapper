/**
 * Edvectus.
 *
 * The board is read through its JSON search, so what is pinned here is the
 * mapping: the vacancy URL must match the board's own (ref number plus a slug
 * of the title, as its sitemap prints it), and a 0 in a salary field is the
 * board's blank, not a figure.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { salaryOf, toRawJob, wantedRoleIds } from "../src/sources/edvectus.ts";

const JOB = {
  jobId: 22203,
  jobRefNo: "J19678",
  jobTitle: "Teacher of PE (Physical Education) - KL, Malaysia - August 2027",
  startDate: "2027-08-01T00:00:00",
  createdOn: "2026-11-05T09:52:32.46",
  location: "Malaysia",
  jobCountryCode: "MY",
  ageRange: "Secondary/ Middle(12-15), Secondary/High(16-18)",
  currencysymbol: "MYR",
  minBasic: 15000,
  maxBasic: 20000,
  publishedJobDescription: "- Secondary Teacher of PE",
  housing: "",
  benefitsJOB: "",
};

test("builds the board's own vacancy URL", () => {
  const job = toRawJob(JOB)!;
  assert.equal(job.url, "https://app.edvectus.com/vacancies/J19678-teacher-of-pe-physical-education-kl-malaysia-august-2027");
  assert.equal(job.sourceJobId, "22203");
  assert.equal(job.country, "Malaysia");
  assert.deepEqual(job.gradeLevels, ["Secondary/ Middle(12-15)", "Secondary/High(16-18)"]);
  assert.equal(job.benefits, undefined);
});

test("takes country and city from 'Country - City', over a wrong country code", () => {
  const job = toRawJob({ ...JOB, location: "UAE - Dubai", jobCountryCode: "GB" })!;
  assert.equal(job.country, "UAE");
  assert.equal(job.city, "Dubai");
  assert.equal(toRawJob({ ...JOB, location: "", jobCountryCode: "MY" })!.country, "MY");
});

test("a zero salary is a blank, and no period is invented", () => {
  assert.deepEqual(salaryOf(JOB), { min: 15000, max: 20000, currency: "MYR" });
  assert.deepEqual(salaryOf({ ...JOB, maxBasic: 0 }), { min: 15000, currency: "MYR" });
  assert.equal(salaryOf({ ...JOB, minBasic: 0, maxBasic: 0 }), undefined);
});

test("asks for PE roles and subject-leadership roles only", () => {
  const ids = wantedRoleIds([
    { category: "Secondary", selectListItems: [{ text: "Physical Education", value: "203" }, { text: "Maths", value: "1" }] },
    {
      category: "Leadership - Secondary",
      selectListItems: [
        { text: "Head of Department-Secondary/ Middle / High School", value: "300" },
        { text: "Head of Year-Secondary", value: "301" },
      ],
    },
  ]);
  assert.deepEqual(ids, ["203", "300"]);
});
