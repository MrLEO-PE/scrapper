/**
 * Group careers sites (SAP SuccessFactors).
 *
 * These feeds name the employing school in a `facility` field, which is what
 * the whole school profile hangs off. When that field holds something that is
 * not a school, a junk school record enters the directory and stays there.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { schoolNameFor } from "../src/sources/successfactors.ts";

test("uses the facility as the school name", () => {
  assert.equal(
    schoolNameFor("The British International School Shanghai", "Nord Anglia Education"),
    "The British International School Shanghai",
  );
});

test("falls back to the group when a region is given instead of a school", () => {
  // Real case: a Nord Anglia PE role listed its facility as "Europe", which
  // became a school called "Europe" with no country sitting in the directory.
  for (const region of ["Europe", "Middle East", "APAC", " asia ", "Multiple Locations"]) {
    assert.equal(
      schoolNameFor(region, "Nord Anglia Education"),
      "Nord Anglia Education",
      `"${region}" should not be treated as a school`,
    );
  }
});

test("falls back to the group when the facility is missing or blank", () => {
  for (const empty of [undefined, "", "   "]) {
    assert.equal(schoolNameFor(empty, "Inspired Education"), "Inspired Education");
  }
});

test("keeps a school whose name merely contains a region word", () => {
  // The veto is an exact match, so these must survive it.
  for (const name of ["European School of Madrid", "Asia Pacific International School"]) {
    assert.equal(schoolNameFor(name, "Group"), name);
  }
});
