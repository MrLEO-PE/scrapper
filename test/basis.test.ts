/**
 * BASIS International: jobs read from the JSON a Phenom results page embeds.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { embeddedJobs, toRawJob } from "../src/sources/basis.ts";

const PAGE = `<script>phApp.ddo = {"eagerLoadRefineSearch":{"status":200,"hits":1,"totalHits":120,"data":{"jobs":[
{"jobId":"P-102122","title":"Physical Education Teacher - Primary School","city":"Shenzhen","country":"China",
"postedDate":"2026-08-25T00:00:00.000+0000","type":"Full-Time",
"descriptionTeaser":"BASIS International School Shenzhen is seeking qualified candidates for a PE Teacher"}],"aggregations":[]}}}</script>`;

test("reads the embedded jobs and the total", () => {
  const res = embeddedJobs(PAGE)!;
  assert.equal(res.total, 120);
  assert.equal(res.jobs.length, 1);
  assert.equal(embeddedJobs("<html>nothing</html>"), null);
});

test("maps a Phenom job, naming the school from the teaser", () => {
  const job = toRawJob(embeddedJobs(PAGE)!.jobs[0]!)!;
  assert.equal(job.sourceJobId, "P-102122");
  assert.equal(job.schoolName, "BASIS International School Shenzhen");
  assert.equal(job.country, "China");
  assert.equal(job.city, "Shenzhen");
  assert.equal(job.postedAt, "2026-08-25T00:00:00.000Z");
  assert.match(job.url, /^https:\/\/jobs\.basisinternationalschools\.com\/global\/en\/job\/P-102122\//);
});
