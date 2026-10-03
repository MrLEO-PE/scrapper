/**
 * Reading pay out of prose, and refusing to invent a market rate.
 *
 * International schools overwhelmingly advertise "competitive" and no figure —
 * 6 of 85 open roles publish a number — so the few that exist matter, and a
 * wrong one matters more. Every figure has to survive being asked "says who?".
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MIN_SCHOOLS_FOR_BENCHMARK,
  benchmark,
  describeBasis,
  extractSalaryFromText,
} from "../src/enrich/salary.ts";

test("reads a range with the currency in front", () => {
  const s = extractSalaryFromText("The salary range is AED 15,000 - 18,000 per month, tax free.", "advert-text");
  assert.equal(s?.currency, "AED");
  assert.equal(s?.min, 15000);
  assert.equal(s?.max, 18000);
  assert.equal(s?.period, "MONTHLY");
});

test("reads a range with the currency after", () => {
  const s = extractSalaryFromText("Teachers earn 15,000 - 22,000 THB monthly.", "advert-text");
  assert.equal(s?.currency, "THB");
  assert.equal(s?.min, 15000);
});

test("handles the European decimal convention", () => {
  // "3.301" is three thousand three hundred and one, not three point three.
  const s = extractSalaryFromText("Salary scale from € 3.301 to € 5.277 per month.", "job-pack");
  assert.equal(s?.min, 3301);
  assert.equal(s?.max, 5277);
  assert.equal(s?.currency, "EUR");
});

test("reads a single figure with a period", () => {
  const s = extractSalaryFromText("Monthly salary of QAR 12,000 with accommodation.", "advert-text");
  assert.equal(s?.min, 12000);
  assert.equal(s?.period, "MONTHLY");
  assert.equal(s?.max, undefined);
});

test("does not mistake other numbers for pay", () => {
  for (const text of [
    "The school has 1,900 students across two campuses.",
    "Founded in 1975, the school serves 850 pupils.",
    "Telephone +971 4 1234567 for details.",
    "A competitive salary and benefits package.",
    "Our campus covers 25,000 square metres.",
  ]) {
    assert.equal(extractSalaryFromText(text, "advert-text"), null, text);
  }
});

test("refuses a benchmark from too few schools", () => {
  const two = [
    { schoolKey: "a", salary: { min: 15000, max: 18000, currency: "AED", period: "MONTHLY" } },
    { schoolKey: "b", salary: { min: 16000, max: 19000, currency: "AED", period: "MONTHLY" } },
  ];
  assert.ok(MIN_SCHOOLS_FOR_BENCHMARK > 2);
  assert.equal(benchmark(two), null);
});

test("refuses a benchmark built from one group's pay scale", () => {
  // Real case: three BASIS schools all advertise exactly USD 55,000-65,000.
  // Three schools, but one scale — that is one data point, not a market.
  const sameScale = ["basis-shenzhen", "basis-guangzhou", "basis-bilingual"].map((schoolKey) => ({
    schoolKey,
    salary: { min: 55000, max: 65000, currency: "USD", period: "ANNUALLY" },
  }));
  assert.equal(benchmark(sameScale), null);
});

test("builds a benchmark from genuinely different schools", () => {
  const spread = [
    { schoolKey: "a", salary: { min: 15000, max: 18000, currency: "AED", period: "MONTHLY" } },
    { schoolKey: "b", salary: { min: 17000, max: 20000, currency: "AED", period: "MONTHLY" } },
    { schoolKey: "c", salary: { min: 19000, max: 22000, currency: "AED", period: "MONTHLY" } },
  ];
  const b = benchmark(spread);
  assert.equal(b?.basis, "benchmark");
  assert.equal(b?.schools, 3);
  assert.equal(b?.min, 17000);
  assert.equal(b?.max, 20000);
});

test("never averages different currencies or periods together", () => {
  const mixed = [
    { schoolKey: "a", salary: { min: 15000, currency: "AED", period: "MONTHLY" } },
    { schoolKey: "b", salary: { min: 40000, currency: "GBP", period: "ANNUALLY" } },
    { schoolKey: "c", salary: { min: 60000, currency: "USD", period: "ANNUALLY" } },
  ];
  // One school per currency/period group, so nothing reaches the threshold.
  assert.equal(benchmark(mixed), null);
});

test("states what a figure is, and on what evidence", () => {
  assert.equal(describeBasis({ basis: "advert", samples: 1 }), "this advert");
  assert.match(describeBasis({ basis: "school-avg", samples: 3 }), /average.*3 adverts/);
  assert.match(describeBasis({ basis: "benchmark", samples: 5, schools: 4 }), /benchmark.*4 schools/);
  assert.equal(describeBasis(null), "");
});

import { annualMultiplier, salaryToUsd, salaryToUsdAverage } from "../src/enrich/salary.ts";
import { resetFxForTests } from "../src/enrich/fx.ts";

test.beforeEach(() => resetFxForTests());

test("annualises an undated figure and a monthly one, refuses the rest", () => {
  // Undated is the common case in this data and is treated as already annual.
  assert.equal(annualMultiplier(undefined), 1);
  assert.equal(annualMultiplier("ANNUALLY"), 1);
  assert.equal(annualMultiplier("annual"), 1);
  assert.equal(annualMultiplier("MONTHLY"), 12);
  // A weekly, daily or hourly rate could mean a 5-day week or a 6-day one,
  // term-time or year-round — guessing a multiplier would put a confidently
  // wrong annual figure next to a real one.
  assert.equal(annualMultiplier("WEEKLY"), null);
  assert.equal(annualMultiplier("DAILY"), null);
  assert.equal(annualMultiplier("HOURLY"), null);
});

test("converts a monthly salary to an annual USD figure", () => {
  const usd = salaryToUsd({ min: 15000, max: 18000, currency: "AED", period: "MONTHLY" });
  assert.ok(usd, "should convert");
  // 15,000 AED/month * 12 ≈ 49,000 USD/year, give or take the day's rate.
  assert.ok(usd!.min! > 40_000 && usd!.min! < 60_000, `min -> ${usd!.min}`);
  assert.ok(usd!.max! > usd!.min!, "max should exceed min");
});

test("refuses to convert a salary with no safely annualisable period", () => {
  assert.equal(salaryToUsd({ min: 500, currency: "USD", period: "WEEKLY" }), null);
});

test("refuses to convert when the currency is not recognised", () => {
  assert.equal(salaryToUsd({ min: 40000, currency: "ZZZ" }), null);
});

test("a figure with no numbers at all has nothing to convert", () => {
  assert.equal(salaryToUsd({ text: "competitive" }), null);
  assert.equal(salaryToUsd(null), null);
  assert.equal(salaryToUsd(undefined), null);
});

test("averages min and max into one comparable figure", () => {
  const avg = salaryToUsdAverage({ min: 40000, max: 60000, currency: "USD" });
  assert.equal(avg, 50000);
  // A single-ended figure still gives a usable average.
  assert.equal(salaryToUsdAverage({ min: 40000, currency: "USD" }), 40000);
  assert.equal(salaryToUsdAverage(null), null);
});
