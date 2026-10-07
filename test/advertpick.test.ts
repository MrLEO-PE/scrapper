/**
 * The advert hook, and where a principal's name came from.
 *
 * The model letter's strongest hook is a real duty from the advert, quoted
 * exactly and answered with something built. These tests hold it to that:
 * quoted never reworded, chosen only when it matches a strength, and boilerplate
 * never mistaken for a duty.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { draftEmail } from "../src/export/email.ts";
import { isStale, monthsAgo, principalSource } from "../src/export/factsource.ts";
import { pickDuty } from "../src/match/advertpick.ts";

const pbiss = `Key duties
● Assess and monitor student progress, providing constructive feedback to support development.
● Plan and deliver engaging PE lessons.
Benefits: competitive salary, housing allowance and flights.`;

test("picks the duty the advert states, exactly as written", () => {
  const d = pickDuty(pbiss)!;
  assert.equal(d.key, "assessment");
  assert.equal(d.sentence, "Assess and monitor student progress, providing constructive feedback to support development");
});

test("events and coaching, and IGCSE, are recognised", () => {
  assert.equal(pickDuty("• Organise and participate in inter-school competitions, tournaments, and sporting events.")?.key, "events");
  assert.equal(pickDuty("● Lead the planning, delivery, and review of the academic PE curriculum (KS3, IGCSE, A-Level/BTEC).")?.key, "igcse");
});

test("boilerplate, benefits and the person specification are never a duty", () => {
  for (const line of [
    "Safeguarding and monitoring of children is everyone's responsibility at our school.",
    "A competitive salary, housing allowance and annual flights are provided.",
    "Demonstrate a strong track record of outstanding teaching and raising achievement.",
    "Continuous professional development and clear pathways for career progression.",
    "PLEASE NOTE THIS VACANCY IS USED TO PROCESS COACHING POSITIONS AT THE SCHOOL.",
    "Direct Reports: Team Coaches, Assistant AD, Head of PE, and assigned Support Staff.",
  ]) assert.equal(pickDuty(line), null, line);
});

test("nothing matching means no hook, never a guess", () => {
  assert.equal(pickDuty("We are a friendly school in a lovely city. Apply by Friday."), null);
  assert.equal(pickDuty(""), null);
  assert.equal(pickDuty(null), null);
});

test("the letter quotes the duty and answers it with the strength that fits", () => {
  const d = draftEmail({ role: "PE Teacher", school: "PBISS International School", advertText: pbiss });
  assert.match(d.body, /One line in your advert stood out: "Assess and monitor student progress, providing constructive feedback to support development\."/);
  assert.match(d.body, /That is the system I have built: clear levels/);
  // The matching strength is the first bullet.
  assert.ok(d.body.indexOf("• PE assessment.") < d.body.indexOf("• Programme and events."));
  assert.equal((d.body.match(/Here is what I would bring:/g) ?? []).length, 1);
  assert.ok(!d.flags.some((f) => /no specific fact/.test(f)));
});

test("a speculative letter never invents an advert line", () => {
  // No advert, so no duty: it falls back to a school fact or to none.
  assert.doesNotMatch(draftEmail({ role: "", school: "X", advertText: null }).body, /One line in your advert/);
});

// --- where a name came from -------------------------------------------------

const seen = new Date().toISOString();

test("reads where a principal's name came from", () => {
  const page = principalSource({ provenance_json: JSON.stringify({ principal: { source: "https://x.edu/leadership" } }), enriched_at: seen });
  assert.equal(page.kind, "school-page");
  assert.equal(principalSource({ provenance_json: JSON.stringify({ principal: { source: "job advert" } }), enriched_at: seen }).kind, "advert");
  assert.equal(principalSource({ provenance_json: null, enriched_at: seen }).kind, "unknown");
});

test("a name from the school's own page is used; one from an advert or of unknown source is not", () => {
  const base = { role: "PE Teacher", school: "X", principal: "Dr Anna Reyes" };
  const page = draftEmail({ ...base, principalSource: { kind: "school-page", where: "https://x.edu/head", seenAt: seen } });
  assert.match(page.body, /^Dear Principal Anna Reyes and the HR Team,/);

  const advert = draftEmail({ ...base, principalSource: { kind: "advert", seenAt: seen } });
  assert.match(advert.body, /^Dear Principal and the HR Team,/);
  assert.ok(advert.flags.some((f) => /only in a job advert/.test(f)));

  const unknown = draftEmail({ ...base, principalSource: { kind: "unknown", seenAt: seen } });
  assert.match(unknown.body, /^Dear Principal and the HR Team,/);
  assert.ok(unknown.flags.some((f) => /never recorded/.test(f)));
});

test("a name last read long ago is flagged for a re-check before the hiring season", () => {
  const old = new Date(Date.now() - 300 * 86_400_000).toISOString();
  const d = draftEmail({ role: "PE Teacher", school: "X", principal: "Anna Reyes", principalSource: { kind: "school-page", where: "https://x.edu", seenAt: old } });
  assert.match(d.body, /^Dear Principal Anna Reyes/);
  assert.ok(d.flags.some((f) => /months ago — people change in July and August/.test(f)));
  assert.equal(isStale({ kind: "school-page", seenAt: seen }), false);
  assert.equal(monthsAgo(old) !== null && monthsAgo(old)! >= 9, true);
});
