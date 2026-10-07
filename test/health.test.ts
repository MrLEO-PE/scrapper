/**
 * A source that quietly returns nothing looks exactly like a quiet day. The
 * check is relative to each board's own history, so a board that has always
 * been small is never flagged for being small.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { judge } from "../src/health.ts";

const usual = [17, 17, 16, 18, 17, 17];

test("a board that usually returns about 17 and returns 0 is flagged", () => {
  const h = judge("teacherhorizons", { raw: 0, pe: 0 }, usual);
  assert.equal(h.status, "empty");
  assert.match(h.message, /returned 0 vacancies — it usually returns about 17/);
});

test("a board that drops to a fraction of its usual size is flagged as low", () => {
  assert.equal(judge("x", { raw: 4, pe: 0 }, usual).status, "low");
  assert.equal(judge("x", { raw: 12, pe: 0 }, usual).status, "ok");
});

test("a failure is reported as a failure, with its message", () => {
  const h = judge("tes", { raw: 0, pe: 0, failed: "HTTP 503" }, usual);
  assert.equal(h.status, "failed");
  assert.match(h.message, /HTTP 503/);
});

test("a board that has always been tiny is not flagged for returning nothing", () => {
  assert.equal(judge("niche", { raw: 0, pe: 0 }, [1, 0, 2, 1, 0]).status, "ok");
});

test("too little history says nothing", () => {
  assert.equal(judge("new", { raw: 0, pe: 0 }, [20, 20]).status, "new");
});

test("a source that did not run this time is not an error", () => {
  assert.equal(judge("x", undefined, usual).status, "ok");
});
