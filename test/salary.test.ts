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

test("refuses an application fee, deposit, or registration charge", () => {
  // Real text from scraped school pages. Each one has a currency code next
  // to a plausible-looking number — the same shape a salary has — so only
  // the surrounding words tell them apart. All 58 of these were found stored
  // as a school's "own salary" before this guard existed.
  for (const text of [
    "An application fee of THB 3,000 will be collected to process your application",
    "pay the RMB 2,000 non-refundable application fee",
    "upon payment of a THB 50,000 deposit, which will be credited",
    "Registration Fee: RM 1,000 Payable upon acceptance and is non-refundable",
    "the family pays the US$ 1,500 Slot Reservation Deposit",
    "A non-refundable one-time payment of JPY 300,000 immediately upon acceptance",
    "Enrolment Fee Toddler – Pre-K: $750 KG – Grade 12: $1500",
    "Graduation Fee 3,500 THB Seniors only",
  ]) {
    assert.equal(extractSalaryFromText(text, "school-site"), null, text);
  }
});

test("refuses a tuition instalment or late-payment charge", () => {
  for (const text of [
    "Non-refundable and one time payment only THB 60,000 THB 120,000 Tuition Fees (per term)",
    "will incur late payment charges. Late payment charge[s] include: THB 2,000 once a term",
    "Instalment Schedule Amount $671.00 Confirmation Fees $783.00",
  ]) {
    assert.equal(extractSalaryFromText(text, "school-site"), null, text);
  }
});

test("refuses a bank transfer instruction", () => {
  // A real case: "USD Account: 130-910011-30438" was read as a $910,032
  // annual salary.
  const text = "Account Owner: Korea Foreign School KRW Account: 130-910032-00304 USD Account: 130-910011-30438 SWIFT Code: KOEXKRSE";
  assert.equal(extractSalaryFromText(text, "school-site"), null);
});

test("refuses a uniform or textbook price", () => {
  for (const text of [
    "School Uniform: $1,700 - $1,900 Incidental Charges",
    "Textbook Fee (pay direct to supplier) $500-$1500",
  ]) {
    assert.equal(extractSalaryFromText(text, "school-site"), null, text);
  }
});

test("recognises a period written with a slash, not just the word", () => {
  // "JPY 1,200–1,500/hour" matched no period word at all before this fix —
  // "/hour" is not "per hour" or "hourly" — so it fell back to "no period
  // stated" and was accepted as an annual salary of about a thousand yen.
  const hourly = extractSalaryFromText("Salary JPY 1,200–1,500/hour depending on experience", "school-site");
  assert.equal(hourly, null, "an hourly rate this low must be read as hourly and then refused, not annual");

  const monthly = extractSalaryFromText("AED 15,000-18,000/month, tax free", "advert-text");
  assert.equal(monthly?.period, "MONTHLY");
});

test("an unlabelled figure must clear the annual floor, not just a token minimum", () => {
  // The old bound for "no period stated" was 500 to 1,500,000 — wide enough
  // that almost any fee or deposit number passed it. A real, if unusual,
  // annual salary with no period word should still be read; a number that
  // does not even reach a plausible year's pay should not be guessed at.
  assert.equal(extractSalaryFromText("the salary is USD 45,000 to 60,000, negotiable", "advert-text")?.min, 45000);
  assert.equal(extractSalaryFromText("a salary of USD 2,000 to 3,000 is offered", "advert-text"), null);
});
