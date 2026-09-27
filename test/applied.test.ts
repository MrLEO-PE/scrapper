/**
 * The Applied tick.
 *
 * The first column of a long list should answer the question you ask most
 * often while scanning it: have I already dealt with this one? A tick and a
 * date answer it without reading anything else.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveFields, type FieldContext } from "../src/export/fields.ts";
import type { JobRow } from "../src/store/db.ts";

const field = resolveFields(["applied"], "job")[0]!;

const job = (over: Partial<JobRow>): FieldContext =>
  ({ job: { id: "j", my_status: null, my_status_at: null, ...over } as JobRow });

test("a confirmed application shows a tick and the date", () => {
  const cell = field.get(job({ my_status: "applied", my_status_at: "2026-09-21T10:00:00.000Z" }));
  assert.match(cell, /^✅/);
  assert.match(cell, /21 Sep/);
});

test("a stage past applied names itself and keeps the tick", () => {
  // An interview is an application you sent and then heard back about, so the
  // tick still belongs — but the stage is the more useful word.
  const cell = field.get(job({ my_status: "interview", my_status_at: "2026-09-21T10:00:00.000Z" }));
  assert.match(cell, /^✅/);
  assert.match(cell, /Interview/);
});

test("intending to apply is not applying", () => {
  // "Interested" is a bookmark and "Not for me" is a decision not to apply.
  // Ticking either would tell you a role is dealt with when it is not.
  for (const s of ["interested", "skip"]) {
    assert.equal(field.get(job({ my_status: s, my_status_at: "2026-09-21T10:00:00.000Z" })), "");
  }
  assert.equal(field.get(job({})), "");
  assert.equal(field.get({}), "");
});

test("a tick survives a missing or unreadable date", () => {
  // The date is worth having; the tick is the part that must not be lost.
  assert.equal(field.get(job({ my_status: "applied" })), "✅");
  assert.equal(field.get(job({ my_status: "applied", my_status_at: "not a date" })), "✅");
});
