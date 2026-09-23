/**
 * Application tracking.
 *
 * This is the only data you own rather than scrape, so the behaviour that
 * matters is that a scrape can never overwrite it, and that an ambiguous
 * search never silently picks the wrong role.
 *
 * Runs against a throwaway database so it never touches your real one.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// Must be set before the db module is first imported — DB_PATH reads it once.
const dir = mkdtempSync(join(tmpdir(), "scrapper-track-"));
process.env.SCRAPPER_DB = join(dir, "test.db");

const { getDb, closeDb } = await import("../src/store/db.ts");
const { findJobs, setStatus, pipeline, needsAttention, counts, SETTLED, isStatus } =
  await import("../src/track.ts");

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

function addJob(id: string, title: string, school: string, deadlineDays?: number): void {
  getDb()
    .prepare(
      `INSERT INTO jobs (id, source, source_job_id, dedupe_key, title, url, school_name,
                         is_pe, pe_score, pe_seniority, status, deadline_at,
                         first_seen_at, last_seen_at)
       VALUES (?, 'tes', ?, ?, ?, 'https://example.org', ?, 1, 60, 'teacher', 'open', ?, ?, ?)`,
    )
    .run(
      id, id, id, title, school,
      deadlineDays == null ? null : inDays(deadlineDays),
      new Date().toISOString(), new Date().toISOString(),
    );
}

addJob("tes:1", "Head of Sports", "Sri KDU International School", 38);
addJob("tes:2", "PE Teacher", "Dubai British School", 3);
addJob("tes:3", "PE Teacher", "Greenfield International School", 40);
addJob("tes:4", "Athletic Director", "Dalian American International School");

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test("finds a role by words from its title and school", () => {
  const m = findJobs("head sports kdu");
  assert.equal(m.length, 1);
  assert.equal(m[0]?.job.id, "tes:1");
});

test("requires every word to match, so a vague phrase is not narrowed for you", () => {
  // Two schools advertise a "PE Teacher"; the phrase cannot choose between them.
  assert.equal(findJobs("pe teacher").length, 2);
  // Adding the school picks one out.
  assert.equal(findJobs("pe teacher greenfield").length, 1);
});

test("ranks a title match above a school match", () => {
  const m = findJobs("athletic");
  assert.equal(m[0]?.job.id, "tes:4");
});

test("records a status and keeps it", () => {
  setStatus("tes:1", "applied", "sent CV and covering letter");
  const entry = pipeline().find((e) => e.job.id === "tes:1");
  assert.equal(entry?.job.my_status, "applied");
  assert.equal(entry?.job.my_note, "sent CV and covering letter");
  assert.ok(entry?.job.my_status_at);
});

test("a scrape does not clear what you recorded", async () => {
  const { upsertJobs, startRun } = await import("../src/store/db.ts");
  const runId = startRun("test");
  // Re-upsert the same vacancy, as a daily run would.
  upsertJobs(
    [
      {
        id: "tes:1", source: "tes", sourceJobId: "1", dedupeKey: "k", title: "Head of Sports",
        url: "https://example.org", schoolName: "Sri KDU International School",
        pe: { score: 60, seniority: "teacher", matched: [], vetoed: [], isPe: true },
        firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
      } as never,
    ],
    runId,
  );
  const entry = pipeline().find((e) => e.job.id === "tes:1");
  assert.equal(entry?.job.my_status, "applied", "the scrape wiped my status");
});

test("flags what closes soon and is not dealt with", () => {
  const urgent = needsAttention(7);
  // tes:2 closes in 3 days and is untouched.
  assert.ok(urgent.some((e) => e.job.id === "tes:2"));
  // tes:1 is applied, so it is not nagging any more.
  assert.ok(!urgent.some((e) => e.job.id === "tes:1"));
  // tes:3 closes in 40 days, outside the window.
  assert.ok(!urgent.some((e) => e.job.id === "tes:3"));
});

test("'interested' still counts as needing action", () => {
  setStatus("tes:2", "interested");
  assert.ok(needsAttention(7).some((e) => e.job.id === "tes:2"));
  // But applying settles it.
  setStatus("tes:2", "applied");
  assert.ok(!needsAttention(7).some((e) => e.job.id === "tes:2"));
});

test("counts the pipeline by status", () => {
  const c = counts();
  assert.equal(c.applied, 2);
});

test("knows which statuses mean the role is dealt with", () => {
  assert.ok(SETTLED.has("applied"));
  assert.ok(SETTLED.has("skip"));
  assert.ok(!SETTLED.has("interested"));
  assert.ok(isStatus("applied"));
  assert.ok(!isStatus("maybe"));
});
