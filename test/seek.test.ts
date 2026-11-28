/**
 * JobsDB / SEEK: results embedded in a keyword search page.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { jobsFrom, SITES, toRawJob, type SeekJob } from "../src/sources/seek.ts";

const HK = SITES.find((s) => s.host === "hk.jobsdb.com")!;

const JOB: SeekJob = {
  id: "96144092",
  title: "Teacher of PE  (Netball Specialist)",
  companyName: "Malvern College Hong Kong Limited",
  classifications: [{ classification: { id: "6123", description: "Education & Training" } }],
  locations: [{ label: "Tai Po, Tai Po District" }],
  listingDate: "2026-11-24T05:47:14.000Z",
  salaryLabel: "",
  teaser: "Teach PE and lead netball.",
  bulletPoints: ["Boarding school"],
  workTypes: ["Full time"],
};

test("reads the results embedded in a search page", () => {
  const html = `<script>window.SEEK_REDUX_DATA = ${JSON.stringify({ results: { totalCount: 319, results: { jobs: [JOB] } } })};\n</script>`;
  assert.deepEqual(jobsFrom(html), { jobs: [JOB], total: 319 });
  assert.equal(jobsFrom("<html></html>"), null);
});

test("turns a school's result into a vacancy", () => {
  const job = toRawJob(HK, JOB)!;
  assert.equal(job.title, "Teacher of PE (Netball Specialist)");
  assert.equal(job.schoolName, "Malvern College Hong Kong Limited");
  assert.equal(job.country, "Hong Kong");
  assert.equal(job.city, "Tai Po, Tai Po District");
  assert.equal(job.url, "https://hk.jobsdb.com/job/96144092");
  assert.equal(job.description, "Teach PE and lead netball.\nBoarding school");
  assert.equal(job.salary, undefined);
});

test("keeps a school filed outside education, drops a gym", () => {
  const sport = [{ classification: { id: "6246", description: "Sport & Recreation" } }];
  assert.ok(toRawJob(HK, { ...JOB, companyName: "Canberra Girls Grammar School", classifications: sport }));
  assert.equal(toRawJob(HK, { ...JOB, companyName: "Strength Central Pte Limited", classifications: sport }), null);
});

test("uses the advertiser when the company name is missing, and keeps a stated salary", () => {
  const job = toRawJob(HK, { ...JOB, companyName: undefined, advertiser: { description: "Kowloon School" }, salaryLabel: "$28,790 per month" })!;
  assert.equal(job.schoolName, "Kowloon School");
  assert.deepEqual(job.salary, { text: "$28,790 per month" });
});
