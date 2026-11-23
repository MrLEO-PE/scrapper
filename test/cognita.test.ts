/**
 * Cognita.
 *
 * Read through its Cornerstone search. Pinned here: the token is found in the
 * career page's embedded state, Cornerstone's day-first dates become ISO, and
 * the vacancy URL is the career site's own requisition link.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isoDate, tokenFrom, toRawJob } from "../src/sources/cognita.ts";

test("finds the anonymous token in the career page", () => {
  assert.equal(tokenFrom(`<script>window.csod={"token":"eyJhbGc.eyJzdWI.sig","x":1}</script>`), "eyJhbGc.eyJzdWI.sig");
  assert.equal(tokenFrom("<html>no token here</html>"), undefined);
});

test("day-first dates become ISO", () => {
  assert.equal(isoDate("25/11/2026"), "2026-11-25");
  assert.equal(isoDate("2026-11-25"), "2026-11-25");
  assert.equal(isoDate(undefined), undefined);
});

test("maps a requisition to a vacancy", () => {
  const job = toRawJob({
    requisitionId: 3290,
    displayJobTitle: "Head of PE ",
    postingEffectiveDate: "01/11/2026",
    postingExpirationDate: "30/11/2026",
    locations: [{ city: "Singapore", country: "sg" }],
  })!;
  assert.equal(job.url, "https://cognitapeople.csod.com/ux/ats/careersite/1/home/requisition/3290?c=cognitapeople");
  assert.equal(job.title, "Head of PE");
  assert.equal(job.country, "SG");
  assert.equal(job.city, "Singapore");
  assert.equal(job.postedAt, "2026-11-01");
  assert.equal(job.deadlineAt, "2026-11-30");
});
