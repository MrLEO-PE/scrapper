/**
 * What a second write to a school is allowed to change.
 *
 * Schools arrive from several sources — a crawl of the school's own site, and
 * several directories that each know a fragment. The order they arrive in is
 * not controlled, so a later write must never be able to destroy a better
 * earlier one. The Career Email column is where this bites: it is the most
 * valuable cell in the sheet and the easiest to lose, because "no careers
 * address here" and "no careers address anywhere" look identical by the time
 * they reach the store.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { SchoolProfile } from "../src/core/types.ts";

// The store reads its path once, at import, so it has to be set first.
const dir = mkdtempSync(join(tmpdir(), "scrapper-store-"));
process.env.SCRAPPER_DB = join(dir, "test.db");
const { closeDb, getDb, upsertSchool } = await import("../src/store/db.ts");

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const src = { confidence: 0.9, source: "test" };
const base = (key: string): SchoolProfile => ({
  schoolKey: key,
  schoolName: "Test International School",
  country: { value: "Thailand", provenance: src },
});

const emailsOf = (key: string) =>
  getDb()
    .prepare("SELECT career_email AS career, school_email AS school FROM schools WHERE school_key = ?")
    .get(key) as { career: string | null; school: string | null };

test("a directory listing cannot blank a careers address the crawl found", () => {
  const key = "th-partial";
  // A crawl of the school's own site: it saw everything, and found the address.
  upsertSchool(
    {
      ...base(key),
      careerEmail: { value: "recruitment@school.ac.th", provenance: src },
      schoolEmail: { value: "info@school.ac.th", provenance: src },
      allEmails: [
        { email: "recruitment@school.ac.th", kind: "careers", score: 0.97, foundAt: "p", via: "html" },
        { email: "info@school.ac.th", kind: "info", score: 0.4, foundAt: "p", via: "html" },
      ],
    },
    "job",
  );
  assert.equal(emailsOf(key).career, "recruitment@school.ac.th");

  // Then a directory that knows only an admissions address, so classifies no
  // careers address at all. This is the write that cost 23 schools their
  // careers address: it must add, never subtract.
  upsertSchool(
    { ...base(key), schoolEmail: { value: "admissions@school.ac.th", provenance: src } },
    "directory",
    undefined,
    false,
  );
  assert.equal(emailsOf(key).career, "recruitment@school.ac.th");
});

test("a directory fills a careers address where there was none", () => {
  const key = "th-empty";
  upsertSchool({ ...base(key), website: { value: "https://school2.ac.th", provenance: src } }, "directory", undefined, false);
  assert.equal(emailsOf(key).career, null);

  upsertSchool(
    { ...base(key), careerEmail: { value: "hr@school2.ac.th", provenance: src } },
    "directory",
    undefined,
    false,
  );
  assert.equal(emailsOf(key).career, "hr@school2.ac.th");
});

test("a directory cannot swap the general inbox for a narrower desk", () => {
  const key = "th-downgrade";
  upsertSchool(
    {
      ...base(key),
      schoolEmail: { value: "info@school4.ac.th", provenance: src },
      allEmails: [{ email: "info@school4.ac.th", kind: "info", score: 0.4, foundAt: "p", via: "html" }],
    },
    "job",
  );

  // bestSchoolEmail ranks info above admin on purpose: info@ is the school,
  // admissions@ is one department that handles prospective parents. A listing
  // must not overturn that ranking just by arriving second.
  upsertSchool(
    { ...base(key), schoolEmail: { value: "admissions@school4.ac.th", provenance: src } },
    "directory",
    undefined,
    false,
  );
  assert.equal(emailsOf(key).school, "info@school4.ac.th");
});

test("a fresh crawl may move an address between the two columns", () => {
  const key = "th-recrawl";
  upsertSchool(
    {
      ...base(key),
      careerEmail: { value: "jobs@school3.ac.th", provenance: src },
      allEmails: [{ email: "jobs@school3.ac.th", kind: "careers", score: 0.97, foundAt: "p", via: "html" }],
    },
    "job",
  );
  assert.equal(emailsOf(key).career, "jobs@school3.ac.th");

  // The school took its recruitment page down and now publishes only info@.
  // Continuing to offer jobs@ would send an application into a dead mailbox,
  // so a complete crawl is allowed to clear the column.
  upsertSchool(
    {
      ...base(key),
      schoolEmail: { value: "info@school3.ac.th", provenance: src },
      allEmails: [{ email: "info@school3.ac.th", kind: "info", score: 0.4, foundAt: "p", via: "html" }],
    },
    "job",
  );
  const after = emailsOf(key);
  assert.equal(after.career, null);
  assert.equal(after.school, "info@school3.ac.th");
});
