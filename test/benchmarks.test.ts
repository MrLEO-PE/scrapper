/**
 * Country salary benchmarks.
 *
 * This is the one number in the sheet that is not about the school in the row,
 * so the rules keeping it honest matter more than usual: it must never
 * outrank a real figure, it must never rest on one teacher's contract, and it
 * must always say what it is.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { benchmarkAverage, benchmarkSavings, countryBenchmark } from "../src/enrich/benchmarks.ts";
import { BASIS_LABEL } from "../src/enrich/salary.ts";

test("publishes an average backed by enough teachers", () => {
  const hit = countryBenchmark("China");
  assert.ok(hit, "China has 127 reports and should be published");
  assert.equal(hit.salary.currency, "USD");
  assert.equal(hit.salary.period, "ANNUAL");
  assert.ok(hit.reports >= 5);
  assert.equal(benchmarkAverage("China"), 60000);
});

test("withholds an average that rests on too few reports", () => {
  // Bangladesh sits at $88,000 on a single submission — far above its
  // neighbours, and the most eye-catching wrong number the sheet could carry.
  assert.equal(countryBenchmark("Bangladesh"), null);
  assert.equal(benchmarkAverage("Bangladesh"), null);
  for (const thin of ["Guatemala", "Laos", "Fiji", "Tanzania", "Pakistan"]) {
    assert.equal(countryBenchmark(thin), null, `${thin} is below the report threshold`);
  }
});

test("a thin report count is overridden by real published figures", () => {
  // Australia had two submissions averaging $83k, below the threshold and so
  // withheld. Published national scales give AUD 91,500-110,000, which is
  // solid ground — and the two submissions are kept as the cross-check.
  const au = countryBenchmark("Australia");
  assert.ok(au, "Australia should publish from sourced figures");
  assert.equal(au.reports, 0);
  assert.equal(benchmarkAverage("Australia"), 66000);
  assert.match(au.crosscheck!, /\$83k/);
  // The local-scale caveat matters: no expat premium, so an empty Package
  // column there is by design, not a gap.
  assert.match(au.salary.evidence!, /no expat premium/);
});

test("says nothing for a country with no data at all", () => {
  for (const missing of ["Nepal", "Bhutan", "Mozambique", "Tuvalu", "Nicaragua"]) {
    assert.equal(countryBenchmark(missing), null);
  }
  assert.equal(countryBenchmark(null), null);
  assert.equal(countryBenchmark(undefined), null);
  assert.equal(countryBenchmark(""), null);
});

test("publishes a figure with named sources but no submission pool", () => {
  // Costa Rica has no teacher submissions, but a real posting at
  // $2,400-$2,600/month plus the mandated aguinaldo. The report threshold
  // cannot apply to a figure that was never a poll.
  const hit = countryBenchmark("Costa Rica");
  assert.ok(hit, "a sourced figure should still publish");
  assert.equal(hit.reports, 0);
  assert.match(hit.salary.evidence!, /aguinaldo/);
  // And it must not claim a sample it does not have.
  assert.doesNotMatch(hit.salary.evidence!, /teachers reporting/);
  assert.ok(countryBenchmark("Papua New Guinea"));
});

test("carries an independent cross-check where one exists", () => {
  // Singapore's average sits at the ceiling of the second source's range,
  // which is exactly the kind of disagreement worth showing rather than
  // averaging away.
  const sg = countryBenchmark("Singapore");
  assert.match(sg!.crosscheck!, /\$55k-\$90k/);
  assert.match(sg!.salary.evidence!, /Cross-check/);
  // Peru's own average is contradicted by a real posting; say so.
  assert.match(countryBenchmark("Peru")!.crosscheck!, /may be high/);
});

test("reports what a teacher actually keeps, where it is known", () => {
  assert.deepEqual(benchmarkSavings("Thailand"), [12000, 22000]);
  assert.deepEqual(benchmarkSavings("China"), [15000, 40000]);
  // Not invented for countries where nobody published it.
  assert.equal(benchmarkSavings("Vietnam"), null);
  assert.equal(benchmarkSavings("Nepal"), null);
});

test("matches a country regardless of case or padding", () => {
  assert.ok(countryBenchmark("  thailand  "));
  assert.ok(countryBenchmark("SINGAPORE"));
});

test("carries the range, not just the average", () => {
  // Thailand averages $44k across $17k–$92k. An average without that spread
  // reads as far more precise than it is.
  const hit = countryBenchmark("Thailand");
  assert.ok(hit);
  assert.equal(hit.salary.min, 17000);
  assert.equal(hit.salary.max, 92000);
  assert.ok(hit.salary.max! > hit.salary.min!);
});

test("labels itself as a country average, never as the school's pay", () => {
  const label = BASIS_LABEL["country-benchmark"];
  assert.match(label, /country/i);
  assert.match(label, /self-reported/i);
  const hit = countryBenchmark("Vietnam");
  assert.equal(hit?.salary.basis, "country-benchmark");
  // The evidence names the source and the sample, so the cell can be checked.
  assert.match(hit!.salary.evidence!, /\d+ teachers reporting/);
});

test("the comment fields in the config are not mistaken for countries", () => {
  // The JSON carries "//thin" and "//missing" notes among the entries.
  for (const note of ["//thin", "//missing", "//"]) {
    assert.equal(countryBenchmark(note), null);
  }
});
