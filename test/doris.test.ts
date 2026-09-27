/**
 * The second schools database.
 *
 * Its records carry more than the obvious fields, and the one that needs care
 * is `makesOffer`: it itemises everything a school bills for, so picking a
 * number out of it without reading the label gives you an application fee
 * where you wanted a year's tuition.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { countrySlug, parseCountry, yearlyFees } from "../src/doris.ts";

test("takes yearly tuition and leaves the one-off charges", () => {
  // Real shape: this school lists three charges, all the same amount, and
  // only one of them is what a teacher's pay would track.
  const fees = yearlyFees([
    { name: "Enrollment Fee – enrollment_fee", price: 300000, priceCurrency: "LKR", description: "One-time admission/enrolment" },
    { name: "Application Fee – application_fee", price: 300000, priceCurrency: "LKR", description: "One-time admission/enrolment" },
    { name: "Yearly tuition – yearly_fee", price: 850000, priceCurrency: "LKR", description: "Tuition per year" },
  ]);
  assert.equal(fees.low, 850000);
  assert.equal(fees.high, 850000);
  assert.equal(fees.currency, "LKR");
});

test("spans the range when tuition varies by year group", () => {
  const fees = yearlyFees([
    { name: "Yearly fee — Primary", price: 400000, priceCurrency: "THB", description: "Tuition per year" },
    { name: "Yearly fee — Secondary", price: 780000, priceCurrency: "THB", description: "Tuition per year" },
  ]);
  assert.equal(fees.low, 400000);
  assert.equal(fees.high, 780000);
});

test("returns nothing rather than a misleading figure", () => {
  // Only one-off charges: reporting 300,000 as the fee would overstate a
  // cheap school and understate an expensive one.
  assert.deepEqual(
    yearlyFees([{ name: "Application Fee", price: 300000, description: "One-time admission/enrolment" }]),
    {},
  );
  assert.deepEqual(yearlyFees([]), {});
  assert.deepEqual(yearlyFees(undefined), {});
  assert.deepEqual(yearlyFees("not a list"), {});
  // A zero or negative price is not a fee.
  assert.deepEqual(yearlyFees([{ name: "Yearly fee", price: 0 }]), {});
});

test("reads the school list off a country page", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "ItemList",
    itemListElement: [
      { "@type": "ListItem", item: { name: "Overseas School of Colombo", url: "https://x/1" } },
      { "@type": "ListItem", item: { name: "", url: "https://x/2" } },
      { "@type": "ListItem", item: { name: "Elizabeth Moir School", url: "" } },
    ],
  })}</script>`;
  // Entries missing a name or a link cannot be followed, so they are dropped.
  assert.deepEqual(parseCountry(html), [
    { name: "Overseas School of Colombo", url: "https://x/1" },
  ]);
});

test("builds the country slug this database uses", () => {
  assert.equal(countrySlug("Sri Lanka"), "sri-lanka");
  assert.equal(countrySlug("Papua New Guinea"), "papua-new-guinea");
  assert.equal(countrySlug("Türkiye"), "turkiye");
  assert.equal(countrySlug("Timor-Leste"), "timor-leste");
});
