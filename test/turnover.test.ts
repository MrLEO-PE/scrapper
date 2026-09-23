/**
 * Turnover signal.
 *
 * A school that keeps re-advertising PE posts is worth a second look, but the
 * signal is easy to get wrong: on a database that has only been running a
 * fortnight, two postings is noise, not a pattern. The important behaviour is
 * therefore refusing to judge too early.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { turnoverLabel } from "../src/export/fields.ts";

const watched = (postings: number, monthsObserved: number) => ({
  postings,
  monthsObserved,
  firstSeen: new Date(Date.now() - monthsObserved * 30.44 * 86_400_000).toISOString(),
});

test("says nothing before it has watched long enough", () => {
  // A new database: everything looks like a burst.
  assert.equal(turnoverLabel(watched(3, 0.02)), "");
  assert.equal(turnoverLabel(watched(5, 2)), "");
  // Just under the threshold is still silence.
  assert.equal(turnoverLabel(watched(10, 5.9)), "");
});

test("rates a school once there is enough history", () => {
  // 6 postings in a year is a lot for one PE department.
  assert.equal(turnoverLabel(watched(6, 12)), "High");
  // Two a year: some churn.
  assert.equal(turnoverLabel(watched(2, 12)), "Moderate");
  // One a year, or less: people are staying.
  assert.equal(turnoverLabel(watched(1, 12)), "Low");
  assert.equal(turnoverLabel(watched(1, 24)), "Low");
});

test("scales by how long it watched, not raw count", () => {
  // Three postings across three years is calm; across six months is not.
  assert.equal(turnoverLabel(watched(3, 36)), "Low");
  assert.equal(turnoverLabel(watched(3, 6)), "High");
});

test("handles a school with no history", () => {
  assert.equal(turnoverLabel(undefined), "");
});
