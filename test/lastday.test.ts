/**
 * The Last Day column.
 *
 * Deadlines were spread across three raw columns — a date on the job sheet, a
 * day count beside it, a different date on the schools sheet — each of which
 * made you do a piece of arithmetic the sheet could do for you. This is the
 * one cell that answers "how long have I got".
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { daysUntil, lastDay } from "../src/export/fields.ts";

const inDays = (n: number): string => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

test("leads with the warning when a deadline is close", () => {
  assert.match(lastDay(inDays(0)), /^TODAY/);
  assert.match(lastDay(inDays(1)), /^TOMORROW/);
  assert.match(lastDay(inDays(3)), /^3 days/);
  assert.match(lastDay(inDays(7)), /^7 days/);
});

test("leads with the date when there is time", () => {
  // Three weeks out, the date is what you want; the count is the footnote.
  const cell = lastDay(inDays(21));
  assert.match(cell, /^\d{1,2} \w{3} \(21 days\)$/);
});

test("says so when the date has passed", () => {
  assert.match(lastDay(inDays(-2)), /^closed /);
});

test("an unstated deadline is a warning, not a blank", () => {
  // Half of adverts publish no closing date, and an empty cell reads as "no
  // rush" when the opposite is true: these posts close once filled.
  const cell = lastDay(null, true);
  assert.match(cell, /not stated/);
  assert.match(cell, /once filled/);
});

test("a school with no vacancy at all stays empty", () => {
  // Nothing to say, as opposed to something worrying to say.
  assert.equal(lastDay(null, false), "");
  assert.equal(lastDay(undefined, false), "");
  assert.equal(lastDay(""), "");
});

test("survives a date the board wrote badly", () => {
  assert.equal(lastDay("not a date", true), "");
  assert.equal(lastDay("0000-00-00", true), "");
});

test("always carries the actual date, not only the count", () => {
  // So the cell can be acted on without opening the advert.
  for (const n of [0, 1, 3, 30]) {
    assert.match(lastDay(inDays(n)), /\d{1,2} \w{3}/, `day ${n} should name the date`);
  }
});

test("counts dates, not elapsed hours", () => {
  // A deadline late tonight is still today. Dividing the millisecond gap by 24
  // hours made it 1, so a role closing today was labelled "tomorrow" — on the
  // one row where getting it wrong costs you the application.
  const tonight = new Date();
  tonight.setHours(23, 59, 0, 0);
  assert.equal(daysUntil(tonight.toISOString()), 0);
  assert.match(lastDay(tonight.toISOString()), /^TODAY/);

  // And one just after midnight is tomorrow, not today.
  const justAfterMidnight = new Date();
  justAfterMidnight.setDate(justAfterMidnight.getDate() + 1);
  justAfterMidnight.setHours(0, 1, 0, 0);
  assert.equal(daysUntil(justAfterMidnight.toISOString()), 1);

  assert.equal(daysUntil(null), null);
  assert.equal(daysUntil("not a date"), null);
});
