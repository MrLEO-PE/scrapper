/**
 * Email discovery and ranking.
 *
 * The "Career Email" column is the single most valuable cell in the sheet, so
 * the rules that pick it are worth pinning down: a recruitment address must
 * beat a general inbox, obfuscated addresses must still be found, and template
 * or tracking junk must never reach the output.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  bestCareerEmail,
  bestSchoolEmail,
  domainOf,
  extractEmails,
  mergeEmails,
} from "../src/enrich/email.ts";

test("finds plain addresses in prose", () => {
  const found = extractEmails(
    "Applications to recruitment@school.ae or call us. General: info@school.ae",
    "https://school.ae/careers",
    "html",
  );
  const addresses = found.map((e) => e.email).sort();
  assert.deepEqual(addresses, ["info@school.ae", "recruitment@school.ae"]);
});

test("sees through common obfuscation", () => {
  for (const raw of [
    "careers (at) school (dot) ae",
    "careers [at] school [dot] ae",
    "careers&#64;school.ae",
  ]) {
    const found = extractEmails(raw, "page", "html");
    assert.equal(found[0]?.email, "careers@school.ae", `failed on: ${raw}`);
  }
});

test("classifies recruitment addresses above general ones", () => {
  const found = extractEmails(
    "recruitment@s.ae hr@s.ae info@s.ae reception@s.ae j.smith@s.ae",
    "page",
    "html",
  );
  const kind = (email: string) => found.find((e) => e.email === email)?.kind;
  assert.equal(kind("recruitment@s.ae"), "careers");
  assert.equal(kind("hr@s.ae"), "hr");
  assert.equal(kind("info@s.ae"), "info");
  assert.equal(kind("reception@s.ae"), "admin");
});

test("drops junk and non-contact addresses", () => {
  const found = extractEmails(
    "no-reply@school.ae postmaster@school.ae logo@2x.png hello@example.com support@wix.com real@school.ae",
    "page",
    "html",
  );
  const addresses = found.map((e) => e.email);
  assert.ok(addresses.includes("real@school.ae"));
  for (const junk of ["no-reply@school.ae", "postmaster@school.ae", "hello@example.com"]) {
    assert.ok(!addresses.includes(junk), `${junk} should have been dropped`);
  }
});

test("picks the recruitment address as the career email", () => {
  const found = extractEmails("info@school.ae admin@school.ae careers@school.ae", "page", "html");
  assert.equal(bestCareerEmail(found, "school.ae")?.email, "careers@school.ae");
});

test("prefers an address on the school's own domain", () => {
  const found = mergeEmails(
    extractEmails("recruitment@agency.com", "page", "html"),
    extractEmails("recruitment@school.ae", "page", "html"),
  );
  assert.equal(bestCareerEmail(found, "school.ae")?.email, "recruitment@school.ae");
});

test("returns nothing rather than guessing when no careers address exists", () => {
  const found = extractEmails("info@school.ae reception@school.ae", "page", "html");
  assert.equal(bestCareerEmail(found, "school.ae"), undefined);
  // The general inbox still belongs in the School Email column.
  assert.equal(bestSchoolEmail(found, "school.ae")?.email, "info@school.ae");
});

test("a careers page lifts an otherwise generic address", () => {
  const onCareers = extractEmails("apply@school.ae", "https://school.ae/vacancies", "html")[0]!;
  const onHome = extractEmails("apply@school.ae", "https://school.ae/", "html")[0]!;
  assert.ok(onCareers.score > onHome.score);
});

test("an address found in a job pack outranks the same one in page text", () => {
  const fromPdf = extractEmails("jobs@school.ae", "https://school.ae/pack.pdf", "pdf")[0]!;
  const fromHtml = extractEmails("jobs@school.ae", "https://school.ae/about", "html")[0]!;
  assert.ok(fromPdf.score > fromHtml.score);
});

test("merge keeps the highest-scoring instance of each address", () => {
  const merged = mergeEmails(
    extractEmails("jobs@school.ae", "https://school.ae/about", "html"),
    extractEmails("jobs@school.ae", "https://school.ae/pack.pdf", "pdf"),
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.via, "pdf");
});

test("reads the domain from a website URL", () => {
  assert.equal(domainOf("https://www.school.ae/careers"), "school.ae");
  assert.equal(domainOf("school.ae"), "school.ae");
  assert.equal(domainOf(undefined), undefined);
});
