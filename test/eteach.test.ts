/**
 * Eteach.
 *
 * Read through its JSON search, so the mapping is what is pinned: the
 * location is "City, Country" with the country last, a remote post marks it
 * in brackets, and an expired post is dropped rather than listed as open.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { toRawJob } from "../src/sources/eteach.ts";

const JOB = {
  id: 1234567,
  title: "Head of Physical Education - Secondary",
  url: "/job/head-of-physical-education-secondary-1234567",
  schoolName: "British International School of Jeddah",
  location: "Jeddah, Saudi Arabia",
  salary: null,
  released: "2026-11-10T09:00:59Z",
  expires: "2026-12-10T17:00:59Z",
  hasExpired: false,
};

test("maps a listing to a vacancy", () => {
  const job = toRawJob(JOB)!;
  assert.equal(job.url, "https://www.eteach.com/job/head-of-physical-education-secondary-1234567");
  assert.equal(job.sourceJobId, "1234567");
  assert.equal(job.country, "Saudi Arabia");
  assert.equal(job.city, "Jeddah");
  assert.equal(job.schoolName, "British International School of Jeddah");
  assert.equal(job.deadlineAt, "2026-12-10T17:00:59Z");
  assert.equal(job.salary, undefined);
});

test("a country-only location has no city, and '(Remote)' is not part of the country", () => {
  const job = toRawJob({ ...JOB, location: "Spain (Remote)" })!;
  assert.equal(job.country, "Spain");
  assert.equal(job.city, undefined);
});

test("an expired post is dropped", () => {
  assert.equal(toRawJob({ ...JOB, hasExpired: true }), null);
});
