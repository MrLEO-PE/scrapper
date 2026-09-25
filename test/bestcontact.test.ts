/**
 * The Best Contact ladder.
 *
 * A careers address exists for about a quarter of schools. The rest are not
 * unreachable — a general inbox, a switchboard number or a Facebook page will
 * do — but that was spread across four columns, so a row with no careers
 * address looked like a dead end when it was not.
 *
 * What matters as much as finding something is saying what it is: writing to a
 * general inbox needs a different opening than writing to HR, and a phone
 * number is not an application route at all.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { bestContact } from "../src/export/fields.ts";
import type { SchoolRow } from "../src/store/db.ts";

const school = (over: Partial<SchoolRow>): SchoolRow =>
  ({
    school_key: "k", name: "A School", country: "Thailand", city: null, website: null,
    curriculum_json: null, pe_team_size: null, student_count: null, school_type: null,
    salary_json: null, salary_basis: null, package_json: null, school_email: null,
    career_email: null, careers_url: null, principal: null, school_hook: null,
    pe_hook: null, emails_json: null, provenance_json: null, notes_json: null,
    origin: "directory", country_rank: null, accreditation: null, prominence: null,
    package_score: null, rank_basis: null, social: null, phone: null,
    enriched_at: null, created_at: "2026-01-01",
    ...over,
  }) as SchoolRow;

test("a careers address wins outright", () => {
  const c = bestContact({
    school: school({ career_email: "recruitment@s.ac.th", school_email: "info@s.ac.th", phone: "+66 1" }),
  });
  assert.equal(c.value, "recruitment@s.ac.th");
  assert.equal(c.kind, "careers address");
});

test("falls back to the general inbox, and says that is what it is", () => {
  const c = bestContact({ school: school({ school_email: "info@s.ac.th", phone: "+66 1" }) });
  assert.equal(c.value, "info@s.ac.th");
  assert.equal(c.kind, "general inbox");
});

test("uses any address found rather than none", () => {
  // A named teacher's address still reaches a human at the school.
  const c = bestContact({
    school: school({
      emails_json: JSON.stringify([
        { email: "j.smith@s.ac.th", kind: "other", score: 0.3, foundAt: "p", via: "html" },
        { email: "reception@s.ac.th", kind: "admin", score: 0.45, foundAt: "p", via: "html" },
      ]),
    }),
  });
  assert.equal(c.value, "reception@s.ac.th", "the better-scoring address wins");
  assert.equal(c.kind, "admin address");
});

test("takes an address from the advert when the school profile has none", () => {
  const c = bestContact({
    school: school({}),
    job: { emails_json: JSON.stringify(["apply@board.com"]) } as never,
  });
  assert.equal(c.value, "apply@board.com");
  assert.equal(c.kind, "from the advert");
});

test("offers the phone when no email exists anywhere", () => {
  const c = bestContact({ school: school({ phone: "+66 2 123 4567" }) });
  assert.equal(c.value, "+66 2 123 4567");
  // Must not read as an application address.
  assert.match(c.kind, /phone/);
  assert.match(c.kind, /no email/);
});

test("falls all the way to the social page, and says to look it up yourself", () => {
  // The scraper cannot read these pages; the reader can.
  const c = bestContact({ school: school({ social: "https://facebook.com/theschool" }) });
  assert.equal(c.value, "https://facebook.com/theschool");
  assert.match(c.kind, /yourself/);
});

test("the phone outranks the social page, being a direct route", () => {
  const c = bestContact({
    school: school({ phone: "+66 2 123 4567", social: "https://facebook.com/theschool" }),
  });
  assert.equal(c.value, "+66 2 123 4567");
});

test("truly nothing stays empty rather than inventing a route", () => {
  const c = bestContact({ school: school({}) });
  assert.equal(c.value, "");
  assert.equal(c.kind, "");
  assert.equal(bestContact({}).value, "");
});
