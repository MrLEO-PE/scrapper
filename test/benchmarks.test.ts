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
import { benchmarkAverage, countryBenchmark } from "../src/enrich/benchmarks.ts";
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
  for (const thin of ["Guatemala", "Laos", "Fiji", "Australia", "Pakistan"]) {
    assert.equal(countryBenchmark(thin), null, `${thin} is below the report threshold`);
  }
});

test("says nothing for a country with no data at all", () => {
  for (const missing of ["Nepal", "Bhutan", "Costa Rica", "Mozambique", "Tuvalu"]) {
    assert.equal(countryBenchmark(missing), null);
  }
  assert.equal(countryBenchmark(null), null);
  assert.equal(countryBenchmark(undefined), null);
  assert.equal(countryBenchmark(""), null);
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
