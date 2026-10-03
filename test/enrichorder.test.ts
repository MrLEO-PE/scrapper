/**
 * Which schools get profiled first.
 *
 * The slow part of enrichment is finding a human to write to — a careers
 * address, an HR contact, a name on the leadership page — and that work does
 * not scale to 2,500+ schools overnight. So it has to land on the schools
 * worth it first: the ones that pay well, estimated from their own figure
 * where one is known and from the country average otherwise.
 *
 * A live vacancy stays the most urgent thing regardless of pay — someone
 * could apply to it today — so pay only re-orders the long background queue
 * of schools with no advert at all, never jumps ahead of one that has one.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "scrapper-enrichorder-"));
process.env.SCRAPPER_DB = join(dir, "test.db");
const { closeDb, getDb, upsertSchool, schoolsNeedingEnrichment } = await import("../src/store/db.ts");

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const src = { confidence: 0.9, source: "test" };

test("pay outranks country rank, but a live vacancy outranks pay", () => {
  // Myanmar's benchmark (~27k) is far below Singapore's (~90k), but this
  // school is ranked #1 in its own country — the old ordering alone would
  // have put it first.
  upsertSchool(
    {
      schoolKey: "myanmar-top", schoolName: "Myanmar Top School",
      country: { value: "Myanmar", provenance: src },
    },
    "directory", 1, false,
  );
  // Ranked much worse in its own country, but Singapore pays far more.
  upsertSchool(
    {
      schoolKey: "singapore-ok", schoolName: "Singapore OK School",
      country: { value: "Singapore", provenance: src },
    },
    "directory", 50, false,
  );
  // No country rank at all, but its own quoted salary beats every benchmark
  // here — this is the one that should come out on top of the no-vacancy group.
  upsertSchool(
    {
      schoolKey: "thailand-rich", schoolName: "Thailand Rich School",
      country: { value: "Thailand", provenance: src },
      salaryEstimate: {
        value: { min: 95000, max: 100000, currency: "USD" },
        provenance: src,
      },
    },
    "directory", undefined, false,
  );

  // A live vacancy at a school in a low-paying country. Urgency beats pay.
  getDb()
    .prepare(
      `INSERT INTO jobs (id, source, source_job_id, dedupe_key, title, url, school_key,
        country, is_pe, status, first_seen_at, last_seen_at)
       VALUES ('j1','tes','1','d1','PE Teacher','https://x', 'myanmar-vacancy',
        'Myanmar', 1, 'open', ?, ?)`,
    )
    .run(new Date().toISOString(), new Date().toISOString());
  upsertSchool(
    {
      schoolKey: "myanmar-vacancy", schoolName: "Myanmar Vacancy School",
      country: { value: "Myanmar", provenance: src },
    },
    "job", undefined, false,
  );

  const order = schoolsNeedingEnrichment(30, 0).map((s) => s.school_key);

  assert.equal(order[0], "myanmar-vacancy", "a live vacancy is always first, however little it pays");
  assert.equal(order[1], "thailand-rich", "its own $97.5k figure beats every country benchmark here");
  assert.equal(order[2], "singapore-ok", "Singapore's benchmark beats Myanmar's despite the worse country rank");
  assert.equal(order[3], "myanmar-top", "best in Myanmar is still Myanmar money");
});

test("a limit is applied after sorting, not before", () => {
  // If the limit were applied inside the SQL before the pay-based re-sort,
  // the highest-paying school could be cut off the top of the list by
  // whatever happened to come out of the database first.
  const top2 = schoolsNeedingEnrichment(30, 2).map((s) => s.school_key);
  assert.deepEqual(top2, ["myanmar-vacancy", "thailand-rich"]);
});
