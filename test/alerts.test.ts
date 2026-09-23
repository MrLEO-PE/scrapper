/**
 * Alert selection and formatting.
 *
 * These decide what is worth interrupting you for, so the risk runs both ways:
 * missing a Head of Sport that closes in three days, or crying wolf every
 * morning about the same role until it expires.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CLOSING_SOON_DAYS, formatAlerts, summariseAlerts } from "../src/alerts.ts";
import type { JobRow } from "../src/store/db.ts";

const inDays = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString();

function job(over: Partial<JobRow> = {}): JobRow {
  return {
    id: "tes:1",
    source: "tes",
    title: "PE Teacher",
    url: "https://example.org/job/1",
    school_name: "Example International School",
    school_key: "example",
    country: "United Arab Emirates",
    city: "Dubai",
    description: null,
    posted_at: null,
    deadline_at: null,
    start_date: null,
    salary_json: null,
    contract_type: null,
    benefits_json: null,
    curriculum_json: null,
    school_website: null,
    emails_json: null,
    attachments_json: null,
    application_url: null,
    pe_score: 50,
    pe_seniority: "teacher",
    is_pe: 1,
    status: "open",
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    alerted_at: null,
    ...over,
  } as JobRow;
}

test("groups leadership separately from closing-soon", () => {
  const body = formatAlerts([
    { job: job({ title: "Head of Sport", pe_seniority: "director_of_sport" }), reasons: ["leadership"], daysLeft: 30 },
    { job: job({ id: "tes:2", title: "PE Teacher" }), reasons: ["closing"], daysLeft: 3 },
  ]);
  assert.match(body, /### Leadership roles \(1\)/);
  assert.match(body, new RegExp(`### Closing within ${CLOSING_SOON_DAYS} days \\(1\\)`));
  assert.match(body, /Head of Sport/);
});

test("makes an imminent deadline prominent", () => {
  const soon = formatAlerts([{ job: job(), reasons: ["closing"], daysLeft: 2 }]);
  assert.match(soon, /\*\*2d left\*\*/);

  const today = formatAlerts([{ job: job(), reasons: ["closing"], daysLeft: 0 }]);
  assert.match(today, /\*\*closes today\*\*/);

  // A distant deadline is stated but not shouted.
  const later = formatAlerts([{ job: job(), reasons: ["strong"], daysLeft: 40 }]);
  assert.match(later, /40d left/);
  assert.doesNotMatch(later, /\*\*40d left\*\*/);
});

test("says plainly when there is nothing to report", () => {
  assert.match(formatAlerts([]), /No new PE vacancies/);
});

test("caps the long tail but says how many were held back", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    job: job({ id: `tes:${i}`, title: `PE Teacher ${i}` }),
    reasons: ["strong" as const],
    daysLeft: null,
  }));
  const body = formatAlerts(many);
  assert.match(body, /### Other strong matches \(15 of 30\)/);
});

test("includes a link back to the site when given one", () => {
  const body = formatAlerts([{ job: job(), reasons: ["closing"], daysLeft: 1 }], "https://example.github.io/s/");
  assert.match(body, /\[See everything →\]\(https:\/\/example\.github\.io\/s\/\)/);
});

test("summarises for a notification title", () => {
  const summary = summariseAlerts([
    { job: job({ pe_seniority: "head_of_department" }), reasons: ["leadership"], daysLeft: null },
    { job: job({ id: "tes:2" }), reasons: ["closing"], daysLeft: 2 },
    { job: job({ id: "tes:3" }), reasons: ["closing"], daysLeft: 5 },
  ]);
  assert.equal(summary, "PE jobs: 1 leadership, 2 closing soon");
});

test("escapes nothing it should not — titles pass through verbatim", () => {
  const body = formatAlerts([
    { job: job({ title: "Head of PE & Sport (Jan 2027)" }), reasons: ["leadership"], daysLeft: null },
  ]);
  assert.match(body, /Head of PE & Sport \(Jan 2027\)/);
});
