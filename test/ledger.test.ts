/**
 * The permanent application record. It must outlive the database and the
 * browser, so the tests are about history staying true: undo is a later event,
 * a re-posted role is still the same position, and a bad line costs nothing.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendLedger, findApplied, findSkipped, historyFor, ledgerState, readLedger, type LedgerEntry } from "../src/ledger.ts";

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  at: "2026-08-12T10:00:00Z",
  event: "applied",
  job_id: "tes:1",
  dedupe_key: "harbour-pine|china::pe-teacher",
  school_key: "harbour-pine|china",
  school: "Harbour Pine",
  title: "PE Teacher",
  ...over,
});

const tmp = () => join(mkdtempSync(join(tmpdir(), "ledger-")), "applications.jsonl");

test("appends, never rewrites, and reads back in order", () => {
  const p = tmp();
  appendLedger([entry({ at: "2026-09-01T00:00:00Z", job_id: "tes:2", dedupe_key: "k2" })], p);
  appendLedger([entry({})], p);
  const all = readLedger(p);
  assert.equal(all.length, 2);
  assert.equal(all[0]!.job_id, "tes:1");
});

test("undo is a later event, and history is kept", () => {
  const s = ledgerState([entry({}), entry({ event: "unapplied", at: "2026-08-13T00:00:00Z" })]);
  assert.equal(s.applied.size, 0);
  const again = ledgerState([entry({}), entry({ event: "unapplied", at: "2026-08-13T00:00:00Z" }), entry({ at: "2026-08-14T00:00:00Z" })]);
  assert.equal(again.applied.size, 1);
});

test("a re-posted role under a new advert id is still the same position", () => {
  const s = ledgerState([entry({})]);
  assert.match(historyFor(s, "harbour-pine|china", { dedupe_key: "harbour-pine|china::pe-teacher", title: "PE Teacher" }), /^SAME ROLE — applied 1×/);
  // A different position at the same school shows the history, not the warning.
  const other = historyFor(s, "harbour-pine|china", { dedupe_key: "harbour-pine|china::head-of-pe", title: "Head of PE" });
  assert.match(other, /^applied 1×/);
  assert.doesNotMatch(other, /SAME ROLE/);
  assert.equal(historyFor(s, "another-school|uk", { dedupe_key: "x", title: "PE Teacher" }), "");
});

test("applying to a role you had skipped removes the skip, and a skip never overrides an application", () => {
  const skipped = entry({ event: "skipped" });
  assert.equal(ledgerState([skipped]).skipped.size, 1);
  assert.equal(ledgerState([skipped, entry({ at: "2026-08-13T00:00:00Z" })]).skipped.size, 0);
  assert.equal(ledgerState([entry({}), entry({ event: "skipped", at: "2026-08-13T00:00:00Z" })]).skipped.size, 0);
});

test("one damaged line does not take the history down", () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify(entry({})) + "\n{not json\n" + JSON.stringify(entry({ job_id: "tes:2", dedupe_key: "k2" })) + "\n");
  assert.equal(readLedger(p).length, 2);
});

test("a position is recognised however a board words it", () => {
  const s = ledgerState([entry({ title: "Secondary Physical Education (PE) Teacher", dedupe_key: "harbour-pine|china::secondary-physical-education-pe-teacher" })]);
  const reposted = { dedupe_key: "harbour-pine|china::secondary-pe-teacher", school_key: "harbour-pine|china", title: "Secondary PE Teacher" };
  assert.ok(findApplied(s, reposted), "same opening, different wording");
  assert.match(historyFor(s, "harbour-pine|china", reposted), /^SAME ROLE/);
  // A different opening at the same school is not it.
  assert.equal(findApplied(s, { ...reposted, dedupe_key: "k", title: "Head of PE" }), undefined);
  assert.equal(findApplied(s, { ...reposted, dedupe_key: "k", title: "Primary PE Teacher" }), undefined);
  assert.equal(findApplied(s, { ...reposted, dedupe_key: "k", title: "PE Teacher - Maternity Cover" }), undefined);
});

test("a role ruled out is recognised the same way", () => {
  const s = ledgerState([entry({ event: "skipped", title: "Physical Education Teacher (Female)", dedupe_key: "a::pe-female" })]);
  assert.ok(findSkipped(s, { dedupe_key: "a::female-pe-teacher", school_key: "harbour-pine|china", title: "Female PE Teacher" }));
  assert.equal(findSkipped(s, { dedupe_key: "a::pe", school_key: "harbour-pine|china", title: "Physical Education Teacher" }), undefined);
});
