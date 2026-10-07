/**
 * Two small boards read from what they publish openly. The tests hold the parts
 * most likely to quietly go wrong: a role title split by its own comma losing
 * its leadership, an expiry invented where the board gives none, and a
 * recruiter's mailbox treated as a school's careers address.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { peRole, toRawJob as wishlistJob } from "../src/sources/wishlist.ts";
import { pagePropsOf, toRawJob as teastJob } from "../src/sources/teast.ts";

// --- WISHlistjobs ------------------------------------------------------------

test("a leadership title split by its own comma stays whole", () => {
  assert.equal(peRole("HEAD OF DEPARTMENT, PHYSICAL EDUCATION & HEALTH"), "HEAD OF DEPARTMENT, PHYSICAL EDUCATION & HEALTH");
  assert.equal(peRole("Head of Department, Mathematics"), null);
});

test("the PE role is picked out of a post that lists several", () => {
  assert.equal(peRole("Biology Teacher, Music Tutor, PE Teacher - Cover"), "PE Teacher - Cover");
  assert.equal(peRole("Music Teacher, Physical Education Teacher, Secondary School Chemistry"), "Physical Education Teacher");
  assert.equal(peRole("Chemistry Teacher, Art Teacher"), null);
});

test("a post becomes a vacancy at the named school, linking back to its listing", () => {
  const job = wishlistJob({
    id: 26010,
    formatted_date_posted: "2026-09-29",
    city_province: "Al Ain",
    country: "UAE",
    school_name: "Al Ain Academy ",
    school_year: "2026-27",
    compensation: "TBD",
    closing_date: "Until Filled",
    vacancies_concat: "Teacher - Physical Education (Female) - January 2027",
  })!;
  assert.equal(job.source, "wishlist");
  assert.equal(job.schoolName, "Al Ain Academy");
  assert.equal(job.title, "Teacher - Physical Education (Female) - January 2027");
  assert.match(job.url, /teach-physical-education-abroad#job-post-26010$/);
  assert.equal(job.postedAt?.slice(0, 10), "2026-09-29");
  // "Until Filled" is not a date and is not turned into one.
  assert.equal(job.deadlineAt, undefined);
  assert.doesNotMatch(job.description ?? "", /TBD/);
});

test("a post with no PE role is not a vacancy", () => {
  assert.equal(wishlistJob({ id: 1, school_name: "X", vacancies_concat: "Chemistry Teacher" }), null);
});

// --- Teast -------------------------------------------------------------------

const html = (jobs: unknown[]) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { jobs, locations: [] } } })}</script></html>`;

const pbiss = {
  title: "Secondary PE Teacher",
  companyName: "PBISS International School",
  city: "Koh Samui",
  country: "Thailand",
  url: "https://teast.co/job/secondary-pe-teacher-abc",
  slug: "secondary-pe-teacher-abc",
  createdAt: Date.parse("2026-09-22T00:00:00Z"),
  endJobBy: Date.parse("2026-10-22T00:00:00Z"),
  payString: "Up To 62,000 THB per month",
  payMin: 62000,
  payMax: 62000,
  currency: "THB",
  type: "per month",
  applyType: "Email",
  applyLink: "saruda.viracha@pbiss.ac.th",
  jobDescription: "<p>We are seeking a Secondary Physical Education teacher.</p>",
  status: "active",
  active: true,
};

test("reads the jobs embedded in a Teast page", () => {
  const props = pagePropsOf(html([pbiss]));
  assert.equal(props?.jobs?.length, 1);
  assert.equal(pagePropsOf("<html>no data</html>"), null);
});

test("a Teast job keeps its real expiry, pay and the school's own application address", () => {
  const job = teastJob(pbiss)!;
  assert.equal(job.schoolName, "PBISS International School");
  assert.equal(job.deadlineAt?.slice(0, 10), "2026-10-22");
  assert.equal(job.salary?.min, 62000);
  assert.equal(job.salary?.period, "MONTHLY");
  assert.deepEqual(job.schoolEmails, ["saruda.viracha@pbiss.ac.th"]);
});

test("a recruiter's free mailbox is shown but never treated as the school's address", () => {
  const job = teastJob({ ...pbiss, companyName: "Some Agency", applyLink: "recruiter@gmail.com" })!;
  assert.equal(job.schoolEmails, undefined);
  assert.match(job.description ?? "", /Apply to: recruiter@gmail\.com/);
});

test("an inactive Teast job, or one that is not PE, is dropped", () => {
  assert.equal(teastJob({ ...pbiss, status: "expired", active: false }), null);
  assert.equal(teastJob({ ...pbiss, title: "Maths Teacher", jobDescription: "<p>Algebra.</p>" }), null);
});

test("Hong Kong is not filed under China", () => {
  const job = wishlistJob({ id: 2, school_name: "Kellett School", city_province: "Hong Kong", country: "China", vacancies_concat: "Prep Physical Education & Games Teacher (PFL)" })!;
  assert.equal(job.country, "Hong Kong");
  assert.equal(wishlistJob({ id: 3, school_name: "X", city_province: "Shanghai", country: "China", vacancies_concat: "PE Teacher" })!.country, "China");
});
