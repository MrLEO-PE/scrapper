/**
 * Education Gazette (NZ): search-page references and the vacancy's JobPosting.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fromJobPosting, refsFrom } from "../src/sources/nzgazette.ts";

test("reads the references on a search page", () => {
  const html = `<h3><a class="KtJM9q_link" data-reference="1HB1uv" href="/vacancies/1HB1uv">Health and PE Teacher</a></h3>
    <p>Reference: 1HB1uv</p><h3><a data-reference="1HB1ue" href="/vacancies/1HB1ue">Head of Health</a></h3>`;
  assert.deepEqual(refsFrom(html), ["1HB1uv", "1HB1ue"]);
});

test("reads a vacancy's schema.org JobPosting", () => {
  const ld = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Head of Health and Teacher of Health and Physical Education",
    description: "<p>Join the health and PE faculty at Lynfield College.</p>",
    datePosted: "2026-11-27T00:57:58.781Z",
    validThrough: "2026-12-11T03:00:00.000Z",
    employmentType: ["FULL_TIME"],
    hiringOrganization: { "@type": "Organization", name: "Lynfield College" },
    jobLocation: { "@type": "Place", address: { addressRegion: "Auckland", addressCountry: "NZ" } },
    url: "https://gazette.education.govt.nz/vacancies/1HB1ue",
  };
  const job = fromJobPosting(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`, "1HB1ue")!;
  assert.equal(job.schoolName, "Lynfield College");
  assert.equal(job.country, "New Zealand");
  assert.equal(job.city, "Auckland");
  assert.equal(job.deadlineAt, "2026-12-11T03:00:00.000Z");
  assert.equal(job.contractType, "FULL_TIME");
  assert.equal(job.description, "Join the health and PE faculty at Lynfield College.");
});
