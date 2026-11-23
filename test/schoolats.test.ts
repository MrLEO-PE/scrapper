/**
 * Schools' BambooHR and Recruitee job lists.
 *
 * Pinned here: ids are made unique per site, BambooHR's blank location falls
 * back to the configured school and country, and a Recruitee group's
 * department is taken as the school.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fromBamboo, fromLever, fromRecruitee, fromTeamtailor } from "../src/sources/schoolats.ts";

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

test("reads a Teamtailor jobs.rss feed", () => {
  const rss = `<rss><channel><item> <title>Physical Education &amp; Outdoor Education Teacher</title>
<description>&lt;p&gt;Lead PE&lt;/p&gt;</description> <pubDate>Tue, 27 Oct 2026 15:36:44 +0800</pubDate>
<link>https://careers.etonhouse.edu.sg/jobs/8621371-physical-education</link>
<tt:locations><tt:location><tt:name>Orchard</tt:name><tt:city>Singapore</tt:city><tt:country>Singapore</tt:country></tt:location></tt:locations>
<tt:department>International School Orchard</tt:department></item></channel></rss>`;
  const [job] = fromTeamtailor({ system: "teamtailor", site: "careers.etonhouse.edu.sg", school: "EtonHouse" }, rss);
  assert.equal(job!.sourceJobId, "careers.etonhouse.edu.sg:8621371");
  assert.equal(job!.title, "Physical Education & Outdoor Education Teacher");
  assert.equal(job!.schoolName, "EtonHouse (International School Orchard)");
  assert.equal(job!.country, "Singapore");
  assert.equal(job!.postedAt, "2026-10-27T07:36:44.000Z");
  assert.equal(job!.description, "Lead PE");
});

test("maps a Lever posting", () => {
  const job = fromLever({ system: "lever", site: "gess", school: "German European School Singapore", country: "Singapore" }, {
    id: "abc", text: "Head of Outdoor Education ", hostedUrl: "https://jobs.lever.co/gess/abc", createdAt: 1793000000000,
    categories: { location: "Singapore", commitment: "Full-time" }, descriptionPlain: "Lead outdoor ed",
  })!;
  assert.equal(job.sourceJobId, "gess:abc");
  assert.equal(job.title, "Head of Outdoor Education");
  assert.equal(job.applicationUrl, "https://jobs.lever.co/gess/abc/apply");
  assert.equal(job.contractTerm, "Full-time");
  assert.equal(fromLever({ system: "lever", site: "x" }, { id: "", text: "", hostedUrl: "" }), null);
});
