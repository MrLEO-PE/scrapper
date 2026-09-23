/**
 * Matching an advert's stated requirements against what you can evidence.
 *
 * Two mistakes matter here, and they pull in opposite directions: claiming
 * something the school never asked for reads as padding, and claiming
 * something you do not hold is dishonest. Both sides therefore come from data
 * — the advert's own words, and config/profile.json.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assessFit, fitSentence, fitSummary } from "../src/match/fit.ts";

const held = [
  { key: "igcse", label: "IGCSE PE", phrase: "I teach IGCSE PE within the Cambridge programme" },
  { key: "cambridge", label: "Cambridge curriculum", phrase: "I work within the Cambridge programme" },
  { key: "coordination", label: "coordination", phrase: "I have coordinated PE provision" },
  { key: "coaching", label: "coaching", phrase: "I coach and run fixtures alongside my teaching" },
  { key: "secondary", label: "secondary PE", phrase: "I teach across the secondary age range" },
];

test("reports only what the advert actually asks for", () => {
  const fit = assessFit("Teacher of PE to deliver IGCSE PE. You will coach teams.", held);
  const asked = fit.signals.map((s) => s.requirement);
  assert.ok(asked.includes("IGCSE PE"));
  assert.ok(asked.includes("sports coaching"));
  // Never asked for, so never claimed — even though the profile holds it.
  assert.ok(!asked.includes("coordination / leading a team"));
});

test("names what they want that you do not hold", () => {
  const fit = assessFit("The successful candidate will teach IB DP and MYP physical education.", held);
  assert.ok(fit.gaps.some((g) => /IB/.test(g)));
  assert.equal(fit.signals.length, 0);
  assert.equal(fit.score, 0);
});

test("scores the share of stated requirements you meet", () => {
  // Asks for IGCSE (held) and IB DP (not held).
  const half = assessFit("IGCSE PE required. IB Diploma Programme experience desirable.", held);
  assert.ok(half.score > 0 && half.score < 100);

  const all = assessFit("We need someone to teach IGCSE PE and coach teams.", held);
  assert.equal(all.score, 100);
});

test("says nothing when the advert states no requirement it recognises", () => {
  const fit = assessFit("A friendly school in a lovely city seeks an enthusiastic colleague.", held);
  assert.deepEqual(fit.signals, []);
  assert.equal(fit.score, 0);
  assert.equal(fitSentence(fit), "");
});

test("does not repeat itself when requirements overlap", () => {
  // IGCSE and Cambridge both fire on this advert, and their phrases echo.
  const sentence = fitSentence(
    assessFit("Deliver IGCSE PE within the Cambridge programme across the secondary school.", held),
  );
  const cambridgeMentions = (sentence.match(/Cambridge programme/g) ?? []).length;
  assert.equal(cambridgeMentions, 1, sentence);
});

test("keeps the sentence to three claims", () => {
  const fit = assessFit(
    "IGCSE PE, Cambridge curriculum, coordination, coaching and secondary teaching all required.",
    held,
  );
  const sentence = fitSentence(fit);
  // Three at most, so it answers the advert rather than reciting a CV.
  assert.ok(sentence.split(/,| and /).length <= 3, sentence);
});

test("summarises for the sheet", () => {
  const fit = assessFit("IGCSE PE required; you will coach teams.", held);
  const summary = fitSummary(fit);
  assert.match(summary, /IGCSE PE/);
  assert.match(summary, /·/);
});

test("handles an empty profile or empty advert without pretending", () => {
  assert.equal(assessFit("IGCSE PE required", []).score, 0);
  assert.equal(assessFit("", held).signals.length, 0);
});
