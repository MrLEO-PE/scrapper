/**
 * Ranking schools on what the job is actually worth.
 *
 * The ranking decides which schools the user sees first, so the rules behind it
 * have to be pinned down: benefits must be weighted by value rather than
 * counted, an unprofiled school must not be punished for missing data, and the
 * basis of every rank must be reported honestly.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { rankByValue, scorePackage, type RankInput } from "../src/match/packagevalue.ts";

const base = (over: Partial<RankInput> & { schoolKey: string }): RankInput => ({
  packageTerms: null,
  accreditationScore: 0,
  ...over,
});

test("weighs benefits by value, not by how many there are", () => {
  const housing = scorePackage(["Housing / accommodation"]);
  const trimmings = scorePackage(["Bonus", "Transport allowance", "Visa", "Utilities"]);
  // Four small perks must not outrank free accommodation.
  assert.ok(
    housing.score > trimmings.score,
    `housing ${housing.score} should beat four minor perks ${trimmings.score}`,
  );
});

test("scores a full expat package near the top", () => {
  const full = scorePackage([
    "Tax-free salary",
    "Housing / accommodation",
    "Flights",
    "Medical insurance",
    "Dependant school places",
    "End-of-service gratuity",
  ]);
  assert.ok(full.score >= 85, `expected a strong score, got ${full.score}`);
  assert.deepEqual(full.headline, [
    "Housing",
    "Dependant school places",
    "Tax-free",
    "Flights",
    "Medical insurance",
  ]);
});

test("a minor perk is never a headline", () => {
  const { headline, counted } = scorePackage(["Transport allowance", "Bonus"]);
  assert.deepEqual(headline, []);
  assert.deepEqual(counted.sort(), ["Bonus", "Transport"]);
});

test("no package terms means no score at all", () => {
  for (const empty of [null, undefined, []]) {
    assert.equal(scorePackage(empty).score, 0);
  }
  // Text with nothing recognisable in it must not invent a score.
  assert.equal(scorePackage(["Competitive remuneration"]).score, 0);
});

test("ranks a better package above a thinner one", () => {
  const ranked = rankByValue([
    base({ schoolKey: "thin", packageTerms: ["Flights", "Medical insurance"] }),
    base({ schoolKey: "rich", packageTerms: ["Housing / accommodation", "Flights", "Medical insurance"] }),
  ]);
  assert.equal(ranked[0]?.schoolKey, "rich");
  assert.equal(ranked[0]?.basis, "package");
});

test("a passing mention of a perk is not treated as a known package", () => {
  // Real case: a school whose only package text was "Bonus" was ranking first
  // in its country, above accredited schools we simply had not profiled yet.
  // Finding one minor word is not evidence of a good package.
  const ranked = rankByValue([
    base({ schoolKey: "bonus-only", packageTerms: ["Bonus"] }),
    base({ schoolKey: "unprofiled", accreditationScore: 60 }),
  ]);
  assert.equal(ranked[0]?.schoolKey, "unprofiled");
  assert.equal(ranked[1]?.basis, "accreditation");
  // The score is still recorded — it just does not carry the rank.
  assert.ok(ranked[1]!.packageScore > 0);
});

test("salary refines the order but does not overturn the package", () => {
  // A headline salary with nothing attached is often the worse offer: the
  // school with housing and flights should stay ahead.
  const ranked = rankByValue([
    base({
      schoolKey: "cash-only",
      packageTerms: ["Bonus"],
      salaryMin: 30000, salaryMax: 30000, salaryCurrency: "USD", salaryPeriod: "ANNUAL",
    }),
    base({
      schoolKey: "housed",
      packageTerms: ["Housing / accommodation", "Flights", "Medical insurance", "Tax-free salary"],
      salaryMin: 20000, salaryMax: 20000, salaryCurrency: "USD", salaryPeriod: "ANNUAL",
    }),
  ]);
  assert.equal(ranked[0]?.schoolKey, "housed");
  assert.equal(ranked[0]?.basis, "package+salary");
});

test("salary is ignored when currencies cannot be compared", () => {
  // One figure in AED and one in USD are not comparable without a rate, and
  // guessing a rate would be inventing data.
  const ranked = rankByValue([
    base({
      schoolKey: "a", packageTerms: ["Housing / accommodation"],
      salaryMin: 9000, salaryCurrency: "AED", salaryPeriod: "MONTHLY",
    }),
    base({
      schoolKey: "b", packageTerms: ["Housing / accommodation"],
      salaryMin: 90000, salaryCurrency: "USD", salaryPeriod: "ANNUAL",
    }),
  ]);
  assert.ok(ranked.every((r) => r.basis === "package"));
});

test("an unprofiled school falls back to accreditation and says so", () => {
  const ranked = rankByValue([
    base({ schoolKey: "unknown", accreditationScore: 99 }),
    base({ schoolKey: "known", packageTerms: ["Housing / accommodation", "Flights"] }),
  ]);
  // Evidence beats proxy: the accreditation score is on its own scale and a
  // high one must not outrank a package we have actually established.
  assert.equal(ranked[0]?.schoolKey, "known");
  assert.equal(ranked[1]?.basis, "accreditation");
  assert.equal(ranked[1]?.packageScore, 0);
});

test("unprofiled schools keep the directory's order among themselves", () => {
  const ranked = rankByValue([
    base({ schoolKey: "weak", accreditationScore: 10 }),
    base({ schoolKey: "strong", accreditationScore: 50 }),
    base({ schoolKey: "middling", accreditationScore: 30 }),
  ]);
  assert.deepEqual(ranked.map((r) => r.schoolKey), ["strong", "middling", "weak"]);
});

test("ranks are a dense 1..n with no gaps or ties", () => {
  const ranked = rankByValue(
    ["a", "b", "c", "d"].map((k) => base({ schoolKey: k, packageTerms: ["Housing / accommodation"] })),
  );
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4]);
});

test("equal schools come out in the same order every run", () => {
  // A sheet that reshuffles overnight looks broken, so ties resolve by name
  // rather than by whatever order the database happened to return.
  const schools = [
    base({ schoolKey: "k3", name: "Cedar College", packageTerms: ["Housing / accommodation"] }),
    base({ schoolKey: "k1", name: "Acacia School", packageTerms: ["Housing / accommodation"] }),
    base({ schoolKey: "k2", name: "Banyan Academy", packageTerms: ["Housing / accommodation"] }),
  ];
  const forwards = rankByValue(schools).map((r) => r.schoolKey);
  const backwards = rankByValue([...schools].reverse()).map((r) => r.schoolKey);
  assert.deepEqual(forwards, ["k1", "k2", "k3"]);
  assert.deepEqual(forwards, backwards);
});
