/**
 * SeekTeachers.
 *
 * Added to break TES's 64% hold on the feed. Two traps on this site produced
 * confidently wrong data on the first run, and both are pinned here, because
 * a fabricated salary or a country of "home" is worse than an empty cell:
 * an empty cell reads as unknown, a wrong one reads as fact.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  countryFromCrumbs,
  labelled,
  listingEntries,
  parseDetail,
  parseSalary,
} from "../src/sources/seekteachers.ts";

const known = new Map([
  ["united arab emirates", "United Arab Emirates"],
  ["china", "China"],
  ["thailand", "Thailand"],
]);

test("never reads a salary out of commented-out template markup", () => {
  // Every vacancy on the board carries this, with the example value still in
  // it. Read naively it gave all 25 sampled jobs the same £35,000.
  const html = `<div><!-- <span class="job-details">Salary:</span>&pound;35,000 per year--></div>
    <span class="job-details">Deadline:</span>Oct 31, 2026`;
  assert.equal(labelled(html, "Salary"), undefined);
  // A real one, outside a comment, is still read.
  assert.equal(labelled(`<span>Salary:</span>USD 40,000 per year`, "Salary"), "USD 40,000 per year");
  assert.equal(labelled(html, "Deadline"), "Oct 31, 2026");
});

test("takes the country from the breadcrumb, not the first crumb", () => {
  // The crumbs read "home > permanent > united arab emirates". countryName
  // normalises rather than validates and hands back "home" unchanged, so
  // every vacancy was filed under a country called home.
  const bar = `<ul class="breadcrumb"> home &nbsp; > &nbsp; permanent &nbsp; > &nbsp; united arab emirates &nbsp; > &nbsp; dubai </ul>`;
  assert.equal(countryFromCrumbs(bar, known), "United Arab Emirates");
  assert.equal(countryFromCrumbs(`<ul class="breadcrumb"> home > permanent </ul>`, known), undefined);
  assert.equal(countryFromCrumbs(`<div>no crumbs here</div>`, known), undefined);
});

test("reads the vacancy list even though the anchors are unclosed", () => {
  // The markup opens a new <a> before closing the last one, so a tag-matching
  // parser finds nothing.
  const html = `
    <a href="https://www.seekteachers.com/job-detail.asp?job_id=65091">
    <li><span style="padding:5px;">Kindergarten Teacher - Dubai - ASAP start</span></li>
    <a href="https://www.seekteachers.com/job-detail.asp?job_id=65090">
    <li><span style="padding:5px;">ESL Teacher - ASAP start</span></li>`;
  const entries = listingEntries(html);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.id, "65091");
  assert.match(entries[0]!.title, /^Kindergarten Teacher/);
});

test("splits the row title into a role and a city", () => {
  const html = `<ul class="breadcrumb"> home > permanent > china </ul>`;
  const job = parseDetail(html, "65091", "Secondary English Teacher - Hangzhou - ASAP start")!;
  assert.equal(job.title, "Secondary English Teacher");
  assert.equal(job.city, "Hangzhou");
  assert.equal(job.sourceJobId, "65091");
  assert.match(job.url, /job_id=65091/);
});

test("does not mistake a start date for a city", () => {
  // "Role - ASAP start" has no city in it, and inventing one would put the
  // vacancy in a place that does not exist.
  const html = `<ul class="breadcrumb"> home > permanent > china </ul>`;
  assert.equal(parseDetail(html, "1", "ESL Teacher - ASAP start")!.city, undefined);
  assert.equal(parseDetail(html, "2", "ESL Teacher - Permanent - full time")!.city, undefined);
});

test("reads a salary when the board states one", () => {
  const s = parseSalary("£35,000 per year")!;
  assert.equal(s.min, 35000);
  assert.equal(s.currency, "GBP");
  assert.equal(s.period, "year");
  assert.equal(parseSalary(undefined), undefined);
  assert.equal(parseSalary("  "), undefined);
  // Unreadable numbers still keep the wording rather than dropping it.
  assert.deepEqual(parseSalary("competitive"), { text: "competitive" });
});
