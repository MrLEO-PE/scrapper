/**
 * Schools' BambooHR and Recruitee job lists.
 *
 * Pinned here: ids are made unique per site, BambooHR's blank location falls
 * back to the configured school and country, and a Recruitee group's
 * department is taken as the school.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fromBamboo, fromRecruitee } from "../src/sources/schoolats.ts";

test("a BambooHR opening carries the configured school", () => {
  const job = fromBamboo(
    { system: "bamboohr", site: "greenschool", school: "Green School Bali", country: "Indonesia" },
    { id: "111", jobOpeningName: "International Primary Teacher ", employmentStatusLabel: "Full-Time", location: { city: "Badung", state: "Bali" } },
  )!;
  assert.equal(job.url, "https://greenschool.bamboohr.com/careers/111");
  assert.equal(job.sourceJobId, "greenschool:111");
  assert.equal(job.title, "International Primary Teacher");
  assert.equal(job.schoolName, "Green School Bali");
  assert.equal(job.country, "Indonesia");
  assert.equal(job.city, "Badung");
});

test("a Recruitee group's department is the school", () => {
  const job = fromRecruitee(
    { system: "recruitee", site: "diponteducation" },
    {
      id: 2831407,
      title: "Teacher of Secondary Drama (IGCSE & A-Level)",
      city: "Chengdu",
      country: "China",
      department: "Dipont KCS Chengdu",
      created_at: "2026-11-18 07:17:01 UTC",
      careers_url: "https://diponteducation.recruitee.com/o/kcscd-teacher-of-secondary-drama-2027",
      description: "<p>Teach drama.</p>",
    },
  )!;
  assert.equal(job.schoolName, "Dipont KCS Chengdu");
  assert.equal(job.sourceJobId, "diponteducation:2831407");
  assert.equal(job.postedAt, "2026-11-18T07:17:01.000Z");
  assert.equal(job.description, "Teach drama.");
});
