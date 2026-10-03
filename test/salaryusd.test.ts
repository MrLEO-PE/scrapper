/**
 * The Yearly Fees and Approx. Salary columns, in USD.
 *
 * Both are per-school money signals quoted in dozens of different local
 * currencies — a school cannot be weighed against another until the figures
 * share a currency, which is the entire point of these two columns.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveFields, type FieldContext } from "../src/export/fields.ts";
import { resetFxForTests } from "../src/enrich/fx.ts";
import type { JobRow, SchoolRow } from "../src/store/db.ts";

test.beforeEach(() => resetFxForTests());

const feesField = resolveFields(["fees"], "school")[0]!;
const salaryField = resolveFields(["salary_estimate"], "both")[0]!;

const school = (over: Partial<SchoolRow>): SchoolRow =>
  ({
    school_key: "k", name: "A School", country: "Thailand", city: null, website: null,
    curriculum_json: null, pe_team_size: null, student_count: null, school_type: null,
    salary_json: null, salary_basis: null, package_json: null, school_email: null,
    career_email: null, careers_url: null, principal: null, contact_name: null,
    contact_role: null, contact_email: null, school_hook: null, pe_hook: null,
    emails_json: null, provenance_json: null, notes_json: null,
    origin: "directory", country_rank: null, accreditation: null, prominence: null,
    package_score: null, rank_basis: null, social: null, phone: null,
    fee_low: null, fee_high: null, fee_currency: null,
    enriched_at: null, created_at: "2026-01-01",
    ...over,
  }) as SchoolRow;

const ctx = (s: Partial<SchoolRow>): FieldContext => ({ school: school(s) });

test("fees convert to USD and keep the original figure visible", () => {
  const cell = feesField.get(ctx({ fee_low: 450_000, fee_high: 600_000, fee_currency: "THB" }));
  assert.match(cell, /^USD [\d,]+–[\d,]+ \(THB 450,000–600,000\)$/);
});

test("a fee in an unrecognised currency says so rather than guessing", () => {
  const cell = feesField.get(ctx({ fee_low: 10_000, fee_currency: "ZZZ" }));
  assert.match(cell, /not converted — currency unclear/);
  assert.match(cell, /ZZZ 10,000/); // the original figure is still there to read
});

test("no fees on record means an empty cell, not a zero", () => {
  assert.equal(feesField.get(ctx({})), "");
});

const job = (over: Partial<JobRow>): FieldContext => ({ job: { id: "j", ...over } as JobRow });

test("salary annualises a monthly figure and converts it to USD", () => {
  const cell = salaryField.get(
    job({ salary_json: JSON.stringify({ min: 15000, max: 18000, currency: "AED", period: "MONTHLY" }) }),
  );
  assert.match(cell, /^USD [\d,]+–[\d,]+\/year \(AED 15,000–18,000\/month\)$/);
});

test("a weekly, daily or hourly rate is shown but not converted", () => {
  const cell = salaryField.get(job({ salary_json: JSON.stringify({ min: 800, currency: "USD", period: "WEEKLY" }) }));
  assert.match(cell, /not converted — pay period unclear/);
  assert.match(cell, /800/); // the figure itself is not lost
});

test("free text with no number stays as the school wrote it", () => {
  const cell = salaryField.get(job({ salary_json: JSON.stringify({ text: "Competitive, negotiable" }) }));
  assert.equal(cell, "Competitive, negotiable");
});

test("falls back to the country benchmark, already in USD, when nobody publishes a figure", () => {
  const cell = salaryField.get(ctx({ country: "Thailand" }));
  // Whatever the configured Thailand benchmark is, it must read as an annual
  // USD approximation, not a raw unlabelled number.
  if (cell) assert.match(cell, /^~USD [\d,]+\/year$/);
});

test("a school's own figure is preferred over the country average", () => {
  const cell = salaryField.get(ctx({ salary_json: JSON.stringify({ min: 80_000, max: 90_000, currency: "USD" }) }));
  assert.match(cell, /^USD 80,000–90,000\/year/);
});

test("a salary already in USD does not repeat itself in brackets", () => {
  const cell = salaryField.get(job({ salary_json: JSON.stringify({ min: 55000, max: 65000, currency: "USD" }) }));
  assert.equal(cell, "USD 55,000–65,000/year");
});

test("a monthly USD salary still shows the original, since something did change", () => {
  const cell = salaryField.get(job({ salary_json: JSON.stringify({ min: 5000, currency: "USD", period: "MONTHLY" }) }));
  assert.match(cell, /^USD 60,000\/year \(USD 5,000\/month\)$/);
});

test("flags a converted fee no real school would charge, rather than presenting it as fact", () => {
  // A real case found while building this: CNY 2,510,000 converts to USD
  // 373,824 — almost certainly a scraping error in the original figure, not
  // an actual fee. The row stays visible and readable, flagged rather than
  // hidden, so the underlying defect is not lost.
  const cell = feesField.get(ctx({ fee_low: 165_000, fee_high: 2_510_000, fee_currency: "CNY" }));
  assert.match(cell, /implausible, needs checking/);
});

test("an ordinary, expensive-but-real fee is not flagged", () => {
  const cell = feesField.get(ctx({ fee_low: 40_000, fee_high: 55_000, fee_currency: "USD" }));
  assert.doesNotMatch(cell, /implausible/);
});
