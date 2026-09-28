/**
 * Teaching Nomad.
 *
 * Worth reading despite being small, because it states pay and the three
 * benefits that decide what an international package is actually worth. Those
 * are the fields almost no board publishes and the ones the ranking needs.
 *
 * The vacancies arrive inside a React Flight payload, which is not valid JSON
 * as a whole, so each object has to be found by its shape and parsed alone.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extractJobs, readFlight, toRawJob } from "../src/sources/teachingnomad.ts";

const chunk = (s: string) => `self.__next_f.push([1,${JSON.stringify(s)}])`;

const JOB = {
  id: "e95d4cee",
  slug: "elementary-homeroom-teacher",
  title: "Elementary Homeroom Teacher",
  country: "TH",
  city: "Bangkok",
  subject: ["Physical Education"],
  gradeLevels: ["K-5 / Primary"],
  curriculum: ["IB"],
  startDate: "2027-01-04",
  postedAt: "2026-09-25T16:57:47.708+00:00",
  salaryMinUsdCents: 324000,
  salaryMaxUsdCents: 378000,
  salaryDisplay: "12,500-21,000 AED per month",
  housingProvided: true,
  flightsProvided: true,
  visaSponsorshipProvided: false,
  employer: { name: "A School in Bangkok" },
};

test("reassembles a payload split across chunks with escaped quotes", () => {
  const html = `<script>${chunk('a:["x",{"na')}</script><script>${chunk('me":"a \\"quoted\\" bit"}]')}</script>`;
  assert.equal(readFlight(html), 'a:["x",{"name":"a \\"quoted\\" bit"}]');
  assert.equal(readFlight("<html>nothing here</html>"), "");
});

test("finds a vacancy embedded in surrounding stream noise", () => {
  const flight = `3:["$","div",null,{"children":[${JSON.stringify(JOB)}]}]`;
  const jobs = extractJobs(flight);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.title, "Elementary Homeroom Teacher");
});

test("never lists the same vacancy twice", () => {
  const flight = JSON.stringify(JOB) + " padding " + JSON.stringify(JOB);
  assert.equal(extractJobs(flight).length, 1);
});

test("ignores a fragment that is not a whole object", () => {
  assert.deepEqual(extractJobs('{"slug":"half-an-object","title":"Truncated'), []);
  assert.deepEqual(extractJobs(""), []);
});

test("converts cents a year into a salary, and keeps the board's own wording", () => {
  const job = toRawJob(JOB)!;
  assert.equal(job.salary?.min, 3240);
  assert.equal(job.salary?.max, 3780);
  assert.equal(job.salary?.currency, "USD");
  assert.equal(job.salary?.period, "year");
  assert.equal(job.salary?.text, "12,500-21,000 AED per month");
});

test("records only the benefits the board actually confirms", () => {
  // visaSponsorshipProvided is false here, and a false must not become a
  // promise of a visa.
  assert.deepEqual(toRawJob(JOB)!.benefits, ["Housing provided", "Flights provided"]);
  assert.equal(toRawJob({ ...JOB, housingProvided: false, flightsProvided: false })!.benefits, undefined);
});

test("a vacancy with no title or id is not a vacancy", () => {
  assert.equal(toRawJob({ ...JOB, title: undefined }), null);
  assert.equal(toRawJob({ ...JOB, id: undefined, slug: undefined }), null);
});
