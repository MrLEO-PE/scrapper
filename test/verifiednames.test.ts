/**
 * Names a person has confirmed. A greeting uses a name only if it is here, and
 * only while the confirmation is current.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { expiredFor, forgetVerified, recordVerified, verifiedFor } from "../src/export/verifiednames.ts";

const path = join(mkdtempSync(join(tmpdir(), "vn-")), "verified.json");
const day = 86_400_000;

test("a name is used once it is recorded, with its source and date", () => {
  assert.equal(verifiedFor("kellett|hk", Date.now(), path), undefined);
  const e = recordVerified("kellett|hk", "  Dr Jane Smith ", "https://kellett.edu.hk/about", path);
  assert.equal(e.name, "Dr Jane Smith");
  assert.equal(e.verifiedOn, new Date().toISOString().slice(0, 10));
  assert.equal(verifiedFor("kellett|hk", Date.now(), path)?.source, "https://kellett.edu.hk/about");
});

test("a confirmation expires after nine months and is then not used", () => {
  const later = Date.now() + 300 * day;
  assert.equal(verifiedFor("kellett|hk", later, path), undefined);
  assert.equal(verifiedFor("kellett|hk", Date.now() + 200 * day, path)?.name, "Dr Jane Smith");
  // The expired one is still reported, so it can be renewed rather than found again.
  assert.equal(expiredFor("kellett|hk", path), undefined, "still current today");
});

test("nothing is verified for a school that was never confirmed, or has no key", () => {
  assert.equal(verifiedFor("other|uk", Date.now(), path), undefined);
  assert.equal(verifiedFor(null, Date.now(), path), undefined);
  assert.equal(verifiedFor("", Date.now(), path), undefined);
});

test("a name can be withdrawn", () => {
  assert.equal(forgetVerified("kellett|hk", path), true);
  assert.equal(verifiedFor("kellett|hk", Date.now(), path), undefined);
  assert.equal(forgetVerified("kellett|hk", path), false);
});
