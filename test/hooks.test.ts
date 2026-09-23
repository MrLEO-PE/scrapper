/**
 * Reading the Principal's name and the two hooks off a school website.
 *
 * These feed a real email sent to a real person, so a wrong answer costs more
 * than no answer. Every rejection case below came from running this against
 * actual school sites — each one produced a confident, wrong result first.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findPeHook, findPrincipal, findSchoolHook } from "../src/enrich/hooks.ts";

const page = (body: string): string => `<html><body>${body}</body></html>`;

test("finds a Principal introduced by title", () => {
  const h = findPrincipal(page("<p>Principal: Mr Charlie Bretherton</p>"), "u", "Hillview School");
  assert.equal(h?.text, "Mr Charlie Bretherton");
});

test("finds a Principal named before the title", () => {
  const h = findPrincipal(page("<p>Mrs Jane Okoro, Head of School</p>"), "u", "Some School");
  assert.equal(h?.text, "Mrs Jane Okoro");
});

test("rejects the school's own name", () => {
  // Real failure: "Principal" next to the school name in a page heading.
  const h = findPrincipal(
    page("<h1>Principal: Hillview International School</h1>"),
    "u",
    "Hillview International School",
  );
  assert.equal(h, null);
});

test("rejects page furniture that looks like a name", () => {
  // All three appeared on real sites.
  for (const body of [
    "<h2>Principal’s Perspective</h2>",
    "<p>Principal: Welcome Message</p>",
    "<p>Principal: Head of Primary</p>",
  ]) {
    assert.equal(findPrincipal(page(body), "u", "A School"), null, body);
  }
});

test("rejects a job title mistaken for a surname", () => {
  // Real failure: "Deepa Hitange Coordinators" was returned as a person.
  const h = findPrincipal(page("<p>Deepa Hitange Coordinators, Principal</p>"), "u", "An Academy");
  assert.equal(h, null);
});

test("finds a concrete school fact", () => {
  const first = findSchoolHook(
    page("<p>CHIS became the first school in Johor Bahru to earn IPC accreditation.</p>"),
    "u",
  );
  assert.match(first?.text ?? "", /first school in Johor Bahru/);

  const accredited = findSchoolHook(page("<p>We are accredited by CIS and NEASC.</p>"), "u");
  assert.match(accredited?.text ?? "", /accredited by CIS/);
});

test("does not end a school fact mid-word", () => {
  // Real failure: "...accredited to offer the Primary Yea".
  const h = findSchoolHook(
    page("<p>Accredited by the International Baccalaureate Organisation to offer the Primary Years Programme</p>"),
    "u",
  );
  assert.ok(h);
  assert.doesNotMatch(h!.text, /\bYea$/);
  // Never ends on a dangling connective either.
  assert.doesNotMatch(h!.text, /\s(?:and|the|to|of|for)$/i);
});

test("finds a concrete PE fact", () => {
  const pool = findPeHook(page("<p>Facilities include an Olympic-size swimming pool.</p>"), "u");
  assert.match(pool?.text ?? "", /swimming pool/);

  const league = findPeHook(page("<p>Our teams compete in the Bangkok International Schools League.</p>"), "u");
  assert.match(league?.text ?? "", /Bangkok International Schools League/);
});

test("rejects a PE hook too generic to be worth saying", () => {
  // "your co-curricular activities" could be written about any school, and
  // reads as a form letter.
  assert.equal(findPeHook(page("<p>We offer co-curricular activities.</p>"), "u"), null);
});

test("returns nothing rather than guessing", () => {
  const empty = page("<p>Welcome to our school. We look forward to meeting you.</p>");
  assert.equal(findPrincipal(empty, "u", "A School"), null);
  assert.equal(findSchoolHook(empty, "u"), null);
  assert.equal(findPeHook(empty, "u"), null);
});
