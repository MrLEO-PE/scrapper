/**
 * Finding a school's website without ever guessing one. A site found by search
 * is held to a stricter test than the rest, a failed search is never recorded
 * as "this school has no website", and a found website queues the school to be
 * profiled again.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pageIsSchool } from "../src/enrich/findsite.ts";

process.env.SCRAPPER_DB = join(mkdtempSync(join(tmpdir(), "ws-")), "t.db");
const { getDb, getSchoolsNeedingWebsite, recordWebsiteAttempt, setSchoolWebsite, upsertJobs } = await import("../src/store/db.ts");

const page = (body: string) =>
  `<html><body>${body} Our school welcomes students and pupils to the campus. Admissions open. Teachers and curriculum.</body></html>`;

test("a site found by search must contain every distinctive word and the city", () => {
  const html = page("Welcome to Craighouse School in Santiago, Chile.");
  assert.equal(pageIsSchool(html, "Craighouse School", { strict: true, city: "Santiago" }), true);
  // The right words, the wrong city: another school's site.
  assert.equal(pageIsSchool(html, "Craighouse School", { strict: true, city: "Valparaiso" }), false);
  // Most of the name is not enough when the site is a search result.
  const partial = page("Welcome to Hillcrest School in Santiago.");
  assert.equal(pageIsSchool(partial, "Hillcrest Ridgeway School", { strict: true, city: "Santiago" }), false);
  assert.equal(pageIsSchool(partial, "Hillcrest Ridgeway Santiago School", { city: "Santiago" }), true, "the ordinary test still allows most of the words");
});

const school = (key: string, name: string, country: string, rank: number | null, city: string | null = null) =>
  getDb()
    .prepare("INSERT INTO schools (school_key, name, country, city, country_rank, origin, created_at) VALUES (?, ?, ?, ?, ?, 'directory', ?)")
    .run(key, name, country, city, rank, new Date().toISOString());

test("schools advertising a PE role come first, wherever they are", () => {
  school("ranked|chile", "Ranked School", "Chile", 1);
  school("hiring|uae", "Hiring School", "United Arab Emirates", null);
  school("nobody|france", "Nobody School", "France", null);
  getDb()
    .prepare("INSERT INTO jobs (id, source, source_job_id, dedupe_key, title, url, school_key, is_pe, status, first_seen_at, last_seen_at) VALUES ('t:1','tes','1','k','PE Teacher','u','hiring|uae',1,'open','2026-10-01','2026-10-01')")
    .run();
  const rows = getSchoolsNeedingWebsite(new Set(["chile"]));
  assert.deepEqual(rows.map((r) => r.school_key), ["hiring|uae", "ranked|chile"]);
  assert.equal(rows[0]!.hiring, 1);
  // Not hiring and not in a target country: not worth a search.
  assert.ok(!rows.some((r) => r.school_key === "nobody|france"));
});

test("a school searched for and not found is left alone for weeks, but a failed search is not recorded", () => {
  recordWebsiteAttempt("ranked|chile", false);
  assert.ok(!getSchoolsNeedingWebsite(new Set(["chile"])).some((r) => r.school_key === "ranked|chile"));
  // Back in the queue once the cool-down is over.
  assert.ok(getSchoolsNeedingWebsite(new Set(["chile"]), 0, 0).some((r) => r.school_key === "ranked|chile"));
  // A school found is no longer in need.
  recordWebsiteAttempt("hiring|uae", true);
  assert.ok(getSchoolsNeedingWebsite(new Set(["chile"])).some((r) => r.school_key === "hiring|uae"), "a hit is not a miss, so it is not excluded");
});

test("a found website is set once, and queues the school to be profiled again", () => {
  getDb().prepare("UPDATE schools SET enriched_at = '2026-10-01T00:00:00Z' WHERE school_key = 'hiring|uae'").run();
  setSchoolWebsite("hiring|uae", "https://hiring.example");
  const row = getDb().prepare("SELECT website, enriched_at FROM schools WHERE school_key = 'hiring|uae'").get() as { website: string; enriched_at: string | null };
  assert.equal(row.website, "https://hiring.example");
  assert.equal(row.enriched_at, null);
  // A website already held is never overwritten by a later guess.
  setSchoolWebsite("hiring|uae", "https://other.example");
  assert.equal((getDb().prepare("SELECT website FROM schools WHERE school_key = 'hiring|uae'").get() as { website: string }).website, "https://hiring.example");
});
