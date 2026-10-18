import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addressesFor, loadAddressBook, recordAddresses, resetAddressBook } from "../src/addressbook.ts";

const fresh = () => {
  resetAddressBook();
  return join(mkdtempSync(join(tmpdir(), "book-")), "book.jsonl");
};

test("an address is written once, however often it is seen", () => {
  const p = fresh();
  assert.equal(recordAddresses("s|x", ["HR@School.edu", "info@school.edu"], "crawl", p), 2);
  assert.equal(recordAddresses("s|x", ["hr@school.edu"], "crawl", p), 0);
  assert.equal(readFileSync(p, "utf8").trim().split("\n").length, 2);
});

test("a later crawl that finds fewer addresses removes nothing", () => {
  const p = fresh();
  recordAddresses("s|x", ["ism-recruit@school.edu", "admission@school.edu", "principal@school.edu"], "crawl 1", p);
  recordAddresses("s|x", ["admission@school.edu"], "crawl 2", p); // the second crawl only re-found one
  resetAddressBook();
  assert.deepEqual(addressesFor("s|x", p).map((a) => a.e).sort(), ["admission@school.edu", "ism-recruit@school.edu", "principal@school.edu"]);
});

test("things that only look like addresses are not recorded", () => {
  const p = fresh();
  assert.equal(recordAddresses("s|x", ["logo@2x.png", "john.doe@example.com", "not an email", "a@b", null, undefined, ""], "crawl", p), 0);
});

test("a damaged line, or a missing file, does not lose the rest", () => {
  const p = fresh();
  assert.equal(loadAddressBook(p).size, 0);
  recordAddresses("s|x", ["a@school.edu"], "crawl", p);
  appendFileSync(p, "{broken\n");
  resetAddressBook();
  assert.equal(addressesFor("s|x", p).length, 1);
});
