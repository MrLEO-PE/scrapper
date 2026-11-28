/**
 * Workday: school, country and city from a posting's location text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLocations } from "../src/sources/workday.ts";

test("ISP's 'School, Country, City'", () => {
  assert.deepEqual(splitLocations("APS International, Malaysia, Kuala Lumpur"), { school: "APS International", country: "Malaysia", city: "Kuala Lumpur" });
});

test("ESF's 'School, District' in a one-country group", () => {
  assert.deepEqual(splitLocations("Island School, Hong Kong Island", "Hong Kong"), { school: "Island School", country: "Hong Kong", city: "Hong Kong Island" });
  assert.deepEqual(splitLocations(undefined, "Hong Kong"), { country: "Hong Kong" });
});

test("'2 Locations' is not a school", () => {
  assert.deepEqual(splitLocations("2 Locations"), {});
  assert.deepEqual(splitLocations("3 Locations", "Hong Kong"), { country: "Hong Kong" });
});
