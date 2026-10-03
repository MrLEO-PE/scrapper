/**
 * Currency conversion.
 *
 * Every salary and every tuition figure needs to land in USD so one school
 * can be weighed against another regardless of what it quotes in. These tests
 * run entirely on the fallback table — no network — so they are deterministic
 * and do not depend on today's actual exchange rates.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resetFxForTests, toUsd, rateFor, fxStatus } from "../src/enrich/fx.ts";

test.beforeEach(() => resetFxForTests());

test("converts a known currency to USD", () => {
  const usd = toUsd(280_000, "CNY");
  assert.ok(usd !== null && usd > 30_000 && usd < 50_000, `280,000 CNY -> ${usd}`);
});

test("USD converts to itself", () => {
  assert.equal(toUsd(40_000, "USD"), 40_000);
});

test("is not case-sensitive about the currency code", () => {
  assert.equal(toUsd(100, "usd"), 100);
  assert.notEqual(rateFor("cny"), null);
});

test("returns null rather than inventing a rate for an unknown currency", () => {
  assert.equal(toUsd(1000, "ZZZ"), null);
  assert.equal(rateFor("ZZZ"), null);
  assert.equal(toUsd(1000, undefined), null);
  assert.equal(toUsd(1000, null), null);
});

test("every currency seen in the scraped data converts", () => {
  const seen = [
    "USD", "EUR", "GBP", "CNY", "MYR", "THB", "PHP", "JPY", "VND", "KRW",
    "SGD", "INR", "IDR", "NZD", "AUD", "TWD", "COP", "PEN", "MVR", "UZS",
    "CRC", "TRY", "KHR", "MMK", "BDT", "LKR", "HKD", "KES", "NPR", "BTN",
    "PKR", "TZS", "DOP", "GTQ",
  ];
  for (const c of seen) assert.notEqual(toUsd(1000, c), null, `${c} should convert`);
});

test("every currency the advert-text parser can recognise also converts", () => {
  // These are in enrich/salary.ts's own CURRENCY table — mostly Gulf
  // currencies — and had not yet appeared in a stored figure when the
  // fallback table above was built. A school quoting one must still convert.
  for (const c of ["AED", "QAR", "SAR", "OMR", "KWD", "BHD", "CHF", "BRL", "MXN", "ZAR"]) {
    assert.notEqual(toUsd(1000, c), null, `${c} should convert`);
  }
});

test("reports which table is in use", () => {
  // Without a live fetch having run, the dated fallback table is what every
  // conversion rests on — the sheet should be able to say so.
  assert.equal(fxStatus().source, "fallback");
  assert.equal(fxStatus().fetchedAt, null);
});
